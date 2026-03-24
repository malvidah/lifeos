"use client";
import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { mono, F, R } from "@/lib/tokens";
import { toKey, todayKey } from "@/lib/dates";
import { useDbSave, dbLoad } from "@/lib/db";
import { fmtMins, sportEmoji, fmtMinsField, SPORT_EMOJI } from "@/lib/workouts";
import { cachedOuraFetch } from "@/lib/ouraCache";
import { RichLine, Shimmer, SourceBadge } from "../ui/primitives.jsx";
import { DayLabEditor } from "../Editor.jsx";
import { api } from "@/lib/api";
import { estimateNutrition } from "@/lib/images";

function htmlToLines(html) {
  if (!html || typeof html !== 'string') return [];
  return html.split(/<\/p>\s*<p[^>]*>|<br\s*\/?>/)
    .map(s => s.replace(/<[^>]*>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim())
    .filter(Boolean);
}

function rowsToHtml(rows) {
  const lines = (rows || []).filter(r => r.text?.trim()).map(r => r.text);
  return lines.length ? lines.map(l => `<p>${l.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</p>`).join('') : '';
}

// Merge Oura workouts + Strava activities, deduplicating by overlapping type+time
function normalizeType(str) {
  return (str||"").toLowerCase().replace(/[^a-z]/g,"");
}
function mergeWorkouts(ouraWorkouts, stravaActivities) {
  const merged = [];

  // Start with Strava (higher quality names + data)
  for (const act of stravaActivities) {
    merged.push({ source:"strava", name:act.name, sport:act.sport||act.type,
      durationMins:act.duration?Math.round(act.duration/60):null,
      distance:act.distance, calories:act.calories,
      avgHr:act.avgHr, avgSpeed:act.avgSpeed, startTime:act.startTime, id:act.id });
  }

  // Add Oura workouts not already covered by a Strava entry
  for (const w of ouraWorkouts) {
    const wType = normalizeType(w.activity);
    const isDupe = merged.some(m => {
      if(normalizeType(m.sport)===wType || normalizeType(m.name).includes(wType)) {
        return Math.abs((m.durationMins||0)-(w.durationMins||0)) <= 5;
      }
      return false;
    });
    if (!isDupe) {
      merged.push({ source:"oura", name:w.activity||"Workout",
        sport:w.activity, durationMins:w.durationMins,
        distance:w.distance, calories:w.calories,
        startTime:w.startTime });
    }
  }
  return merged;
}

function calcPace(w) {
  const mps = w.avgSpeed || (w.durationMins && w.distance ? (w.distance*1000)/(w.durationMins*60) : null);
  if (!mps) return null;
  const secsPerMile = 1609.34 / mps;
  const m = Math.floor(secsPerMile/60);
  const s = Math.round(secsPerMile%60);
  return `${m}:${String(s).padStart(2,"0")}`;
}
function isRun(w) { return (w.sport||w.type||w.name||"").toLowerCase().match(/run|jog/); }

export default function WorkoutsCard({date,token,userId,stravaConnected}) {
  const [syncedRows, setSyncedRows] = useState([]);
  const {value:manualRows, setValue:setManualRows, loaded} = useDbSave(date, "workouts", [], token, userId);
  const [savedEstimates, setSavedEstimates] = useState({});
  const estLoaded = true;
  const estimating = useRef(new Set());
  const failed = useRef(new Set());
  const [tick, setTick] = useState(0);
  const safe = Array.isArray(manualRows) ? manualRows : [];
  const estMap = (estLoaded && savedEstimates && typeof savedEstimates==="object") ? savedEstimates : {};

  // Build text→row lookup for preserving stats across edits
  const rowByText = useRef(new Map());
  useEffect(() => {
    const m = new Map();
    for (const r of safe) { if (r.text?.trim()) m.set(r.text.trim(), r); }
    rowByText.current = m;
  }, [safe]);

  // Merge saved kcal estimates into synced rows
  const mergedSynced = syncedRows.map(r => ({
    ...r,
    kcal: r.kcal || (typeof estMap[r.id]==="object" ? estMap[r.id]?.kcal : estMap[r.id]) || null,
  }));

  useEffect(()=>{
    if(!token||!userId)return;
    setSyncedRows([]);
    Promise.all([
      cachedOuraFetch(date, token, userId),
      api.get(`/api/strava?date=${date}`, token).then(d => d ?? {}),
    ]).then(([ouraData, stravaData])=>{
      const merged = mergeWorkouts(ouraData.workouts||[], stravaData.activities||[]);
      const rows = merged.map(w=>({
        id: String(w.id || `${w.source}-${w.sport}-${w.durationMins}`),
        source: w.source,
        text: w.name,
        dist: w.distance ? `${(w.distance*0.621371).toFixed(2)}mi` : null,
        pace: isRun(w) ? calcPace(w) : null,
        kcal: w.calories||null,
      }));
      setSyncedRows(rows);
      if (rows.length && token) {
        // Persist synced rows (oura/strava) to workouts table for history view.
        const summary = rows.map(r=>({
          id:r.id, text:r.text, source:r.source,
          dist:r.dist||null, pace:r.pace||null, kcal:r.kcal||null,
        }));
        api.patch('/api/workouts', {date, rows: summary}, token).catch(()=>{});
      }
    });
  },[date,token,userId,stravaConnected]); // eslint-disable-line

  // AI estimation for manual rows missing kcal
  useEffect(()=>{
    if(!token||!loaded)return;
    safe.filter(r=>r.text?.trim()&&!r.kcal&&!estimating.current.has(r.text)&&!failed.current.has(r.text)).forEach(row=>{
      estimating.current.add(row.text);
      estimateNutrition(row.text, token).then(result=>{
        estimating.current.delete(row.text);
        if(result?.kcal) {
          const parsed = parseActivityText(row.text);
          setManualRows(prev=>(Array.isArray(prev)?prev:[]).map(r=>r.text===row.text?{
            ...r,
            kcal:result.kcal||null,
            dist:r.dist||( parsed.dist && result.dist_mi ? `${Number(result.dist_mi).toFixed(2)}mi` : null ),
            pace:r.pace||( parsed.pace && result.pace || null ),
          }:r));
        } else failed.current.add(row.text);
        setTick(t => t + 1);
      });
    });
  },[estimateFlag,loaded,token]); // eslint-disable-line

  // AI kcal estimation for synced rows without native calories
  useEffect(()=>{
    if(!token||!loaded||!estLoaded)return;
    mergedSynced.filter(r=>!r.kcal&&r.text&&!estimating.current.has(r.id)&&!failed.current.has(r.id)).forEach(row=>{
      estimating.current.add(row.id);
      estimateNutrition(`${row.text}${row.dist?` (${row.dist})`:""}`, token).then(result=>{
        estimating.current.delete(row.id);
        if(result?.kcal) setSavedEstimates(prev=>({...(typeof prev==="object"&&prev?prev:{}), [row.id]:result}));
        else failed.current.add(row.id);
      });
    });
  },[syncedRows,loaded,estLoaded,token]); // eslint-disable-line

  function parseActivityText(text) {
    const t = text.toLowerCase();
    // Distance: "5 mi", "5.2mi", "5 miles", "8 km", "8km"
    const distMi = t.match(/(\d+\.?\d*)\s*mi(?:les?)?(?!n)/);
    const distKm  = t.match(/(\d+\.?\d*)\s*km/);
    let dist = null;
    if (distMi) dist = `${parseFloat(distMi[1]).toFixed(2)}mi`;
    else if (distKm) dist = `${(parseFloat(distKm[1])*0.621371).toFixed(2)}mi`;
    // Pace: "8 min pace", "8:30 pace", "8:30/mi", "7 min/mi"
    const paceColon = t.match(/(\d+):(\d{2})\s*(?:\/mi|pace|per)/);
    const paceMin   = t.match(/(\d+\.?\d*)\s*min(?:ute)?\s*(?:\/mi|pace|per)/);
    let pace = null;
    if (paceColon) pace = `${paceColon[1]}:${paceColon[2]}`;
    else if (paceMin) { const tot=parseFloat(paceMin[1])*60; pace=`${Math.floor(tot/60)}:${String(Math.round(tot%60)).padStart(2,'0')}`; }
    return { dist, pace };
  }
  // Convert editor HTML → rows array, preserving stats for unchanged lines
  function parseEditorHtml(html) {
    const lines = htmlToLines(html);
    const usedTexts = new Set();
    return lines.map(text => {
      const existing = rowByText.current.get(text);
      if (existing && !usedTexts.has(text)) {
        usedTexts.add(text);
        return existing;
      }
      const {dist, pace} = parseActivityText(text);
      return { id: Date.now() + Math.random(), text, dist, pace, kcal: null };
    });
  }
  const [estimateFlag, setEstimateFlag] = useState(0);
  function handleBlur(html) { setManualRows(parseEditorHtml(html)); setEstimateFlag(f => f + 1); }
  const updateTimer = useRef(null);
  function handleUpdate(html) {
    clearTimeout(updateTimer.current);
    updateTimer.current = setTimeout(() => setManualRows(parseEditorHtml(html)), 400);
  }
  function handleKeyDown(e) {
    if (e.key === 'Enter') setEstimateFlag(f => f + 1);
  }

  const KCOL=72, DCOL=60, PCOL=100;
  const colDist  = {fontFamily:mono, fontSize:F.sm, color:"var(--dl-blue)",   flexShrink:0, width:DCOL, textAlign:"center", whiteSpace:"nowrap"};
  const colPace  = {fontFamily:mono, fontSize:F.sm, color:"var(--dl-green)",  flexShrink:0, width:PCOL, textAlign:"center", whiteSpace:"nowrap"};
  const colKcal  = {fontFamily:mono, fontSize:F.sm, color:"var(--dl-orange)", flexShrink:0, width:KCOL, textAlign:"center", whiteSpace:"nowrap"};
  const colMuted = (w) => ({fontFamily:mono, fontSize:F.sm, color:"var(--dl-highlight)", flexShrink:0, width:w, textAlign:"center", whiteSpace:"nowrap"});
  const rowS = {display:"flex", alignItems:"center", gap:0, padding:"3px 0", minHeight:28};
  const chipBase = {fontFamily:mono, fontSize:F.sm, letterSpacing:"0.04em", flexShrink:0, borderRadius:4, padding:"2px 8px", whiteSpace:"nowrap"};

  const manualLines = safe.filter(r => r.text?.trim());
  const allRows = [...mergedSynced, ...manualLines];
  const totalKcal = allRows.reduce((s,r)=>s+(r.kcal||0),0);

  // Parse distances like "3.50mi" → number
  function parseDist(d){ const m=String(d||"").match(/[\d.]+/); return m?+m[0]:null; }
  function parsePaceSecs(p){ const m=String(p||"").match(/^(\d+):(\d+)/); return m?+m[1]*60+ +m[2]:null; }
  const distVals = allRows.map(r=>parseDist(r.dist)).filter(Boolean);
  const paceVals = allRows.map(r=>parsePaceSecs(r.pace)).filter(Boolean);
  const totalDistMi = distVals.length ? distVals.reduce((a,b)=>a+b,0) : 0;
  const avgPaceSecs = paceVals.length ? paceVals.reduce((a,b)=>a+b,0)/paceVals.length : 0;
  const avgPaceFmt = avgPaceSecs ? `${Math.floor(avgPaceSecs/60)}:${String(Math.round(avgPaceSecs%60)).padStart(2,"0")}` : null;
  const showTotals = totalKcal>0||totalDistMi>0||avgPaceFmt;

  if(!loaded) return (<div style={{display:"flex",flexDirection:"column",gap:8,padding:"4px 0"}}>
    <Shimmer width="75%" height={13}/><Shimmer width="55%" height={13}/>
  </div>);

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
      <div style={{flex:1,overflowY:"auto",minHeight:0}}>
        {mergedSynced.map(row=>(
          <div key={row.id} style={rowS}>
            <span style={{display:"flex",alignItems:"center",gap:6,flex:1,minWidth:0,overflow:"hidden"}}>
              <span style={{lineHeight:1.7,flex:1,minWidth:0}}>
                <RichLine text={row.text}/>
              </span>
              <SourceBadge source={row.source}/>
            </span>
            <span style={row.dist ? colDist : colMuted(DCOL)}>{row.dist||""}</span>
            <span style={row.pace ? colPace : colMuted(PCOL)}>{row.pace?`${row.pace}/mi`:""}</span>
            <span style={row.kcal ? colKcal : colMuted(KCOL)}>
              {estimating.current.has(row.id)?"…":row.kcal?`-${row.kcal}kcal`:""}
            </span>
          </div>
        ))}
        {/* Manual entries — single multi-line editor + stats columns */}
        <div style={{display:"flex",gap:0}} onKeyDown={handleKeyDown}>
          <DayLabEditor
            value={rowsToHtml(safe)}
            onBlur={handleBlur}
            onUpdate={handleUpdate}
            placeholder={mergedSynced.length===0?"What did you do?":""}
            textColor={"var(--dl-strong)"}
            mutedColor={"var(--dl-middle)"}
            color={"var(--dl-accent)"}
            style={{flex:1,padding:0,minHeight:28}}
          />
          {manualLines.length > 0 && (
            <div style={{flexShrink:0,display:"flex",flexDirection:"column"}}>
              {manualLines.map((row,i) => (
                <div key={i} style={{display:"flex",alignItems:"center",height:28}}>
                  <span style={row.dist ? colDist : colMuted(DCOL)}>{row.dist||"—"}</span>
                  <span style={row.pace ? colPace : colMuted(PCOL)}>{row.pace?`${row.pace}/mi`:"—"}</span>
                  <span style={row.kcal ? colKcal : colMuted(KCOL)}>
                    {estimating.current.has(row.text)?"…":row.kcal?`-${row.kcal}kcal`:"—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {showTotals && (
        <div style={{flexShrink:0,paddingTop:6,paddingBottom:2,display:"flex",alignItems:"center",borderTop:"1px solid var(--dl-border)"}}>
          <div style={{flex:1}}/>
          <div style={{width:DCOL,display:"flex",justifyContent:"center"}}>
            {totalDistMi>0&&<span style={{...chipBase,background:"var(--dl-blue-13)",color:"var(--dl-blue)"}}>{totalDistMi.toFixed(1)}mi</span>}
          </div>
          <div style={{width:PCOL,display:"flex",justifyContent:"center"}}>
            {avgPaceFmt&&<span style={{...chipBase,background:"var(--dl-green-13)",color:"var(--dl-green)"}}>{avgPaceFmt}/mi</span>}
          </div>
          <div style={{width:KCOL,display:"flex",justifyContent:"center"}}>
            {totalKcal>0&&<span style={{...chipBase,background:"var(--dl-orange-13)",color:"var(--dl-orange)"}}>-{totalKcal}kcal</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tasks ────────────────────────────────────────────────────────────────────
// ─── NewProjectTask — empty-state inline task input for project view ─────────
