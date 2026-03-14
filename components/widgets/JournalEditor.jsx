"use client";
import { useState, useEffect, useRef, useCallback, useContext, Fragment } from "react";
import { mono, F, R, projectColor } from "@/lib/tokens";
import { useDbSave } from "@/lib/db";
import { NoteContext, ProjectNamesContext, NavigationContext } from "@/lib/contexts";
import { RichLine, Shimmer, SourceBadge } from "../ui/primitives.jsx";
import { estimateNutrition, uploadImageFile } from "@/lib/images";
import { DayLabEditor } from "../Editor.jsx";

export function JournalEditor({date,userId,token}) {
  const {value, setValue, loaded, markDirty} = useDbSave(date, 'journal', '', token, userId);
  // Hooks must be called unconditionally (before any early return)
  const { notes: ctxNotes } = useContext(NoteContext);
  const ctxProjects = useContext(ProjectNamesContext);
  const { navigateToProject, navigateToNote } = useContext(NavigationContext);

  if (!loaded) return (
    <div style={{display:'flex',flexDirection:'column',gap:10,padding:'4px 0'}}>
      <Shimmer width="80%" height={14}/>
      <Shimmer width="60%" height={14}/>
      <Shimmer width="70%" height={14}/>
    </div>
  );

  return (
    <DayLabEditor
      value={value || ''}
      onBlur={html => setValue(html, {undoLabel: 'Edit notes'})}
      onUpdate={html => markDirty(html)}
      onImageUpload={file => uploadImageFile(file, token)}
      noteNames={ctxNotes}
      projectNames={ctxProjects}
      onProjectClick={name => navigateToProject(name)}
      onNoteClick={name => navigateToNote(name)}
      placeholder="What's on your mind?"
      textColor={"var(--dl-strong)"}
      mutedColor={"var(--dl-middle)"}
      color={"var(--dl-accent)"}
      style={{minHeight: 80, width: '100%'}}
    />
  );
}

