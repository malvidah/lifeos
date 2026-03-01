"use client";
import { useState, useEffect, useRef, useCallback } from "react";

// ─── AI helper ────────────────────────────────────────────────────────────────
async function ai(prompt, system = "") {
  const body = { model: "claude-sonnet-4-20250514", max_tokens: 512, messages: [{ role: "user", content: prompt }] };
  if (system) body.system = system;
  const r = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json();
  return d.content?.filter(b => b.type === "text").map(b => b.text).join("") || "";
}
function parseJSON(text, fallback) {
  try { const m = text.match(/[\[{][\s\S]*[\]}]/); return m ? JSON.parse(m[0]) : fallback; }
  catch { return fallback; }
}

// ─── Database helpers (via /api/entries) ─────────────────────────────────────
async function dbSave(date, type, data) {
  try {
    await fetch("/api/entries", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, type, data }),
    });
  } catch (e) { console.warn("db save failed", e); }
}
async function dbLoad(date, type) {
  try {
    const r = await fetch(`/api/entries?date=${date}&type=${type}`);
    const json = await r.json();
    return json.data ?? null;
  } catch { return null; }
}

// In-memory cache for instant navigation
const cache = {};
function cacheSet(k, v) { cache[k] = v; }
function cacheGet(k) { return Object.prototype.hasOwnProperty.call(cache, k) ? cache[k] : undefined; }

// ─── Date utils ───────────────────────────────────────────────────────────────
const toKey = d => new Date(d).toISOString().split("T")[0];
const todayKey = () => toKey(new Date());
const shift = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const DAY3 = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const MON3 = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function weekOf(anchor) {
  const d = new Date(anchor);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => shift(d, i));
}

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg: "#0A0A0A", panel: "#101010", border: "#191919", border2: "#222",
  text: "#DDD8D0", dim: "#4A4744", dimmer: "#282624", accent: "#B8A882",
  green: "#5A9470", blue: "#4A7A9B", yellow: "#A8864A", red: "#9B4A4A",
};
const serif = "Georgia, 'Times New Roman', serif";
const mono = "'SF Mono', ui-monospace, monospace";

// ─── DB autosave hook ─────────────────────────────────────────────────────────
function useDbSave(date, type, initialValue) {
  const ck = `${date}:${type}`;
  const [value, setValueState] = useState(() => {
    const c = cacheGet(ck);
    return c !== undefined ? c : initialValue;
  });
  const [loaded, setLoaded] = useState(() => cacheGet(ck) !== undefined);
  const latestRef = useRef(value);
  const dateRef = useRef(date);
  const timerRef = useRef(null);
  latestRef.current = value;

  useEffect(() => {
    const newCk = `${date}:${type}`;
    dateRef.current = date;
    const cached = cacheGet(newCk);
    if (cached !== undefined) {
      setValueState(cached);
      latestRef.current = cached;
      setLoaded(true);
      return;
    }
    setLoaded(false);
    dbLoad(date, type).then(data => {
      const v = data ?? initialValue;
      cacheSet(newCk, v);
      setValueState(v);
      latestRef.current = v;
      setLoaded(true);
    });
  }, [date, type]);

  const setValue = useCallback((v) => {
    const val = typeof v === "function" ? v(latestRef.current) : v;
    setValueState(val);
    latestRef.current = val;
    cacheSet(`${dateRef.current}:${type}`, val);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => dbSave(dateRef.current, type, latestRef.current), 800);
  }, [type]);

  useEffect(() => {
    const flush = () => { clearTimeout(timerRef.current); dbSave(dateRef.current, type, latestRef.current); };
    window.addEventListener("beforeunload", flush);
    window.addEventListener("visibilitychange", () => { if (document.hidden) flush(); });
    return () => window.removeEventListener("beforeunload", flush);
  }, [type]);

  return { value, setValue, loaded };
}

// ─── Drag reorder ─────────────────────────────────────────────────────────────
function useDrag(initial) {
  const [order, setOrder] = useState(initial);
  const from = useRef(null);
  const drag = i => ({
    draggable: true,
    onDragStart: () => { from.current = i; },
    onDragOver: e => e.preventDefault(),
    onDrop: () => {
      if (from.current === null || from.current === i) return;
      setOrder(o => { const n=[...o]; const [m]=n.splice(from.current,1); n.splice(i,0,m); return n; });
      from.current = null;
    },
  });
  return { order, drag };
}

