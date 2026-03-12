"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { serif, mono, F, R } from "@/lib/tokens";
import { toKey, todayKey, shift } from "@/lib/dates";
import { useDbSave, dbLoad, MEM, DIRTY } from "@/lib/db";
import { cachedOuraFetch, _ouraCache } from "@/lib/ouraCache";
import { createClient } from "@/lib/supabase";
import { Card, Ring, Widget, Shimmer, ChevronBtn, InfoTip } from "../ui/primitives.jsx";
import { fmtMins, fmtMinsField, sportEmoji } from "@/lib/formatting";
import { api } from "@/lib/api";

const H_EMPTY={sleepScore:"",sleepHrs:"",sleepEff:"",readinessScore:"",hrv:"",rhr:"",activityScore:"",activeCalories:"",totalCalories:"",steps:"",activeMinutes:"",resilienceScore:"",stressMins:"",recoveryMins:""};

export default function HealthCard({date,token,userId,onHealthChange,onScoresReady,onSyncStart,onSyncEnd,collapsed,onToggle,backAction}) {
  const {value:h,setValue:setH,loaded}=useDbSave(date,"health",H_EMPTY,token,userId);
  const [dataSource, setDataSource] = useState(null); // null | 'oura' | 'apple' | 'both'

  // Reset to empty immediately on date change — never show stale previous-day data
  const prevHealthDate = useRef(date);
  useEffect(()=>{
    if(prevHealthDate.current !== date){
      prevHealthDate.current = date;
      setH(H_EMPTY);
    }
  },[date]); // eslint-disable-line

  useEffect(()=>{if(loaded)onHealthChange(date,h);},[h,loaded]); // eslint-disable-line

  useEffect(()=>{
    if(!loaded||!token)return;
    // Never fetch Oura for future dates — no data exists and the wide session window
    // would incorrectly pull today's sleep data onto tomorrow's date
    if(date > todayKey()) { onSyncEnd("oura"); return; }
    onSyncStart("oura");
    cachedOuraFetch(date, token, userId).then(async data=>{
        if(data.error==="no_token") {
          // No Oura — try Garmin first, then fall back to Apple Health
          const garminData = await api.get(`/api/garmin?date=${date}`, token).catch(() => ({})) ?? {};
          if(garminData && !garminData.error && Object.keys(garminData).length > 0) {
            setH(p=>({...p,
              sleepHrs:       garminData.sleepHrs        ?? "",
              sleepEff:       garminData.sleepQuality     ?? "",
              hrv:            garminData.hrv              ?? "",
              rhr:            garminData.rhr              ?? "",
              activeCalories: garminData.activeCalories   ?? "",
              totalCalories:  garminData.totalCalories    ?? "",
              steps:          garminData.steps            ?? "",
              activeMinutes:  garminData.activeMinutes    ?? "",
            }));
            setDataSource("garmin");
            onSyncEnd("oura"); return;
          }
          // No Garmin either — fall back to Apple Health data synced from iOS app
          const sb = createClient(); // singleton — already imported at top
          const {data:row} = await sb.from("entries").select("data")
            .eq("type","health_apple").eq("date",date).eq("user_id",userId).maybeSingle();
          if(row?.data) {
            const d = row.data;
            setH(p=>({...p,
              sleepHrs:       d.sleepHrs       ?? "",
              sleepEff:       d.sleepEff       ?? "",
              hrv:            d.hrv            ?? "",
              rhr:            d.rhr            ?? "",
              activeCalories: d.activeCalories ?? "",
              totalCalories:  d.totalCalories  ?? "",
              steps:          d.steps          ?? "",
              activeMinutes:  d.activeMinutes  ?? "",
            }));
            setDataSource("apple");
          }
          onSyncEnd("oura"); return;
        }
        if(data.error){ onSyncEnd("oura"); return; }
        // Oura connected — also check if Apple Health has data for this date (could have both)
        const sb2 = createClient(); // singleton — safe to call multiple times
        const {data:appleRow} = await sb2.from("entries").select("date")
          .eq("type","health_apple").eq("date",date).eq("user_id",userId).maybeSingle();
        setDataSource(appleRow ? "both" : "oura");
        // Nullish coalescing: only set a field if Oura returned a real value.
        // Never fall back to p.x — if Oura has no data for this date, leave it blank.
        setH(p=>({...p,
          sleepScore:     data.sleepScore      ?? "",
          sleepHrs:       data.sleepHrs        ?? "",
          sleepEff:       data.sleepQuality    ?? "",
          readinessScore: data.readinessScore  ?? "",
          hrv:            data.hrv             ?? "",
          rhr:            data.rhr             ?? "",
          activityScore:  data.activityScore   ?? "",
          activeCalories: data.activeCalories  ?? "",
          totalCalories:  data.totalCalories   ?? "",
          steps:          data.steps           ?? "",
          activeMinutes:  data.activeMinutes   ?? "",
          resilienceScore:data.resilienceScore ?? "",
          stressMins:     data.stressMins      ?? "",
          recoveryMins:   data.recoveryMins    ?? "",
        }));
      }).catch(()=>{}).finally(()=>onSyncEnd("oura"));
  },[date,loaded,token]); // eslint-disable-line

  const purple = "#8B6BB5";

  // ── Computed scores from /api/scores ──────────────────────────────────────
  const [scores, setScores] = useState(null);
  const prevScoreDate = useRef(date);
  useEffect(()=>{
    if(prevScoreDate.current !== date){ prevScoreDate.current = date; setScores(null); }
  },[date]);

  // ── Apple Health connect prompt (iOS only) ────────────────────────────────
  const [hkStatus, setHkStatus] = useState(null); // null | 'not_determined' | 'authorized' | 'denied'
  useEffect(()=>{
    if(typeof window === 'undefined') return;
    const handler = e => setHkStatus(e.detail?.status ?? null);
    window.addEventListener('daylabHealthKit', handler);
    return () => window.removeEventListener('daylabHealthKit', handler);
  },[]);

  const connectAppleHealth = () => {
    // Send message to iOS native layer — include token so native doesn't need to re-fetch it
    if(window.webkit?.messageHandlers?.daylabRequestHealthKit) {
      window.webkit.messageHandlers.daylabRequestHealthKit.postMessage({token: token||localStorage.getItem('daylab:token')||''});
    }
  };

  // Stable fingerprint — only refetch scores when the fields that affect computation change
  const scoreFingerprint = loaded
    ? [h.sleepHrs,h.sleepEff,h.hrv,h.rhr,h.steps,h.activeMinutes].join(':')
    : null;

  useEffect(()=>{
    // Wait until h is loaded from DB — prevents H_EMPTY first-fire from corrupting dots
    if(!token||!loaded||scoreFingerprint===null) return;
    if(date > todayKey()) return; // never request scores for future dates
    const ctrl = new AbortController();
    const tzOffset = new Date().getTimezoneOffset() * -1;
    const p = new URLSearchParams({ date, tzOffset });
    if(h.sleepHrs)       p.set('sleepHrs',      h.sleepHrs);
    if(h.sleepEff)       p.set('sleepEff',       h.sleepEff);
    if(h.hrv)            p.set('hrv',            h.hrv);
    if(h.rhr)            p.set('rhr',            h.rhr);
    if(h.steps)          p.set('steps',          h.steps);
    if(h.activeMinutes)  p.set('activeMinutes',  h.activeMinutes);
    api.get(`/api/scores?${p}`, token)
      .then(d => {
        if (d && !d.error) {
          setScores(d);
          if (d.sleep?.score != null || d.readiness?.score != null || d.activity?.score != null || d.recovery?.score != null) {
            onScoresReady(date, d);
          }
        }
      }).catch(e => { if (e.name !== 'AbortError') console.warn('scores fetch', e); });
    return ()=>ctrl.abort();
  },[date,token,scoreFingerprint,loaded]); // eslint-disable-line

  // ── Sparkline SVG ─────────────────────────────────────────────────────────
  function Sparkline({data, color, width=52, height=20}) {
    const raw = data || [];
    // Keep only non-null entries with their original index (preserves time position)
    const pts = raw.map((v,i) => v!=null ? {v,i} : null).filter(Boolean);
    if(pts.length < 2) return <div style={{width,height}}/>;
    const vals = pts.map(p=>p.v);
    const mn = Math.min(...vals), mx = Math.max(...vals);
    const range = mx - mn || 1;
    const total = raw.length - 1 || 1;
    const xs = pts.map(p => (p.i/total)*(width-2)+1);
    const ys = pts.map(p => height-1 - ((p.v-mn)/range)*(height-2));
    return (
      <svg width={width} height={height} style={{display:'block',overflow:'visible',marginLeft:8}}>
        <polyline points={xs.map((x,i)=>`${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')}
          fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7"/>
        <circle cx={xs[xs.length-1].toFixed(1)} cy={ys[ys.length-1].toFixed(1)} r="2" fill={color}/>
      </svg>
    );
  }

  const calibDays = scores?.calibrationDays ?? 0;
  const showBadge = calibDays > 0 && calibDays < 14;

  const metrics=[
    {key:"sleep",    label:"Sleep",    color:"var(--dl-blue)",  score:scores?.sleep?.score,
      fields:[{label:"Hours",value:h.sleepHrs,unit:"h",ck:"sleepHrs"},{label:"Effic.",value:h.sleepEff,unit:"%",ck:"efficiency"}],
      sparkline:scores?.sleep?.sparkline},
    {key:"readiness",label:"Readiness",color:"var(--dl-green)", score:scores?.readiness?.score,
      fields:[{label:"HRV",value:h.hrv,unit:"ms",ck:"hrv"},{label:"RHR",value:h.rhr,unit:"bpm",ck:"rhr"}],
      sparkline:scores?.readiness?.sparkline},
    {key:"workouts", label:"Workouts", color:"var(--dl-accent)",score:scores?.activity?.score,
      fields:[{label:"Steps",value:h.steps?Number(h.steps).toLocaleString():"",ck:"steps"},{label:"Active",value:h.activeMinutes,unit:"min",ck:"activeMinutes"}],
      sparkline:scores?.activity?.sparkline},
    {key:"recovery", label:"Recovery", color:purple,  score:scores?.recovery?.score,
      fields:[{label:"Calm",value:h.recoveryMins?String(Math.round(+h.recoveryMins)):"",unit:h.recoveryMins?"min":"",ck:"hrvTrend"},{label:"Stress",value:h.stressMins?String(Math.round(+h.stressMins)):"",unit:h.stressMins?"min":"",ck:"rhrTrend"}],
      sparkline:scores?.recovery?.sparkline},
  ];

  // ── Trend panel state ──────────────────────────────────────────────────────
  const [expandedMetric, setExpandedMetric] = useState(null);  // controls trend
  const [breakdownMetric, setBreakdownMetric] = useState(null); // controls score breakdown
  const [trendRange,     setTrendRange]     = useState("30d"); // "30d" | "12m"
  const [trendData, setTrendData]           = useState({});
  const [trendLoading, setTrendLoading]     = useState(false);

  useEffect(() => {
    if (!expandedMetric || !token || !userId || !date) return;
    const days = trendRange === "12m" ? 364 : 29;
    const cacheKey = `${expandedMetric}:${date}:${trendRange}`;
    if (trendData[cacheKey]) return;
    setTrendLoading(true);
    const supabase = createClient();
    const anchorDate = new Date(date + 'T12:00:00');
    const since = toKey(shift(anchorDate, -days));
    supabase
      .from('entries').select('date,data')
      .eq('user_id', userId).eq('type', 'scores')
      .gte('date', since).lte('date', date)
      .order('date', { ascending: true })
      .then(({ data: rows }) => {
        if (!rows) { setTrendLoading(false); return; }
        const map = {};
        rows.forEach(row => {
          if (!row.date || !row.data) return;
          map[row.date] = {
            sleep:     +row.data.sleepScore     || null,
            readiness: +row.data.readinessScore || null,
            activity:  +row.data.activityScore  || null,
            recovery:  +row.data.recoveryScore  || null,
          };
        });
        setTrendData(prev => ({ ...prev, [cacheKey]: map }));
        setTrendLoading(false);
      }).catch(() => setTrendLoading(false));
  }, [expandedMetric, trendRange, date, token, userId]); // eslint-disable-line

  const TREND_INFO = {
    sleep: {
      what: "Measures how restorative last night's sleep was — combining total hours, efficiency, and physiological recovery signals like HRV and resting heart rate.",
      how:  "Weighted blend: sleep duration (7–9h = 100), efficiency (>85% = 100), and HRV/RHR deviation from your personal baseline. Calibrates to your patterns after 14 days.",
    },
    readiness: {
      what: "Reflects your body's recovery state and readiness to perform — how well you've bounced back from recent stress, training, and sleep debt.",
      how:  "Derived from HRV and RHR compared to your rolling 14-day baseline. Higher HRV + lower RHR = higher readiness. Penalizes multi-day downward trends.",
    },
    activity: {
      what: "Tracks daily movement and physical exertion — steps, active time, and calories burned relative to your typical output.",
      how:  "Combines steps (goal: 8,000–10,000), active minutes (WHO: 22/day), and active calories. Scores your activity relative to your personal weekly average after calibration.",
    },
    recovery: {
      what: "Measures stress-recovery balance — the ratio of calm physiological state to stress burden across the day and overnight.",
      how:  "Uses calm vs. stress minutes from Oura (autonomic nervous system balance) when available, otherwise falls back to HRV/RHR trends as a proxy for allostatic load.",
    },
  };

  // Build trend SVG line anchored to date, range = "30d" | "12m"
  function TrendLine({ metricKey, color }) {
    const cacheKey = `${metricKey}:${date}:${trendRange}`;
    const data = trendData[cacheKey];
    if (!data || trendLoading) {
      return (
        <div style={{ height: 94, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontFamily: mono, fontSize: F.sm, color: "var(--dl-dim)" }}>{trendLoading ? 'loading…' : '—'}</span>
        </div>
      );
    }
    const span = trendRange === "12m" ? 364 : 29;
    const anchorDate = new Date(date + 'T12:00:00');
    const days = [];
    for (let i = -span; i <= 0; i++) days.push(toKey(shift(anchorDate, i)));
    const vals = days.map(d => data[d]?.[metricKey] ?? null);
    const pts = vals.map((v, i) => v != null ? { v, i } : null).filter(Boolean);
    if (pts.length < 2) return <div style={{ height: 94, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ fontFamily: mono, fontSize: F.sm, color: "var(--dl-dim)" }}>not enough data</span></div>;

    const W = 600, H = 80;
    const mn = Math.max(0, Math.min(...pts.map(p => p.v)) - 5);
    const mx = Math.min(100, Math.max(...pts.map(p => p.v)) + 5);
    const range = mx - mn || 1;
    const xOf = i => (i / span) * W;
    const yOf = v => H - ((v - mn) / range) * (H - 6) - 3;

    const linePts = pts.map(p => `${xOf(p.i).toFixed(1)},${yOf(p.v).toFixed(1)}`).join(' ');
    const first = pts[0], last = pts[pts.length - 1];
    const fillPath = `M${xOf(first.i).toFixed(1)},${H} L${linePts.split(' ').join(' L')} L${xOf(last.i).toFixed(1)},${H} Z`;

    const avg = pts.reduce((s, p) => s + p.v, 0) / pts.length;
    const avgY = yOf(avg).toFixed(1);

    // ── X-axis ticks ──────────────────────────────────────────────────────────
    // 12M: every month (Jan, Feb…) — up to 12 labels
    // 30D: every Monday — typically 4-5 labels
    // 7D:  every day except today
    // Right-edge guard: drop any tick whose left% is within 10% of right edge
    //   to prevent collision with the fixed endLabel
    // Min-gap guard: drop ticks that are within 6% of the previous tick
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const rawTicks = [];
    if (trendRange === "12m") {
      days.forEach((d, i) => {
        if (d.slice(8) === '01') {
          rawTicks.push({ i, label: MONTHS[parseInt(d.split('-')[1]) - 1] });
        }
      });
    } else if (trendRange === "30d") {
      days.forEach((d, i) => {
        const dow = new Date(d + 'T12:00:00').getDay();
        if (dow === 1) {
          const dt = new Date(d + 'T12:00:00');
          rawTicks.push({ i, label: `${MONTHS[dt.getMonth()]} ${dt.getDate()}` });
        }
      });
    } else {
      days.forEach((d, i) => {
        if (i === span) return;
        const dt = new Date(d + 'T12:00:00');
        rawTicks.push({ i, label: `${MONTHS[dt.getMonth()]} ${dt.getDate()}` });
      });
    }
    // Filter: remove ticks too close to each other (min 6% gap)
    // No right-edge guard needed — endLabel is gone, dot marks the end
    const ticks = [];
    for (const t of rawTicks) {
      const pct = (t.i / span) * 100;
      if (ticks.length > 0 && pct - (ticks[ticks.length-1].i / span) * 100 < 6) continue;
      ticks.push(t);
    }

    return (
      <div style={{ padding: '0 0 4px' }}>
        <div style={{ position: 'relative' }}>
          <svg viewBox={`0 0 ${W} ${H + 10}`} style={{ width: '100%', height: 88, display: 'block', overflow: 'visible' }}
            preserveAspectRatio="none">
            <defs>
              <linearGradient id={`tg-${metricKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.22"/>
                <stop offset="100%" stopColor={color} stopOpacity="0"/>
              </linearGradient>
            </defs>
            <path d={fillPath} fill={`url(#tg-${metricKey})`} stroke="none"/>
            <line x1="0" y1={avgY} x2={W} y2={avgY}
              stroke="rgba(255,255,255,0.2)" strokeWidth="1"
              strokeDasharray="4,4" vectorEffect="non-scaling-stroke"/>
            <polyline points={linePts} fill="none" stroke={color} strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
            {/* X-axis tick marks */}
            {ticks.map(t => (
              <line key={t.i}
                x1={xOf(t.i)} y1={H} x2={xOf(t.i)} y2={H + 4}
                stroke="rgba(255,255,255,0.18)" strokeWidth="1"
                vectorEffect="non-scaling-stroke"/>
            ))}
          </svg>

          {/* Today dot */}
          <div style={{
            position: 'absolute',
            left: `${(last.i / span) * 100}%`,
            top: `${(yOf(last.v) / H) * 80}px`,
            transform: 'translate(-50%, -50%)',
            width: 7, height: 7, borderRadius: '50%',
            background: color,
            pointerEvents: 'none',
          }}/>
        </div>

        {/* X-axis labels row */}
        <div style={{ position: 'relative', height: 14, marginTop: -2 }}>
          {ticks.map(t => {
            const leftPct = (t.i / span) * 100;
            // Avoid clipping at edges
            const transform = leftPct < 8 ? 'none' : leftPct > 92 ? 'translateX(-100%)' : 'translateX(-50%)';
            return (
              <div key={t.i} style={{
                position: 'absolute',
                left: `${leftPct}%`,
                transform,
                fontFamily: mono, fontSize: '9px', color: "var(--dl-dim)",
                letterSpacing: '0.04em', lineHeight: 1,
              }}>{t.label}</div>
            );
          })}

        </div>
      </div>
    );
  }

  return (
    <Card fitContent={!onToggle} style={collapsed?{height:"auto"}:{}}>
      {/* Card header */}
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"11px 14px",
        borderBottom:collapsed?"none":"1px solid var(--dl-border)",flexShrink:0,
        cursor:onToggle?"pointer":"default"}} onClick={backAction?undefined:onToggle}>
        {backAction
          ? <button onClick={backAction} style={{background:"none",border:"none",cursor:"pointer",color:"var(--dl-green)",padding:0,display:"flex",alignItems:"center",gap:4,fontFamily:mono,fontSize:F.sm,marginRight:2}}>←</button>
          : onToggle&&<ChevronBtn collapsed={collapsed} onToggle={e=>{e.stopPropagation();onToggle();}}/>
        }
        <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",
          textTransform:"uppercase",color:backAction?"var(--dl-green)":"var(--dl-muted)",flex:1}}>Health</span>
        {dataSource&&(
          <span style={{fontFamily:mono,fontSize:"10px",color:"var(--dl-dim)",
            border:"1px solid var(--dl-border)",borderRadius:4,padding:"1px 5px"}}>
            {dataSource==="both"?"Oura + Apple Health":dataSource==="apple"?"Apple Health":dataSource==="garmin"?"Garmin":"Oura"}
          </span>
        )}
        {showBadge&&(
          <span title={`Scores calibrating — ${calibDays}/14 days of data. Currently using health guidelines as reference.`}
            style={{fontFamily:mono,fontSize:"10px",color:"var(--dl-muted)",background:"rgba(255,255,255,0.06)",
              borderRadius:4,padding:"1px 6px",cursor:"default"}}>
            Calibrating…
          </span>
        )}
      </div>
      {/* Apple Health connect prompt — iOS only, shown when not yet authorized */}
      {hkStatus==="not_determined"&&!collapsed&&(
        <div style={{padding:"8px 14px",borderBottom:"1px solid var(--dl-border)"}}>
          <button onClick={connectAppleHealth}
            style={{fontFamily:mono,fontSize:F.sm,color:"var(--dl-blue)",background:"none",border:"1px solid var(--dl-blue)",
              borderRadius:6,cursor:"pointer",padding:"5px 12px",letterSpacing:"0.03em",opacity:0.9}}>
            Connect
          </button>
        </div>
      )}
      {/* Metrics row */}
      {!collapsed&&<div style={{position:"relative"}}>
      <div style={{display:"flex",alignItems:"stretch",overflowX:"auto",scrollbarWidth:"none",msOverflowStyle:"none",
        borderBottom:expandedMetric?"1px solid var(--dl-border)":"none",position:"relative"}} ref={el=>{
          if(!el) return;
          const upd=()=>{const f=el.parentElement?.querySelector('.hs-fade');if(f){const atEnd=el.scrollLeft+el.clientWidth>=el.scrollWidth-2;f.style.opacity=(el.scrollWidth>el.clientWidth+2&&!atEnd)?'1':'0';}};
          el._hsCheck=upd; upd(); const ro=new ResizeObserver(upd); ro.observe(el);
          el.addEventListener('scroll',upd);
        }}>
        {metrics.map((m,mi)=>{
          const isTrend     = expandedMetric  === m.key;
          const isDimmed = expandedMetric && !isTrend;
          return (
            <div key={m.key}
              onClick={()=>{ isTrend ? setExpandedMetric(null) : setExpandedMetric(m.key); }}
              style={{flex:"1 0 auto",minWidth:120,display:"flex",alignItems:"center",gap:12,
                borderRight:mi<metrics.length-1?"1px solid var(--dl-border)":"none",
                boxSizing:"border-box", overflow:"hidden",
                padding:"12px 14px",cursor:"pointer",
                background: isTrend ? m.color+"0D" : "transparent",
                borderBottom: isTrend ? `2px solid ${m.color}` : "2px solid transparent",
                opacity: isDimmed ? 0.45 : 1,
                transition:"background 0.2s, opacity 0.2s",
              }}>
              <div style={{flexShrink:0}}>
                <Ring score={m.score} color={m.color} size={48}/>
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                  <div style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:m.color}}>{m.label}</div>
                  {m.sparkline && (
                    <Sparkline data={m.sparkline} color={m.color} width={46} height={18}/>
                  )}
                </div>
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                  {m.fields.map(f=>{
                    const sub = f.ck ? (scores?.[m.key]?.contributors?.[f.ck] ?? null) : null;
                    const hasVal = f.value && f.value !== "—" && f.value !== "";
                    const fc = !hasVal ? "var(--dl-dim)" : sub == null ? "var(--dl-dim)" : sub >= 70 ? "var(--dl-green)" : sub < 45 ? "var(--dl-red)" : "var(--dl-muted)";
                    return (
                      <div key={f.label}>
                        <div style={{fontFamily:mono,fontSize:F.sm,textTransform:"uppercase",color:"var(--dl-dim)",marginBottom:1,letterSpacing:"0.04em"}}>{f.label}</div>
                        <div style={{display:"flex",alignItems:"baseline",gap:2}}>
                          <span style={{fontFamily:serif,fontSize:F.md,color:fc}}>{f.value||"—"}</span>
                          {f.unit&&<span style={{fontFamily:mono,fontSize:F.sm,color:fc,opacity:0.7}}>{f.unit}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="hs-fade" style={{
        position:'absolute', right:0, top:0, bottom:0, width:40, pointerEvents:'none',
        background:"linear-gradient(to right, transparent, var(--dl-bg))",
        display:'flex', alignItems:'center', justifyContent:'flex-end', paddingRight:6,
        opacity:0, transition:'opacity 0.12s ease', zIndex:1,
      }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={"var(--dl-muted)"}
          strokeWidth="2.5" strokeLinecap="round" opacity="0.5">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
      </div>}

      {/* ── Trend panel — always rendered at fixed height to prevent layout shift ── */}
      {!collapsed && (() => {
        const m = expandedMetric ? metrics.find(x => x.key === expandedMetric) : null;
        const trendCacheKey = expandedMetric ? `${expandedMetric}:${date}:${trendRange}` : null;
        const avgVal = m && trendCacheKey && trendData[trendCacheKey]
          ? (() => {
              const span = trendRange === "12m" ? 364 : 29;
              const anchorDate = new Date(date + 'T12:00:00');
              const days=[];for(let i=-span;i<=0;i++)days.push(toKey(shift(anchorDate,i)));
              const vals=days.map(d=>trendData[trendCacheKey][d]?.[expandedMetric]).filter(v=>v!=null);
              return vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : null;
            })()
          : null;
        return (
          <div style={{
            borderTop: expandedMetric ? "1px solid var(--dl-border)" : 'none',
            maxHeight: expandedMetric ? 160 : 0,
            overflow: 'hidden',
            opacity: expandedMetric ? 1 : 0,
            transition: 'max-height 0.25s ease, opacity 0.2s ease, border 0.2s ease',
            padding: expandedMetric ? "10px 16px 8px" : "0 16px",
          }}>
            {m && <>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",
                    textTransform:"uppercase",color:m.color}}>
                    trend
                  </span>
                  {date !== todayKey() && (
                    <span style={{fontFamily:mono,fontSize:"9px",color:"var(--dl-dim)"}}>
                      to {new Date(date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}
                    </span>
                  )}
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  {avgVal != null && (
                    <span style={{fontFamily:mono,fontSize:"10px",color:"var(--dl-dim)"}}>avg {avgVal}</span>
                  )}
                  {["12m","30d"].map(r => (
                    <button key={r} onClick={e=>{e.stopPropagation();setTrendRange(r);}}
                      style={{fontFamily:mono,fontSize:"10px",letterSpacing:"0.05em",
                        padding:"6px 10px",borderRadius:6,cursor:"pointer",border:"none",
                        minHeight:32,
                        background: trendRange===r ? m.color+"33" : "transparent",
                        color: trendRange===r ? m.color : "var(--dl-dim)",
                        transition:"background 0.15s,color 0.15s"}}>
                      {r.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <TrendLine metricKey={m.key} color={m.color}/>
            </>}
          </div>
        );
      })()}

    </Card>
  );
}

// ─── Journal ────────────────────────────────────────────────────────────────────

// Plain textarea with a transparent overlay that colorizes "# heading" lines.
// Cmd+B / Cmd+I wrap selected text in ** / *.