// ─── RowList ─────────────────────────────────────────────────────────────────
// syncedRows: live from API, may have native kcal (Strava) or need estimation (Oura)
// AI estimates for synced rows persist to DB under type+"_kcal" key
export function RowList({date,type,placeholder,promptFn,prefix,color,token,userId,syncedRows=[],showProtein=false}) {
  const mkRow = () => ({id:Date.now(), text:"", kcal:null, protein:null});
  const {value:rows, setValue:setRows, loaded} = useDbSave(date, type, [mkRow()], token, userId);
  const {value:savedEstimates, setValue:setSavedEstimates, loaded:estimatesLoaded} = useDbSave(date, type+"_kcal", {}, token, userId);
  const estimating = useRef(new Set());
  const failed = useRef(new Set());
  const refs = useRef({});
  const [tick, setTick] = useState(0);
  const fallbackRef = useRef(null);

  // Stabilize the fallback row so it keeps the same id across renders.
  // Without this, mkRow() generates a new Date.now() id every render,
  // and setRows(prev => ...) can't find the virtual row in the store.
  if (Array.isArray(rows) && rows.length) {
    fallbackRef.current = null; // real data exists, clear fallback
  } else if (!fallbackRef.current) {
    fallbackRef.current = [mkRow()];
  }
  const safe = Array.isArray(rows) && rows.length ? rows : fallbackRef.current;
  const estMap = (estimatesLoaded && savedEstimates && typeof savedEstimates === "object") ? savedEstimates : {};

  // Merge saved AI estimates into synced rows
  const merged = syncedRows.map(r => {
    const saved = estMap[r.id];
    const kcal = r.kcal || (typeof saved === "object" ? saved?.kcal : saved) || null;
    const protein = r.protein || (typeof saved === "object" ? saved?.protein : null) || null;
    return {...r, kcal, protein};
  });
  const totalKcal = [...safe, ...merged].reduce((s,r) => s + (r.kcal||0), 0);
  const totalProtein = showProtein ? [...safe, ...merged].reduce((s,r) => s + (r.protein||0), 0) : 0;

  // Estimate for manual rows with no kcal (e.g. added via voice/chat, no blur fired)
  useEffect(() => {
    if (!token || !loaded) return;
    safe
      .filter(r => r.text?.trim() && !r.kcal && !estimating.current.has(r.id) && !failed.current.has(r.id))
      .forEach(row => {
        estimating.current.add(row.id);
        estimateNutrition(promptFn(row.text), token).then(result => {
          estimating.current.delete(row.id);
          if (result) setRows(prev => (Array.isArray(prev)&&prev.length?prev:safe).map(r =>
            r.id===row.id ? {...r, kcal:result.kcal||null, protein:result.protein||null} : r));
          else failed.current.add(row.id);
        });
      });
  }, [safe.map(r=>r.id+r.text).join(","), loaded, token]); // eslint-disable-line

  // Estimate for synced rows with no native calories
  useEffect(() => {
    if (!token || !loaded || !estimatesLoaded) return;
    merged
      .filter(r => !r.kcal && r.text && !estimating.current.has(r.id) && !failed.current.has(r.id))
      .forEach(row => {
        estimating.current.add(row.id);
        estimateNutrition(promptFn(row.text), token).then(result => {
          estimating.current.delete(row.id);
          if (result) setSavedEstimates(prev => ({...(typeof prev==="object"&&prev?prev:{}), [row.id]:result}));
          else failed.current.add(row.id);
        });
      });
  }, [syncedRows, loaded, estimatesLoaded, token]); // eslint-disable-line

  // Auto-fill missing protein for rows that already have kcal but no protein
  useEffect(() => {
    if (!showProtein || !token || !loaded) return;
    safe
      .filter(r => r.text?.trim() && r.kcal && !r.protein && !estimating.current.has(r.id) && !failed.current.has(r.id))
      .forEach(row => {
        estimating.current.add(row.id);
        estimateNutrition(promptFn(row.text), token).then(result => {
          estimating.current.delete(row.id);
          if (result?.protein) {
            setRows(prev => (Array.isArray(prev)&&prev.length?prev:safe).map(r =>
              r.id===row.id ? {...r, protein:result.protein, kcal:result.kcal||r.kcal} : r));
          } else failed.current.add(row.id);
        });
      });
  }, [loaded, token, showProtein]); // eslint-disable-line

  async function runEstimate(id, text) {
    estimating.current.add(id);
    setTick(t => t + 1);
    try {
      const result = await estimateNutrition(promptFn(text), token);
      estimating.current.delete(id);
      setRows(prev => (Array.isArray(prev)&&prev.length?prev:safe).map(r => r.id===id ? {...r, kcal:result?.kcal||null, protein:result?.protein||null} : r));
      setTick(t => t + 1);
    } catch(_) {
      estimating.current.delete(id);
      failed.current.add(id);
      setTick(t => t + 1);
    }
  }

  if (!loaded) return (
    <div style={{display:"flex",flexDirection:"column",gap:8,padding:"4px 0"}}>
      <Shimmer width="75%" height={13}/>
      <Shimmer width="55%" height={13}/>
      <Shimmer width="65%" height={13}/>
    </div>
  );

  const chipBase = {fontFamily:mono, fontSize:F.sm, letterSpacing:"0.04em", flexShrink:0,
    borderRadius:4, padding:"2px 8px", whiteSpace:"nowrap"};
  const PROT_W = 50, ENRG_W = 72;
  const colProtein = {fontFamily:mono, fontSize:F.sm, color:"var(--dl-blue)", flexShrink:0,
    width:PROT_W, textAlign:"center", whiteSpace:"nowrap"};
  const colKcal = {fontFamily:mono, fontSize:F.sm, color:"var(--dl-orange)", flexShrink:0,
    width:ENRG_W, textAlign:"center", whiteSpace:"nowrap"};
  const colMutedProt = {fontFamily:mono, fontSize:F.sm, color:"var(--dl-highlight)", flexShrink:0,
    width:PROT_W, textAlign:"center", whiteSpace:"nowrap"};
  const colMutedEnrg = {fontFamily:mono, fontSize:F.sm, color:"var(--dl-highlight)", flexShrink:0,
    width:ENRG_W, textAlign:"center", whiteSpace:"nowrap"};
  const rowStyle = {display:"flex", alignItems:"center", gap:0, padding:"3px 0", minHeight:28};
  const hdrColProt = {fontFamily:mono, fontSize:F.sm, letterSpacing:"0.06em", textTransform:"uppercase",
    color:"var(--dl-highlight)", flexShrink:0, textAlign:"center", width:PROT_W};
  const hdrColEnrg = {fontFamily:mono, fontSize:F.sm, letterSpacing:"0.06em", textTransform:"uppercase",
    color:"var(--dl-highlight)", flexShrink:0, textAlign:"center", width:ENRG_W};

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
      <div style={{flex:1,overflowY:"auto",minHeight:0}}>
        {merged.map(row => (
          <div key={row.id} style={rowStyle}>
            <span style={{lineHeight:1.7,flex:1,minWidth:0}}>
              <RichLine text={row.text}/>
            </span>
            <SourceBadge source={row.source}/>
            {showProtein && (
              <span style={row.protein ? colProtein : colMutedProt}>
                {estimating.current.has(row.id) ? "…" : row.protein ? `${row.protein}g` : "—"}
              </span>
            )}
            <span style={row.kcal ? colKcal : colMutedEnrg}>
              {estimating.current.has(row.id) ? "…" : row.kcal ? `${row.kcal}kcal` : "—"}
            </span>
          </div>
        ))}
        {safe.map((row, idx) => (
          <div key={row.id} style={rowStyle}>
            <DayLabEditor
              ref={el => refs.current[row.id] = el}
              value={row.text}
              singleLine
              clearOnEnter={false}
              placeholder={idx===0 && merged.length===0 ? placeholder : idx===0 ? "+" : ""}
              textColor={"var(--dl-strong)"}
              mutedColor={"var(--dl-middle)"}
              color={"var(--dl-accent)"}
              style={{ flex: 1, padding: 0 }}
              onBlur={text => {
                setRows(prev => {
                  const s = Array.isArray(prev) && prev.length ? prev : safe;
                  const existing = s.find(r => r.id === row.id);
                  if (text === existing?.text) return prev; // no change
                  return s.map(r => r.id===row.id ? {...r, text, kcal: text !== r.text ? null : r.kcal, protein: text !== r.text ? null : r.protein} : r);
                });
                if (text.trim() && !estimating.current.has(row.id)) runEstimate(row.id, text);
              }}
              onEnterCommit={text => {
                const row2 = mkRow();
                const i = safe.findIndex(r => r.id===row.id);
                setRows(prev => {
                  const s = Array.isArray(prev) && prev.length ? prev : safe;
                  const updated = s.map(r => r.id===row.id ? {...r, text} : r);
                  return i >= 0 ? [...updated.slice(0,i+1), row2, ...updated.slice(i+1)] : [...updated, row2];
                });
                if (text.trim() && !estimating.current.has(row.id)) runEstimate(row.id, text);
                setTimeout(() => refs.current[row2.id]?.focus(), 30);
              }}
              onBackspaceEmpty={safe.length > 1 ? () => {
                const t = safe[idx-1]?.id ?? safe[idx+1]?.id;
                setRows(prev => (Array.isArray(prev)&&prev.length?prev:safe).filter(r => r.id!==row.id));
                setTimeout(() => refs.current[t]?.focus(), 30);
              } : undefined}
            />
            {showProtein && (
              <span style={row.protein ? colProtein : colMutedProt}>
                {!row.text ? "" : estimating.current.has(row.id) ? "…" : row.protein ? `${row.protein}g` : "—"}
              </span>
            )}
            <span style={row.kcal ? colKcal : colMutedEnrg}>
              {!row.text ? "" : estimating.current.has(row.id) ? "…" : row.kcal ? `${row.kcal}kcal` : "—"}
            </span>
          </div>
        ))}
      </div>
      {(totalKcal > 0 || totalProtein > 0) && (
        <div style={{flexShrink:0,paddingTop:6,display:"flex",alignItems:"center",gap:0,borderTop:"1px solid var(--dl-border)"}}>
          <div style={{flex:1}}/>
          {showProtein && (
            <div style={{width:PROT_W,display:"flex",justifyContent:"center"}}>
              {totalProtein > 0 && <span style={{...chipBase,background:"var(--dl-blue-13)",color:"var(--dl-blue)"}}>{totalProtein}g</span>}
            </div>
          )}
          <div style={{width:ENRG_W,display:"flex",justifyContent:"center"}}>
            {totalKcal > 0 && <span style={{...chipBase,background:"var(--dl-orange-13)",color:"var(--dl-orange)"}}>{totalKcal}kcal</span>}
          </div>
        </div>
      )}
    </div>
  );
}