// ─── Score ring ───────────────────────────────────────────────────────────────
function Ring({ score, color, size = 44 }) {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const val = parseFloat(score) || 0;
  const pct = Math.min(Math.max(val / 100, 0), 1);
  const isElite = val >= 90;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
      <circle cx={size/2} cy={size/2} r={r} fill={isElite ? color+"22" : "none"} stroke={C.dimmer} strokeWidth={3}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={isElite ? 4 : 3}
        strokeDasharray={`${pct*circ} ${circ}`} strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.4s ease" }}/>
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central"
        style={{ fill: isElite ? color : score ? C.text : C.dim, fontSize: 10, fontFamily: serif,
          fontWeight: isElite ? "bold" : "normal",
          transform: "rotate(90deg)", transformOrigin: `${size/2}px ${size/2}px` }}>
        {score || "—"}
      </text>
    </svg>
  );
}

// ─── Widget shell ─────────────────────────────────────────────────────────────
function Widget({ label, color, drag, children }) {
  return (
    <div style={{ background:C.panel, border:`1px solid ${C.border}`, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      <div {...drag} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px",
        borderBottom:`1px solid ${C.border}`, borderTop:`2px solid ${color}`, cursor:"grab", userSelect:"none" }}>
        <span style={{ color:C.dimmer, fontSize:11 }}>⠿</span>
        <span style={{ fontFamily:mono, fontSize:9, letterSpacing:"0.25em", textTransform:"uppercase", color }}>{label}</span>
      </div>
      <div style={{ flex:1, overflow:"auto", padding:12 }}>{children}</div>
    </div>
  );
}

