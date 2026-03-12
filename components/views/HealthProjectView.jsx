"use client";
import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { useTheme } from "@/lib/theme";
import { serif, mono, F, R, projectColor } from "@/lib/tokens";
import { toKey, todayKey, shift, fmtDate, MONTHS_SHORT } from "@/lib/dates";
import { api } from "@/lib/api";
import { tagDisplayName } from "@/lib/tags";
import { Card, Ring, ChevronBtn, RichLine, Shimmer, SourceBadge } from "../ui/primitives.jsx";
import { fmtMins, sportEmoji } from "@/lib/workouts";
import { dbLoad, dbSave, MEM } from "@/lib/db";
import { useCollapse } from "@/lib/hooks";
import { createClient } from "@/lib/supabase";
import HealthCard from "../cards/HealthCard.jsx";
import { AddJournalLine } from "../widgets/JournalEditor.jsx";
import { TaskFilterBtns, NewProjectTask } from "../widgets/Tasks.jsx";

function HealthAllMeals({ token, userId, onSelectDate, onBack }) {
  const { C } = useTheme();
  const [allMeals, setAllMeals] = useState(null);
  const todayStr = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!token || !userId) return;
    const sb = createClient();
    sb.from('entries').select('date, data')
      .eq('user_id', userId).eq('type', 'meals')
      .order('date', { ascending: false })
      .then(({ data }) => {
        const rows = (data || []).flatMap(row => {
          const items = Array.isArray(row.data) ? row.data : [];
          return items.filter(r => r?.text?.trim()).map(r => ({ date: row.date, ...r }));
        });
        setAllMeals(rows);
      });
  }, [token, userId]);

  async function commitMeal(text) {
    if (!text?.trim()) return;
    text = text.trim();
    const current = await dbLoad(todayStr, 'meals', token);
    const existing = Array.isArray(current) ? current.filter(r => r.text) : [];
    const newRow = { id: Date.now(), text, kcal: null, protein: null };
    await dbSave(todayStr, 'meals', [...existing, newRow], token);
    MEM[`${userId}:${todayStr}:meals`] = [...existing, newRow];
    window.dispatchEvent(new CustomEvent('daylab:refresh', { detail: { types: ['meals'] } }));
    setAllMeals(prev => [...(prev || []), { date: todayStr, ...newRow }]);
    estimateNutrition(`Estimate for: "${text}". Return JSON: {"kcal":420,"protein":30}`, token)
      .then(result => {
        if (result) setAllMeals(prev => (prev||[]).map(r => r.id === newRow.id ? {...r, kcal: result.kcal||null, protein: result.protein||null} : r));
      });
  }

  const PROT_W = 50, ENRG_W = 72;
  const colProtein  = {fontFamily:mono,fontSize:F.sm,color:C.blue,  flexShrink:0,width:PROT_W,textAlign:'center',whiteSpace:'nowrap'};
  const colKcal     = {fontFamily:mono,fontSize:F.sm,color:C.orange,flexShrink:0,width:ENRG_W,textAlign:'center',whiteSpace:'nowrap'};
  const colMutedP   = {fontFamily:mono,fontSize:F.sm,color:C.muted, flexShrink:0,width:PROT_W,textAlign:'center',whiteSpace:'nowrap'};
  const colMutedE   = {fontFamily:mono,fontSize:F.sm,color:C.muted, flexShrink:0,width:ENRG_W,textAlign:'center',whiteSpace:'nowrap'};
  const chipBase    = {fontFamily:mono,fontSize:F.sm,letterSpacing:'0.04em',flexShrink:0,borderRadius:4,padding:'2px 8px',whiteSpace:'nowrap'};
  const rowS        = {display:'flex',alignItems:'center',gap:0,padding:'3px 0',minHeight:28};

  if (!allMeals) return <div style={{display:'flex',flexDirection:'column',gap:8,padding:'4px 0'}}><Shimmer width="70%" height={13}/><Shimmer width="55%" height={13}/></div>;

  const todayMeals = allMeals.filter(r => r.date === todayStr);
  const pastMeals  = allMeals.filter(r => r.date !== todayStr);
  const byDate = {};
  pastMeals.forEach(r => { if (!byDate[r.date]) byDate[r.date] = []; byDate[r.date].push(r); });
  const todayKcal    = todayMeals.reduce((s,r) => s+(r.kcal||0), 0);
  const todayProtein = todayMeals.reduce((s,r) => s+(r.protein||0), 0);

  function DateLabel({ date, isToday }) {
    return (
      <div
        onClick={() => !isToday && onSelectDate && (onBack(), onSelectDate(date))}
        style={{fontFamily:mono,fontSize:10,
          color:isToday?C.accent:C.muted,
          letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:4,
          cursor:(!isToday&&onSelectDate)?'pointer':'default',
          display:'inline-block',transition:'color 0.15s'}}
        onMouseEnter={e=>{if(!isToday&&onSelectDate)e.currentTarget.style.color=C.text;}}
        onMouseLeave={e=>{if(!isToday&&onSelectDate)e.currentTarget.style.color=C.muted;}}
      >{isToday ? 'Today' : fmtDate(date)}</div>
    );
  }

  return (
    <div>
      {/* ── Today section — always shown ── */}
      <DateLabel date={todayStr} isToday />
      <AddJournalLine
        onAdd={commitMeal}
        placeholder="Add a meal…"
      />
      {todayMeals.map((r, i) => (
        <div key={r.id||i} style={rowS}>
          <span style={{flex:1,lineHeight:1.7,color:C.text,fontFamily:serif,fontSize:F.md,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',minWidth:0}}>{r.text}</span>
          <span style={r.protein ? colProtein : colMutedP}>{r.protein ? `${r.protein}g` : '—'}</span>
          <span style={r.kcal    ? colKcal    : colMutedE}>{r.kcal    ? `${r.kcal}kcal` : '—'}</span>
        </div>
      ))}
      {(todayKcal > 0 || todayProtein > 0) && (
        <div style={{display:'flex',alignItems:'center',gap:0,paddingTop:4,marginTop:2}}>
          <div style={{flex:1}}/>
          <div style={{width:PROT_W,display:'flex',justifyContent:'center'}}>
            {todayProtein > 0 && <span style={{...chipBase,background:C.blue+'22',color:C.blue}}>{todayProtein}g</span>}
          </div>
          <div style={{width:ENRG_W,display:'flex',justifyContent:'center'}}>
            {todayKcal > 0 && <span style={{...chipBase,background:C.orange+'22',color:C.orange}}>{todayKcal}kcal</span>}
          </div>
        </div>
      )}
      {/* ── Past dates ── */}
      {Object.entries(byDate).sort(([a],[b])=>b.localeCompare(a)).map(([date, rows], di) => {
        const totalKcal    = rows.reduce((s,r) => s+(r.kcal||0), 0);
        const totalProtein = rows.reduce((s,r) => s+(r.protein||0), 0);
        return (
          <div key={date}>
            <div style={{height:1,background:C.border,margin:'8px 0'}}/>
            <DateLabel date={date} isToday={false} />
            {rows.map((r, i) => (
              <div key={i} style={rowS}>
                <span style={{flex:1,lineHeight:1.7,color:C.text,fontFamily:serif,fontSize:F.md,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',minWidth:0}}>{r.text}</span>
                <span style={r.protein ? colProtein : colMutedP}>{r.protein ? `${r.protein}g` : '—'}</span>
                <span style={r.kcal    ? colKcal    : colMutedE}>{r.kcal    ? `${r.kcal}kcal` : '—'}</span>
              </div>
            ))}
            {(totalKcal > 0 || totalProtein > 0) && (
              <div style={{display:'flex',alignItems:'center',gap:0,paddingTop:4,marginTop:2}}>
                <div style={{flex:1}}/>
                <div style={{width:PROT_W,display:'flex',justifyContent:'center'}}>
                  {totalProtein > 0 && <span style={{...chipBase,background:C.blue+'22',color:C.blue}}>{totalProtein}g</span>}
                </div>
                <div style={{width:ENRG_W,display:'flex',justifyContent:'center'}}>
                  {totalKcal > 0 && <span style={{...chipBase,background:C.orange+'22',color:C.orange}}>{totalKcal}kcal</span>}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── HealthAllActivities ──────────────────────────────────────────────────────
function HealthAllActivities({ token, userId, onSelectDate, onBack }) {
  const { C } = useTheme();
  const [rows, setRows] = useState(null);
  const [estimating, setEstimating] = useState(new Set());

  useEffect(() => {
    if (!token || !userId) return;
    const sb = createClient();
    Promise.all([
      // Synced workouts (already normalized: {id,text,source,dist,pace,kcal})
      sb.from('entries').select('date, data').eq('user_id', userId).eq('type', 'workouts').order('date', { ascending: false }),
      // Manual activity rows: {id,text,dist,pace,kcal}
      sb.from('entries').select('date, data').eq('user_id', userId).eq('type', 'workouts').order('date', { ascending: false }),
    ]).then(([{ data: wktData }, { data: actData }]) => {
      const seen = new Set();
      const all = [];
      // Synced first (higher quality)
      for (const row of (wktData || [])) {
        for (const r of (Array.isArray(row.data) ? row.data : [])) {
          if (!r?.text?.trim()) continue;
          const key = `${row.date}:${r.text}`;
          if (seen.has(key)) continue;
          seen.add(key);
          all.push({ date: row.date, id: r.id || key, text: r.text, source: r.source||null, dist: r.dist||null, pace: r.pace||null, kcal: r.kcal||null });
        }
      }
      // Manual entries
      for (const row of (actData || [])) {
        for (const r of (Array.isArray(row.data) ? row.data : [])) {
          if (!r?.text?.trim()) continue;
          const key = `${row.date}:${r.text}`;
          if (seen.has(key)) continue;
          seen.add(key);
          all.push({ date: row.date, id: r.id || key, text: r.text, source: null, dist: r.dist||null, pace: r.pace||null, kcal: r.kcal||null });
        }
      }
      setRows(all);
    });
  }, [token, userId]);

  // AI kcal estimation for rows missing kcal
  useEffect(() => {
    if (!rows || !token) return;
    const missing = rows.filter(r => r.text && !r.kcal && !estimating.has(r.id));
    if (!missing.length) return;
    setEstimating(prev => new Set([...prev, ...missing.map(r => r.id)]));
    missing.forEach(row => {
      estimateNutrition(`Calories burned for: "${row.text}"${row.dist ? ` (${row.dist})` : ''} for a typical adult. Return JSON: {"kcal":300}`, token)
        .then(result => {
          if (result?.kcal) setRows(prev => (prev||[]).map(r => r.id === row.id ? {...r, kcal: result.kcal} : r));
          setEstimating(prev => { const n = new Set(prev); n.delete(row.id); return n; });
        });
    });
  }, [rows?.map(r=>r.id).join(','), token]); // eslint-disable-line

  const KCOL=72, DCOL=60, PCOL=100;
  const colDist   = {fontFamily:mono,fontSize:F.sm,color:C.blue,   flexShrink:0,width:DCOL,textAlign:'center',whiteSpace:'nowrap'};
  const colPace   = {fontFamily:mono,fontSize:F.sm,color:C.green,  flexShrink:0,width:PCOL,textAlign:'center',whiteSpace:'nowrap'};
  const colKcal   = {fontFamily:mono,fontSize:F.sm,color:C.orange, flexShrink:0,width:KCOL, textAlign:'center',whiteSpace:'nowrap'};
  const colMuted  = (w) => ({fontFamily:mono,fontSize:F.sm,color:C.muted,flexShrink:0,width:w,textAlign:'center',whiteSpace:'nowrap'});
  const chipBase  = {fontFamily:mono,fontSize:F.sm,letterSpacing:'0.04em',flexShrink:0,borderRadius:4,padding:'2px 8px',whiteSpace:'nowrap'};
  const rowS      = {display:'flex',alignItems:'center',gap:0,padding:'3px 0',minHeight:28};

  const todayStr = new Date().toISOString().slice(0, 10);

  async function commitActivity(text) {
    if (!text?.trim()) return;
    text = text.trim();
    const current = await dbLoad(todayStr, 'workouts', token);
    const existing = Array.isArray(current) ? current.filter(r => r.text) : [];
    const newRow = { id: Date.now(), text, dist: null, pace: null, kcal: null };
    await dbSave(todayStr, 'workouts', [...existing, newRow], token);
    MEM[`${userId}:${todayStr}:workouts`] = [...existing, newRow];
    window.dispatchEvent(new CustomEvent('daylab:refresh', { detail: { types: ['workouts'] } }));
    setRows(prev => [...(prev || []), { date: todayStr, ...newRow }]);
    estimateNutrition(`Calories burned for: "${text}" for a typical adult. Return JSON: {"kcal":300}`, token)
      .then(result => {
        if (result?.kcal) setRows(prev => (prev||[]).map(r => r.id === newRow.id ? {...r, kcal: result.kcal} : r));
      });
  }

  if (!rows) return <div style={{display:'flex',flexDirection:'column',gap:8,padding:'4px 0'}}><Shimmer width="70%" height={13}/><Shimmer width="55%" height={13}/></div>;

  function parseDist(d){ const m=String(d||'').match(/[\d.]+/); return m?+m[0]:null; }

  const withData = rows.filter(r => r.text);
  const todayRows = withData.filter(r => r.date === todayStr);
  const pastRows  = withData.filter(r => r.date !== todayStr);
  const byDate = {};
  pastRows.forEach(r => { if (!byDate[r.date]) byDate[r.date] = []; byDate[r.date].push(r); });
  const todayKcal = todayRows.reduce((s,r) => s+(r.kcal||0), 0);
  const todayDistVals = todayRows.map(r => parseDist(r.dist)).filter(Boolean);
  const todayDist = todayDistVals.length ? todayDistVals.reduce((a,b)=>a+b,0) : 0;

  function ActDateLabel({ date, isToday }) {
    return (
      <div
        onClick={() => !isToday && onSelectDate && (onBack(), onSelectDate(date))}
        style={{fontFamily:mono,fontSize:10,
          color:isToday?C.accent:C.muted,
          letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:4,
          cursor:(!isToday&&onSelectDate)?'pointer':'default',
          display:'inline-block',transition:'color 0.15s'}}
        onMouseEnter={e=>{if(!isToday&&onSelectDate)e.currentTarget.style.color=C.text;}}
        onMouseLeave={e=>{if(!isToday&&onSelectDate)e.currentTarget.style.color=C.muted;}}
      >{isToday ? 'Today' : fmtDate(date)}</div>
    );
  }

  return (
    <div>
      {/* ── Today section — always shown ── */}
      <ActDateLabel date={todayStr} isToday />
      <AddJournalLine
        onAdd={commitActivity}
        placeholder="Add an activity…"
      />
      {todayRows.map((r, i) => (
        <div key={r.id||i} style={rowS}>
          <span style={{display:'flex',alignItems:'center',gap:6,flex:1,minWidth:0,overflow:'hidden'}}>
            <span style={{lineHeight:1.7,color:C.text,fontFamily:serif,fontSize:F.md,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.text}</span>
            <SourceBadge source={r.source}/>
          </span>
          <span style={r.dist ? colDist : colMuted(DCOL)}>{r.dist || '—'}</span>
          <span style={r.pace ? colPace : colMuted(PCOL)}>{r.pace ? `${r.pace}/mi` : '—'}</span>
          <span style={r.kcal ? colKcal : colMuted(KCOL)}>
            {estimating.has(r.id) ? '…' : r.kcal ? `-${r.kcal}kcal` : '—'}
          </span>
        </div>
      ))}
      {(todayKcal > 0 || todayDist > 0) && (
        <div style={{display:'flex',alignItems:'center',gap:0,paddingTop:4,marginTop:2}}>
          <div style={{flex:1}}/>
          <div style={{width:DCOL,display:'flex',justifyContent:'center'}}>
            {todayDist > 0 && <span style={{...chipBase,background:C.blue+'22',color:C.blue}}>{todayDist.toFixed(1)}mi</span>}
          </div>
          <div style={{width:PCOL}}/>
          <div style={{width:KCOL,display:'flex',justifyContent:'center'}}>
            {todayKcal > 0 && <span style={{...chipBase,background:C.orange+'22',color:C.orange}}>{todayKcal}kcal</span>}
          </div>
        </div>
      )}
      {/* ── Past dates ── */}
      {Object.entries(byDate).sort(([a],[b])=>b.localeCompare(a)).map(([date, dateRows], di) => {
        const totalKcal = dateRows.reduce((s,r) => s+(r.kcal||0), 0);
        const distVals  = dateRows.map(r => parseDist(r.dist)).filter(Boolean);
        const totalDist = distVals.length ? distVals.reduce((a,b)=>a+b,0) : 0;
        return (
          <div key={date}>
            <div style={{height:1,background:C.border,margin:'8px 0'}}/>
            <ActDateLabel date={date} isToday={false} />
            {dateRows.map((r, i) => (
              <div key={r.id||i} style={rowS}>
                <span style={{display:'flex',alignItems:'center',gap:6,flex:1,minWidth:0,overflow:'hidden'}}>
                  <span style={{lineHeight:1.7,color:C.text,fontFamily:serif,fontSize:F.md,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.text}</span>
                  <SourceBadge source={r.source}/>
                </span>
                <span style={r.dist ? colDist : colMuted(DCOL)}>{r.dist || '—'}</span>
                <span style={r.pace ? colPace : colMuted(PCOL)}>{r.pace ? `${r.pace}/mi` : '—'}</span>
                <span style={r.kcal ? colKcal : colMuted(KCOL)}>
                  {estimating.has(r.id) ? '…' : r.kcal ? `-${r.kcal}kcal` : '—'}
                </span>
              </div>
            ))}
            {(totalKcal > 0 || totalDist > 0) && (
              <div style={{display:'flex',alignItems:'center',gap:0,paddingTop:4,marginTop:2}}>
                <div style={{flex:1}}/>
                <div style={{width:DCOL,display:'flex',justifyContent:'center'}}>
                  {totalDist > 0 && <span style={{...chipBase,background:C.blue+'22',color:C.blue}}>{totalDist.toFixed(1)}mi</span>}
                </div>
                <div style={{width:PCOL}}/>
                <div style={{width:KCOL,display:'flex',justifyContent:'center'}}>
                  {totalKcal > 0 && <span style={{...chipBase,background:C.orange+'22',color:C.orange}}>{totalKcal}kcal</span>}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
// ─── HealthProjectView ───────────────────────────────────────────────────────
export default function HealthProjectView({ token, userId, onBack, onHealthChange, onScoresReady, startSync, endSync, onSelectDate, taskFilter, setTaskFilter }) {
  const { C } = useTheme();
  const today = new Date().toISOString().slice(0, 10);
  const [entries, setEntries] = useState(null);
  const pvTaskFilter = taskFilter;
  const setPvTaskFilter = setTaskFilter;
  const [vw, setVw] = useState(() => typeof window !== 'undefined' ? window.innerWidth : 800);
  useEffect(() => {
    const fn = () => setVw(window.innerWidth);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);
  const wide = vw >= 900;

  // Collapse state for health project widgets (persisted)
  const [healthCollapsed,     toggleHealth]     = useCollapse('hpv:health',     false);
  const [mealsCollapsed,      toggleMeals]      = useCollapse('hpv:meals',      false);
  const [activitiesCollapsed, toggleActivities] = useCollapse('hpv:activities', false);
  const [tasksCollapsed,      toggleTasks]      = useCollapse('hpv:tasks',      false);
  const [entriesCollapsed,    toggleEntries]    = useCollapse('hpv:entries',    false);

  useEffect(() => {
    if (!token) return;
    setEntries(null);
    api.get('/api/project-entries?project=__health__', token)
      .then(d => setEntries(!d || d.error ? { journalEntries: [], taskEntries: [] } : d))
      .catch(() => setEntries({ journalEntries: [], taskEntries: [] }));
  }, [token]);

  const taskEntries = entries?.taskEntries || [];
  const journalEntries = entries?.journalEntries || [];
  const openTasks = taskEntries.filter(t => !t.done);

  const tasksByDate = useMemo(() => {
    if (!taskEntries.length) return [];
    const map = {};
    taskEntries.forEach(t => {
      if (!map[t.date]) map[t.date] = { open: [], done: [] };
      if (t.done) map[t.date].done.push(t); else map[t.date].open.push(t);
    });
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [taskEntries]);

  const journalByDate = useMemo(() => {
    if (!journalEntries.length) return [];
    const map = {};
    journalEntries.forEach(e => {
      if (!map[e.date]) map[e.date] = [];
      map[e.date].push(e);
    });
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [journalEntries]);

  const tasksWidget = (
    <Card
      label={taskEntries.length ? `Tasks · ${openTasks.length} open` : 'Tasks'}
      color={C.blue} autoHeight
      collapsed={tasksCollapsed} onToggle={toggleTasks}
      headerRight={<TaskFilterBtns filter={pvTaskFilter} setFilter={setPvTaskFilter}/>}
    >
      {entries === null ? (
        <div style={{display:'flex',flexDirection:'column',gap:8}}><Shimmer width="70%" height={13}/><Shimmer width="55%" height={13}/></div>
      ) : (() => {
        const todayStr = todayKey(); // local date — matches addNewTask and day view
        const otherDates = tasksByDate.filter(([d]) => d !== todayStr).sort(([a],[b]) => b.localeCompare(a));
        const todayEntry = tasksByDate.find(([d]) => d === todayStr);
        const allDates = todayEntry
          ? [[todayStr, todayEntry[1]], ...otherDates]
          : [[todayStr, { all:[], open:[], done:[] }], ...otherDates];
        return (
          <div>
            {allDates.filter(([date, { open, done }]) =>
              pvTaskFilter === 'open' ? (open.length > 0 || date === todayStr) :
              pvTaskFilter === 'done' ? (done.length > 0 || date === todayStr) : true
            ).map(([date, { open, done }], dateIdx) => {
              const isToday = date === todayStr;
              return (
                <div key={date}>
                  <div style={{fontFamily:mono,fontSize:10,
                    color:isToday?C.accent:C.muted,
                    letterSpacing:'0.06em',textTransform:'uppercase',
                    marginTop:dateIdx===0?0:4,marginBottom:6}}>
                    {isToday ? 'Today' : fmtDate(date)}
                  </div>
                  {isToday && pvTaskFilter !== 'done' && (
                    <NewProjectTask project="__health__" onAdd={async text => {
                      const taskText = text.trim().toLowerCase().includes('{health}') ? text.trim() : text.trim() + ' {health}';
                      const current = await dbLoad(todayStr, 'tasks', token);
                      const existing = Array.isArray(current) ? current : [];
                      const newTask = { id: Date.now(), text: taskText, done: false };
                      const updated = [...existing, newTask];
                      await dbSave(todayStr, 'tasks', updated, token);
                      MEM[`${userId}:${todayStr}:tasks`] = updated;
                      window.dispatchEvent(new CustomEvent('daylab:refresh', { detail: { types: ['tasks'] } }));
                      setEntries(prev => prev ? {
                        ...prev,
                        taskEntries: [...(prev.taskEntries||[]), { date: todayStr, id: newTask.id, text: taskText, done: false }],
                      } : prev);
                    }} />
                  )}
                  {pvTaskFilter !== 'done' && open.map(task => (
                    <div key={task.id} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'3px 0'}}>
                      <div style={{width:14,height:14,flexShrink:0,marginTop:4,borderRadius:3,border:`1.5px solid ${C.border2}`,background:'transparent'}}/>
                      <div style={{flex:1,fontFamily:serif,fontSize:F.md,lineHeight:'1.7',color:C.text,whiteSpace:'pre-wrap',wordBreak:'break-word'}}><RichLine text={task.text}/></div>
                    </div>
                  ))}
                  {pvTaskFilter !== 'open' && done.map(task => (
                    <div key={task.id} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'3px 0',opacity:0.45}}>
                      <div style={{width:14,height:14,flexShrink:0,marginTop:4,borderRadius:3,border:`1.5px solid ${C.accent}`,background:C.accent,display:'flex',alignItems:'center',justifyContent:'center'}}>
                        <span style={{fontSize:10,color:C.bg,lineHeight:1}}>✓</span>
                      </div>
                      <div style={{flex:1,fontFamily:serif,fontSize:F.md,lineHeight:'1.7',color:C.muted,textDecoration:'line-through'}}><RichLine text={task.text}/></div>
                    </div>
                  ))}
                  {dateIdx < allDates.length - 1 && <div style={{borderTop:`1px solid ${C.border}`,marginTop:12,marginBottom:4}}/>}
                </div>
              );
            })}
          </div>
        );
      })()}
    </Card>
  );

  const entriesWidget = (
    <Card
      label={journalEntries.length ? `Entries · ${journalEntries.length}` : 'Entries'}
      color={C.accent} autoHeight
      collapsed={entriesCollapsed} onToggle={toggleEntries}
    >
      {entries === null ? (
        <div style={{display:'flex',flexDirection:'column',gap:8}}><Shimmer width="70%" height={13}/><Shimmer width="55%" height={13}/></div>
      ) : (() => {
        const todayStr = todayKey(); // local date — matches day view
        const otherDates = journalByDate.filter(([d]) => d !== todayStr);
        const todayLines = journalByDate.find(([d]) => d === todayStr)?.[1] || [];
        const allDates = [[todayStr, todayLines], ...otherDates];
        return (
          <div>
            {allDates.map(([date, lines], dateIdx) => {
              const isToday = date === todayStr;
              if (!isToday && lines.length === 0) return null;
              return (
                <div key={date}>
                  {dateIdx > 0 && <div style={{height:1,background:C.border,margin:'8px 0'}}/>}
                  <div
                    onClick={() => !isToday && onSelectDate && (onBack(), onSelectDate(date))}
                    style={{fontFamily:mono,fontSize:10,
                      color:isToday?C.accent:C.muted,
                      letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:6,
                      cursor:(!isToday&&onSelectDate)?'pointer':'default',
                      display:'inline-block',transition:'color 0.15s'}}
                    onMouseEnter={e=>{if(!isToday&&onSelectDate)e.currentTarget.style.color=C.text;}}
                    onMouseLeave={e=>{if(!isToday&&onSelectDate)e.currentTarget.style.color=C.muted;}}
                  >{isToday ? 'Today' : fmtDate(date)}</div>
                  {isToday && (
                    <AddJournalLine project="__health__" onAdd={async text => {
                      const entryText = text.trim().toLowerCase().includes('{health}') ? text.trim() : text.trim() + ' {health}';
                      const current = await dbLoad(todayStr, 'journal', token);
                      const existing = (typeof current === 'string' ? current : '') || '';
                      const updated = existing ? existing.trimEnd() + "\n" + entryText : entryText;
                      const newLineIndex = updated.split("\n").lastIndexOf(entryText);
                      await dbSave(todayStr, 'journal', updated, token);
                      MEM[`${userId}:${todayStr}:journal`] = updated;
                      window.dispatchEvent(new CustomEvent('daylab:refresh', { detail: { types: ['journal'] } }));
                      setEntries(prev => prev ? {
                        ...prev,
                        journalEntries: [...(prev.journalEntries||[]), { date: todayStr, lineIndex: newLineIndex, text: entryText }],
                      } : prev);
                    }} placeholder="Add a health journal entry…" />
                  )}
                  {lines.map((entry, i) => (
                    <div key={i} style={{fontFamily:serif,fontSize:F.md,lineHeight:'1.7',color:C.text,padding:'1px 0'}}>
                      <RichLine text={entry.text}/>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })()}
    </Card>
  );

  const mealsWidget = (
    <Card label="Meals" color={C.red} autoHeight collapsed={mealsCollapsed} onToggle={toggleMeals}
      headerRight={<span style={{display:'flex',gap:0}}>
        <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:'0.06em',textTransform:'uppercase',color:C.dim,width:50,textAlign:'center'}}>prot</span>
        <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:'0.06em',textTransform:'uppercase',color:C.dim,width:72,textAlign:'center'}}>energy</span>
      </span>}
    >
      <HealthAllMeals token={token} userId={userId} onSelectDate={onSelectDate} onBack={onBack} />
    </Card>
  );

  const activitiesWidget = (
    <Card label="Workouts" color={C.green} autoHeight collapsed={activitiesCollapsed} onToggle={toggleActivities}
      headerRight={<span style={{display:'flex',gap:0}}>
        <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:'0.06em',textTransform:'uppercase',color:C.dim,width:60,textAlign:'center'}}>dist</span>
        <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:'0.06em',textTransform:'uppercase',color:C.dim,width:100,textAlign:'center'}}>pace</span>
        <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:'0.06em',textTransform:'uppercase',color:C.dim,width:72,textAlign:'center'}}>energy</span>
      </span>}
    >
      <HealthAllActivities token={token} userId={userId} onSelectDate={onSelectDate} onBack={onBack} />
    </Card>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10, paddingBottom:200,
      maxWidth:1200, width:'100%', margin:'0 auto', boxSizing:'border-box' }}>
      {/* Health strip — collapsible */}
      <HealthCard
        date={today} token={token} userId={userId}
        onHealthChange={onHealthChange || (()=>{})}
        onScoresReady={onScoresReady || (()=>{})}
        onSyncStart={startSync || (()=>{})}
        onSyncEnd={endSync || (()=>{})}
        collapsed={healthCollapsed} onToggle={toggleHealth}
      />

      {/* Wide: two-column layout 50/50; narrow: single column */}
      {wide ? (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, alignItems:'start' }}>
          {/* Left col: Tasks, Entries */}
          <div style={{ display:'flex', flexDirection:'column', gap:10, minWidth:0 }}>
            {tasksWidget}
            {entriesWidget}
          </div>
          {/* Right col: Meals, Workouts */}
          <div style={{ display:'flex', flexDirection:'column', gap:10, minWidth:0 }}>
            {mealsWidget}
            {activitiesWidget}
          </div>
        </div>
      ) : (
        <>
          {tasksWidget}
          {entriesWidget}
          {mealsWidget}
          {activitiesWidget}
        </>
      )}
    </div>
  );
}

// ─── EntryLine — stable-height edit line for ProjectView ─────────────────────