export function Meals({date,token,userId}) { return <RowList date={date} type="meals" token={token} userId={userId} placeholder="What did you eat?" promptFn={t=>`Estimate for: "${t}". Return JSON: {"kcal":420,"protein":30}`} prefix="" color={"var(--dl-accent)"} showProtein/>; }

export function AddJournalLine({ project, onAdd, placeholder }) {
  const col = project && project !== '__everything__' ? projectColor(project) : "var(--dl-accent)";
  const ctxProjects = useContext(ProjectNamesContext);
  const ctxNotes    = useContext(NoteContext);
  const { navigateToProject, navigateToNote } = useContext(NavigationContext);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '2px 0' }}>
      <DayLabEditor
        singleLine
        placeholder={placeholder || 'Add an entry…'}
        projectNames={ctxProjects}
        noteNames={ctxNotes.notes}
        textColor={"var(--dl-strong)"}
        mutedColor={"var(--dl-middle)"}
        color={col}
        style={{ flex: 1, padding: 0 }}
        onProjectClick={name => navigateToProject(name)}
        onNoteClick={name => navigateToNote(name)}
        onEnterCommit={text => { if (text.trim()) onAdd(text.trim()); }}
        onBlur={text => { if (text.trim()) onAdd(text.trim()); }}
      />
    </div>
  );
}