// ─── Calendar strip ───────────────────────────────────────────────────────────
function CalStrip({ selected, onSelect, events, syncStatus, healthDots }) {
  const initAnchor = () => {
    const d = new Date();
    if (d.getDay() === 0) d.setDate(d.getDate() + 1);
    return d;
  };
  const [anchor, setAnchor] = useState(initAnchor);
  const days = weekOf(anchor);
  const today = todayKey();
  const months = [...new Set(days.map(d => MON3[d.getMonth()]))].join(" · ");
  const year = days[0].getFullYear();

  // Sync indicator: "syncing" if any syncing, else last sync time or "● synced"
  const syncLabel = syncStatus.syncing
    ? "syncing…"
    : syncStatus.lastSync
      ? `● ${syncStatus.lastSync}`
      : "● synced";

  return (
    <div style={{ background:C.panel, borderBottom:`1px solid ${C.border}` }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 12px 8px", borderBottom:`1px solid ${C.border}` }}>
        <div style={{ fontFamily:serif, fontSize:20, color:C.text, letterSpacing:"-0.02em", lineHeight:1 }}>
          {months} <span style={{ color:C.dim, fontSize:15 }}>{year}</span>
        </div>
        <div style={{ flex:1 }}/>
        <span style={{ fontFamily:mono, fontSize:8, color:syncStatus.syncing ? C.dimmer : C.green, letterSpacing:"0.08em", whiteSpace:"nowrap" }}>
          {syncLabel}
        </span>
        {[["‹", () => setAnchor(d => shift(d,-7))], ["today", () => { setAnchor(new Date()); onSelect(todayKey()); }], ["›", () => setAnchor(d => shift(d,7))]].map(([l,fn]) => (
          <button key={l} onClick={fn} style={{
            background:"none", border:`1px solid ${C.border2}`, color:C.dim,
            padding: l==="today" ? "3px 7px" : "3px 6px", cursor:"pointer", fontFamily:mono,
            fontSize: l==="today" ? 8 : 12, letterSpacing: l==="today" ? "0.1em" : 0,
          }}>{l}</button>
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(7, 1fr)" }}>
        {days.map((d, i) => {
          const k = toKey(d);
          const isTod = k === today;
          const isSel = k === selected;
          const evts = (events[k]||[]).slice().sort((a,b)=>(a.time||"").localeCompare(b.time||""));
          const dot = healthDots[k] || {};
          return (
            <div key={k} onClick={() => onSelect(k)} style={{
              borderRight: i<6 ? `1px solid ${C.border}` : "none",
              background: isSel ? "#FFFFFF05" : "transparent", cursor:"pointer",
            }}>
              <div style={{
                padding:"6px 6px 3px", borderBottom:`1px solid ${C.border}`,
                borderTop: isSel ? `2px solid ${C.accent}` : isTod ? `2px solid ${C.dim}` : `2px solid transparent`,
                display:"flex", flexDirection:"column", alignItems:"center", gap:1,
              }}>
                <span style={{ fontFamily:mono, fontSize:7, color: isSel ? C.accent : C.dimmer }}>{DAY3[i]}</span>
                <span style={{ fontFamily:serif, fontSize:14, lineHeight:1, color: isTod ? C.accent : isSel ? C.text : C.dim }}>{d.getDate()}</span>
                <div style={{ display:"flex", gap:2, height:4, alignItems:"center" }}>
                  {dot.sleep >= 90 && <span style={{ width:3,height:3,borderRadius:"50%",background:C.blue,display:"inline-block" }}/>}
                  {dot.readiness >= 90 && <span style={{ width:3,height:3,borderRadius:"50%",background:C.green,display:"inline-block" }}/>}
                  {dot.strain >= 90 && <span style={{ width:3,height:3,borderRadius:"50%",background:C.yellow,display:"inline-block" }}/>}
                </div>
              </div>
              <div style={{ padding:"3px 4px", display:"flex", flexDirection:"column", gap:2, minHeight:52 }}>
                {evts.length === 0 && <span style={{ fontFamily:mono, fontSize:7, color:C.dimmer }}>—</span>}
                {evts.map((ev,ei) => (
                  <div key={ei} style={{ borderLeft:`2px solid ${ev.color||C.accent}`, paddingLeft:3 }}>
                    <div style={{ fontFamily:mono, fontSize:7, color:C.dim }}>{ev.time}</div>
                    <div style={{ fontFamily:serif, fontSize:9, color: isSel ? C.text : C.dim, lineHeight:1.3, wordBreak:"break-word" }}>{ev.title}</div>
                    {ev.zoomUrl && <a href={ev.zoomUrl} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{ fontFamily:mono, fontSize:7, color:C.blue }}>JOIN ↗</a>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Health strip ─────────────────────────────────────────────────────────────
function HealthStrip({ date, onHealthChange, onSyncStart, onSyncEnd }) {
  const empty = { sleepScore:"", sleepHrs:"", sleepQuality:"", readinessScore:"", hrv:"", rhr:"", strainScore:"", strainNote:"" };
  const { value: d, setValue: setD, loaded } = useDbSave(date, "health", empty);
  const set = k => v => setD(prev => ({ ...prev, [k]: v }));

  useEffect(() => { if (loaded) onHealthChange(date, d); }, [d, loaded]);

  // Auto-sync Oura when date loads
  useEffect(() => {
    if (!loaded) return;
    onSyncStart("oura");
    fetch(`/api/oura?date=${date}`)
      .then(r => r.json())
      .then(data => {
        if (!data.error) {
          setD(prev => ({ ...prev,
            sleepScore:     data.sleepScore     || prev.sleepScore,
            sleepHrs:       data.sleepHrs       || prev.sleepHrs,
            sleepQuality:   data.sleepQuality   || prev.sleepQuality,
            readinessScore: data.readinessScore || prev.readinessScore,
            hrv:            data.hrv            || prev.hrv,
            rhr:            data.rhr            || prev.rhr,
          }));
        }
      })
      .catch(e => console.warn("oura sync failed", e))
      .finally(() => onSyncEnd("oura"));
  }, [date, loaded]);

  const metrics = [
    { key:"sleep",     label:"Sleep",     color:C.blue,   score:d.sleepScore,     setScore:set("sleepScore"),
      fields:[{label:"Hrs",value:d.sleepHrs,set:set("sleepHrs"),unit:"h"},{label:"Eff",value:d.sleepQuality,set:set("sleepQuality"),unit:"%"}] },
    { key:"readiness", label:"Readiness", color:C.green,  score:d.readinessScore, setScore:set("readinessScore"),
      fields:[{label:"HRV",value:d.hrv,set:set("hrv"),unit:"ms"},{label:"RHR",value:d.rhr,set:set("rhr"),unit:"bpm"}] },
    { key:"strain",    label:"Strain",    color:C.yellow, score:d.strainScore,    setScore:set("strainScore"),
      fields:[{label:"Note",value:d.strainNote,set:set("strainNote"),unit:""}] },
  ];

  return (
    <div style={{ background:C.panel, borderBottom:`1px solid ${C.border}`, overflowX:"auto" }}>
      <div style={{ display:"flex", minWidth:280 }}>
        {metrics.map((m, mi) => (
          <div key={m.key} style={{
            flex:"1 1 0", display:"flex", alignItems:"center", gap:10,
            padding:"10px 12px", borderRight: mi<2 ? `1px solid ${C.border}` : "none", minWidth:90,
          }}>
            <div style={{ position:"relative", flexShrink:0 }}>
              <Ring score={m.score} color={m.color} size={44}/>
              <input value={m.score} onChange={e => m.setScore(e.target.value)}
                style={{ position:"absolute",inset:0,background:"transparent",border:"none",outline:"none",
                  textAlign:"center",color:"transparent",cursor:"text",width:"100%",fontSize:16 }}/>
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontFamily:mono, fontSize:8, letterSpacing:"0.18em", textTransform:"uppercase", color:m.color, marginBottom:5 }}>{m.label}</div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                {m.fields.map(f => (
                  <div key={f.label}>
                    <div style={{ fontFamily:mono, fontSize:7, textTransform:"uppercase", color:C.dim, marginBottom:1 }}>{f.label}</div>
                    <div style={{ display:"flex", alignItems:"baseline", gap:2 }}>
                      <input value={f.value} onChange={e => f.set(e.target.value)} placeholder="—"
                        style={{ background:"transparent",border:"none",outline:"none",
                          color:f.value?C.text:C.dim, fontFamily:serif, fontSize:14, width:34, padding:0,
                          // prevent iOS zoom (font-size >= 16 on the hidden score input, but these are visible)
                        }}/>
                      {f.unit && <span style={{ fontFamily:mono, fontSize:7, color:C.dim }}>{f.unit}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Notes ────────────────────────────────────────────────────────────────────
function Notes({ date }) {
  const { value:text, setValue:setText, loaded } = useDbSave(date, "notes", "");
  return (
    <textarea value={text} onChange={e => setText(e.target.value)}
      placeholder={loaded ? "Write anything…" : "Loading…"} disabled={!loaded}
      style={{ background:"transparent",border:"none",outline:"none",resize:"none",
        color:C.text,fontFamily:serif,fontSize:16,lineHeight:1.8,
        width:"100%",height:"100%",minHeight:180,padding:0,opacity:loaded?1:0.4 }}
    />
  );
}

// ─── Row list (Meals + Activity) ──────────────────────────────────────────────
function RowList({ date, type, placeholder, estimatePrompt, calLabel, accentColor }) {
  const emptyRows = () => [{ id: Date.now(), text:"", kcal:null }];
  const { value:rows, setValue:setRows, loaded } = useDbSave(date, type, emptyRows());
  const refs = useRef({});
  const safeRows = Array.isArray(rows) ? rows : emptyRows();
  const total = safeRows.reduce((s,r) => s+(r.kcal||0), 0);

  async function estimate(id, text) {
    if (!text.trim()) return;
    setRows(safeRows.map(r => r.id===id ? {...r,estimating:true} : r));
    try {
      const resp = await ai(estimatePrompt(text), "Return only JSON with kcal field.");
      const { kcal } = parseJSON(resp, { kcal:null });
      setRows(safeRows.map(r => r.id===id ? {...r,kcal:kcal||null,estimating:false} : r));
    } catch { setRows(safeRows.map(r => r.id===id ? {...r,estimating:false} : r)); }
  }

  function handleKey(e, id, idx) {
    if (e.key==="Enter") {
      e.preventDefault();
      const newId = Date.now();
      setRows([...safeRows.slice(0,idx+1),{id:newId,text:"",kcal:null},...safeRows.slice(idx+1)]);
      setTimeout(() => refs.current[newId]?.focus(), 30);
    }
    if (e.key==="Backspace" && safeRows[idx].text==="" && safeRows.length>1) {
      e.preventDefault();
      setRows(safeRows.filter(r => r.id!==id));
      const prevId = safeRows[idx-1]?.id || safeRows[idx+1]?.id;
      setTimeout(() => refs.current[prevId]?.focus(), 30);
    }
  }

  if (!loaded) return <div style={{ fontFamily:mono, fontSize:9, color:C.dimmer }}>Loading…</div>;
  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
      {total > 0 && (
        <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:6 }}>
          <span style={{ fontFamily:mono, fontSize:11, color:accentColor }}>{calLabel}{total} kcal</span>
        </div>
      )}
      {safeRows.map((row, idx) => (
        <div key={row.id} style={{ display:"flex", alignItems:"baseline", gap:8, padding:"2px 0", minHeight:26 }}>
          <input ref={el => refs.current[row.id]=el}
            value={row.text}
            onChange={e => setRows(safeRows.map(r => r.id===row.id ? {...r,text:e.target.value,kcal:null} : r))}
            onBlur={e => { const r=safeRows.find(r=>r.id===row.id); if(e.target.value.trim()&&r&&r.kcal===null&&!r.estimating) estimate(row.id,e.target.value); }}
            onKeyDown={e => handleKey(e,row.id,idx)}
            placeholder={idx===0 ? placeholder : ""}
            style={{ background:"transparent",border:"none",outline:"none",color:row.text?C.text:C.dim,
              fontFamily:serif,fontSize:16,flex:1,padding:0,lineHeight:1.7 }}
          />
          <span style={{ fontFamily:mono,fontSize:10,color:accentColor,flexShrink:0,minWidth:38,textAlign:"right" }}>
            {row.estimating ? "…" : row.kcal ? `${calLabel}${row.kcal}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function Meals({ date }) {
  return <RowList date={date} type="meals" placeholder="What did you eat?"
    estimatePrompt={t=>`Calories in: "${t}". JSON: {"kcal":420}`} calLabel="" accentColor={C.accent}/>;
}
function Activity({ date }) {
  return <RowList date={date} type="activity" placeholder="What did you do?"
    estimatePrompt={t=>`Calories burned doing: "${t}" for a typical adult. JSON: {"kcal":300}`} calLabel="−" accentColor={C.green}/>;
}

// ─── Tasks ────────────────────────────────────────────────────────────────────
function Tasks({ date, calTasks }) {
  const emptyRows = () => [{ id:Date.now(), text:"", done:false, fromCal:false }];
  const { value:rows, setValue:setRows, loaded } = useDbSave(date, "tasks", emptyRows());
  const refs = useRef({});
  const safeRows = Array.isArray(rows) ? rows : emptyRows();

  useEffect(() => {
    if (!loaded||!calTasks?.length) return;
    const existing = new Set(safeRows.filter(r=>r.fromCal).map(r=>r.text));
    const novel = calTasks.filter(t=>!existing.has(t));
    if (novel.length) setRows([...novel.map((t,i)=>({id:`c${Date.now()}${i}`,text:t,done:false,fromCal:true})),...safeRows]);
  }, [calTasks,loaded]);

  function handleKey(e, id, idx) {
    if (e.key==="Enter") {
      e.preventDefault();
      const newId = Date.now();
      setRows([...safeRows.slice(0,idx+1),{id:newId,text:"",done:false,fromCal:false},...safeRows.slice(idx+1)]);
      setTimeout(() => refs.current[newId]?.focus(), 30);
    }
    if (e.key==="Backspace"&&safeRows[idx].text===""&&safeRows.length>1) {
      e.preventDefault();
      setRows(safeRows.filter(r=>r.id!==id));
      const prev=safeRows[idx-1]?.id;
      if(prev) setTimeout(()=>refs.current[prev]?.focus(),30);
    }
  }

  if (!loaded) return <div style={{ fontFamily:mono, fontSize:9, color:C.dimmer }}>Loading…</div>;
  const open = safeRows.filter(r=>!r.done);
  const done = safeRows.filter(r=>r.done);

  return (
    <div style={{ flex:1, overflow:"auto" }}>
      {[...open,...done].map((row,idx) => (
        <div key={row.id} style={{ display:"flex",alignItems:"center",gap:8,padding:"4px 0",minHeight:26,opacity:row.done?0.33:1 }}>
          <button onClick={() => setRows(safeRows.map(r=>r.id===row.id?{...r,done:!r.done}:r))} style={{
            width:13,height:13,flexShrink:0,borderRadius:2,
            border:`1px solid ${row.done?C.accent:C.border2}`,background:row.done?C.accent:"transparent",
            cursor:"pointer",padding:0,display:"flex",alignItems:"center",justifyContent:"center",
          }}>
            {row.done&&<span style={{ fontSize:8,color:C.bg }}>✓</span>}
          </button>
          <input ref={el=>refs.current[row.id]=el}
            value={row.text}
            onChange={e=>setRows(safeRows.map(r=>r.id===row.id?{...r,text:e.target.value}:r))}
            onKeyDown={e=>handleKey(e,row.id,idx)}
            placeholder={idx===0&&open.length===1&&!row.text?"Task · Enter for new line":""}
            style={{ background:"transparent",border:"none",outline:"none",
              color:row.done?C.dim:C.text,fontFamily:serif,fontSize:16,flex:1,padding:0,lineHeight:1.7,
              textDecoration:row.done?"line-through":"none" }}
          />
          {row.fromCal&&<span style={{ fontFamily:mono,fontSize:7,color:C.dimmer }}>●</span>}
        </div>
      ))}
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
const WIDS = ["notes","meals","tasks","activity"];
const WCFG = {
  notes:    { label:"Notes",    color:C.accent },
  meals:    { label:"Meals",    color:C.red    },
  tasks:    { label:"Tasks",    color:C.blue   },
  activity: { label:"Activity", color:C.green  },
};
const WMAP = { notes:Notes, meals:Meals, tasks:Tasks, activity:Activity };

export default function Dashboard() {
  const initSelected = () => {
    const d = new Date();
    if (d.getDay()===0) return toKey(shift(d,1));
    return todayKey();
  };
  const [selected, setSelected] = useState(initSelected);
  const [events, setEvents] = useState({});
  const [calTasks, setCalTasks] = useState([]);
  const [healthDots, setHealthDots] = useState({});
  const { order, drag } = useDrag(WIDS);

  // Unified sync state: tracks what's currently syncing
  const [syncing, setSyncing] = useState(new Set());
  const [lastSync, setLastSync] = useState(null);

  const onSyncStart = useCallback((key) => setSyncing(s => new Set([...s, key])), []);
  const onSyncEnd = useCallback((key) => {
    setSyncing(s => { const n=new Set(s); n.delete(key); return n; });
    setLastSync(new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }));
  }, []);

  const syncStatus = {
    syncing: syncing.size > 0,
    lastSync,
  };

  // Auto-sync Google Calendar on load (token stored in DB)
  useEffect(() => {
    dbLoad("global","tokens").then(t => {
      if (!t?.gcal) return;
      onSyncStart("cal");
      fetch("/api/calendar", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ token:t.gcal, start:toKey(shift(new Date(),-7)), end:toKey(shift(new Date(),21)) }),
      })
        .then(r=>r.json())
        .then(data => { if(data.events) setEvents(data.events); })
        .catch(e=>console.warn("cal sync failed",e))
        .finally(()=>onSyncEnd("cal"));
    });
  }, []);

  const handleHealthChange = useCallback((date, data) => {
    setHealthDots(prev => ({
      ...prev,
      [date]: { sleep:+data.sleepScore||0, readiness:+data.readinessScore||0, strain:+data.strainScore||0 }
    }));
  }, []);

  return (
    <div style={{ background:C.bg, minHeight:"100vh", color:C.text, display:"flex", flexDirection:"column" }}>
      <style>{`
        * { box-sizing:border-box; margin:0; padding:0; }
        ::-webkit-scrollbar { width:3px; height:3px; }
        ::-webkit-scrollbar-thumb { background:#222; }
        button { border-radius:0; }
        input::placeholder, textarea::placeholder { color:${C.dim}; opacity:1; }
        a { text-decoration:none; }
        /* Prevent iOS zoom on input focus — keep font-size >= 16px on all inputs */
        input, textarea, select { font-size:16px; }
        @media (max-width:600px) {
          .widget-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <CalStrip
        selected={selected} onSelect={setSelected}
        events={events} syncStatus={syncStatus} healthDots={healthDots}
      />

      <HealthStrip
        date={selected}
        onHealthChange={handleHealthChange}
        onSyncStart={onSyncStart}
        onSyncEnd={onSyncEnd}
      />

      <div className="widget-grid" style={{
        flex:1, display:"grid", gridTemplateColumns:"1fr 1fr",
        gridAutoRows:"minmax(220px, auto)", gap:1, padding:1, background:C.border,
      }}>
        {order.map((id,i) => {
          const cfg=WCFG[id]; const W=WMAP[id];
          return (
            <Widget key={id} label={cfg.label} color={cfg.color} drag={drag(i)}>
              <W date={selected} calTasks={id==="tasks"?calTasks:undefined}/>
            </Widget>
          );
        })}
      </div>
    </div>
  );
}
