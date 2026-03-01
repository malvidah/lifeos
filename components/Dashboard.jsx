"use client";
import { useState, useEffect, useRef, useCallback } from "react";

// ─── API ──────────────────────────────────────────────────────────────────────
const MODEL = "claude-sonnet-4-20250514";

// All AI calls go through our server proxy — keeps API key safe, works anywhere
async function ai(prompt, system = "") {
  const body = { model: MODEL, max_tokens: 512, messages: [{ role: "user", content: prompt }] };
  if (system) body.system = system;
  const r = await fetch("/api/ai", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const d = await r.json();
  return d.content?.filter(b => b.type === "text").map(b => b.text).join("") || "";
}

function parseJSON(text, fallback) {
  try { const m = text.match(/[\[{][\s\S]*[\]}]/); return m ? JSON.parse(m[0]) : fallback; }
  catch { return fallback; }
}

// ─── STORAGE — localStorage (persists on this device, no server needed) ───────
function persist(date, type, data) {
  try { localStorage.setItem(`los:${date}:${type}`, JSON.stringify(data)); } 
  catch (e) { console.warn("save err", e); }
}
function recall(date, type) {
  try { 
    const v = localStorage.getItem(`los:${date}:${type}`);
    return Promise.resolve(v ? JSON.parse(v) : null);
  } catch { return Promise.resolve(null); }
}

// ─── DATE ─────────────────────────────────────────────────────────────────────
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

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
const C = {
  bg: "#0A0A0A", panel: "#101010", border: "#191919", border2: "#222",
  text: "#DDD8D0", dim: "#4A4744", dimmer: "#282624", accent: "#B8A882",
  green: "#5A9470", blue: "#4A7A9B", yellow: "#A8864A", red: "#9B4A4A",
};
const serif = "Georgia, 'Times New Roman', serif";
const mono = "'SF Mono', ui-monospace, monospace";

// ─── SAFE AUTOSAVE HOOK ───────────────────────────────────────────────────────
function useAutosave(date, type, initialValue) {
  const [value, setValueState] = useState(() => {
    // Load synchronously on first render — localStorage is sync
    try {
      const v = localStorage.getItem(`los:${date}:${type}`);
      return v ? JSON.parse(v) : initialValue;
    } catch { return initialValue; }
  });
  const [loaded, setLoaded] = useState(true);
  const latestRef = useRef(value);
  const dateRef = useRef(date);
  latestRef.current = value;

  // When date changes: save current, load new
  useEffect(() => {
    if (dateRef.current !== date) {
      persist(dateRef.current, type, latestRef.current);
      dateRef.current = date;
      try {
        const v = localStorage.getItem(`los:${date}:${type}`);
        setValueState(v ? JSON.parse(v) : initialValue);
      } catch { setValueState(initialValue); }
    }
  }, [date, type, initialValue]);

  const timerRef = useRef(null);
  const setValue = useCallback((v) => {
    setValueState(v);
    latestRef.current = v;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      persist(dateRef.current, type, latestRef.current);
    }, 400);
  }, [type]);

  // Save on unmount and page hide
  useEffect(() => {
    const flush = () => persist(dateRef.current, type, latestRef.current);
    window.addEventListener("beforeunload", flush);
    window.addEventListener("visibilitychange", () => { if (document.hidden) flush(); });
    return () => { flush(); window.removeEventListener("beforeunload", flush); };
  }, [type]);

  return { value, setValue, loaded };
}

// ─── DRAG REORDER ─────────────────────────────────────────────────────────────
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

// ─── SCORE RING ───────────────────────────────────────────────────────────────
function Ring({ score, color, size = 52 }) {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(Math.max((parseFloat(score) || 0) / 100, 0), 1);
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.dimmer} strokeWidth={3}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={3}
        strokeDasharray={`${pct * circ} ${circ}`} strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.4s ease" }}/>
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central"
        style={{ fill: score ? C.text : C.dim, fontSize: 12, fontFamily: serif,
          transform: "rotate(90deg)", transformOrigin: `${size/2}px ${size/2}px` }}>
        {score || "—"}
      </text>
    </svg>
  );
}

// ─── WIDGET SHELL ─────────────────────────────────────────────────────────────
function Widget({ label, color, drag, children }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div {...drag} style={{
        display: "flex", alignItems: "center", gap: 8, padding: "8px 14px",
        borderBottom: `1px solid ${C.border}`, borderTop: `2px solid ${color}`,
        cursor: "grab", userSelect: "none",
      }}>
        <span style={{ color: C.dimmer, fontSize: 12 }}>⠿</span>
        <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.28em", textTransform: "uppercase", color }}>{label}</span>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 14 }}>{children}</div>
    </div>
  );
}

function CalStrip({ selected, onSelect, events, syncing }) {
  // If today is Sunday (last col), start anchor on tomorrow so the active week shows
  const initAnchor = () => {
    const d = new Date();
    if (d.getDay() === 0) d.setDate(d.getDate() + 1); // Sunday → start Mon of next week
    return d;
  };
  const [anchor, setAnchor] = useState(initAnchor);
  const days = weekOf(anchor);
  const today = todayKey();
  const months = [...new Set(days.map(d => MON3[d.getMonth()]))].join(" · ");

  return (
    <div style={{ background: C.panel, borderBottom: `1px solid ${C.border}` }}>
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", padding: "12px 16px 10px", gap: 12, borderBottom: `1px solid ${C.border}` }}>
        <div>
          <div style={{ fontFamily: mono, fontSize: 8, letterSpacing: "0.3em", textTransform: "uppercase", color: C.dim, marginBottom: 2 }}>Life OS</div>
          <div style={{ fontFamily: serif, fontSize: 18, color: C.text, letterSpacing: "-0.02em" }}>
            {months} <span style={{ color: C.dim, fontSize: 14 }}>{days[0].getFullYear()}</span>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ fontFamily: mono, fontSize: 8, color: syncing ? C.dimmer : C.green, letterSpacing: "0.1em" }}>
          {syncing ? "syncing…" : "● synced"}
        </div>
        <div style={{ display: "flex", gap: 3 }}>
          {[["‹", () => setAnchor(d => shift(d,-7))], ["today", () => { setAnchor(new Date()); onSelect(todayKey()); }], ["›", () => setAnchor(d => shift(d,7))]].map(([l,fn]) => (
            <button key={l} onClick={fn} style={{
              background: "none", border: `1px solid ${C.border2}`, color: C.dim,
              padding: "3px 8px", cursor: "pointer", fontFamily: mono,
              fontSize: l==="today" ? 8 : 13, letterSpacing: l==="today" ? "0.1em" : 0,
            }}>{l}</button>
          ))}
        </div>
      </div>

      {/* Week grid — 7 columns, each showing day header + all events */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: `1px solid ${C.border}` }}>
        {days.map((d, i) => {
          const k = toKey(d);
          const isTod = k === today;
          const isSel = k === selected;
          const evts = (events[k] || []).slice().sort((a,b) => (a.time||"").localeCompare(b.time||""));

          return (
            <div
              key={k}
              onClick={() => onSelect(k)}
              style={{
                borderRight: i < 6 ? `1px solid ${C.border}` : "none",
                background: isSel ? "#FFFFFF05" : "transparent",
                cursor: "pointer", minHeight: 120,
              }}
            >
              {/* Day header */}
              <div style={{
                padding: "8px 10px 6px",
                borderBottom: `1px solid ${C.border}`,
                borderTop: isSel ? `2px solid ${C.accent}` : isTod ? `2px solid ${C.dim}` : `2px solid transparent`,
                display: "flex", alignItems: "baseline", gap: 5,
              }}>
                <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: "0.15em", color: isSel ? C.accent : C.dimmer }}>
                  {DAY3[i]}
                </span>
                <span style={{ fontFamily: serif, fontSize: 17, lineHeight: 1, color: isTod ? C.accent : isSel ? C.text : C.dim }}>
                  {d.getDate()}
                </span>
              </div>

              {/* Events list */}
              <div style={{ padding: "5px 6px", display: "flex", flexDirection: "column", gap: 3 }}>
                {evts.length === 0 && (
                  <span style={{ fontFamily: mono, fontSize: 8, color: C.dimmer, padding: "2px 0" }}>—</span>
                )}
                {evts.map((ev, ei) => (
                  <div key={ei} style={{
                    borderLeft: `2px solid ${ev.color || C.accent}`,
                    paddingLeft: 5, paddingTop: 2, paddingBottom: 2,
                  }}>
                    <div style={{ fontFamily: mono, fontSize: 8, color: C.dim, lineHeight: 1.3 }}>{ev.time}</div>
                    <div style={{ fontFamily: serif, fontSize: 11, color: isSel ? C.text : C.dim, lineHeight: 1.3, wordBreak: "break-word" }}>
                      {ev.title}
                    </div>
                    {ev.zoomUrl && (
                      <a href={ev.zoomUrl} target="_blank" rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                        style={{ fontFamily: mono, fontSize: 7, color: C.blue, letterSpacing: "0.1em", textDecoration: "none" }}>
                        JOIN ↗
                      </a>
                    )}
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

// ─── HEALTH STRIP ─────────────────────────────────────────────────────────────
function HealthStrip({ date }) {
  const empty = { sleepScore:"", sleepHrs:"", sleepQuality:"", readinessScore:"", hrv:"", rhr:"", strainScore:"", strainNote:"" };
  const { value: d, setValue: setD, loaded } = useAutosave(date, "health", empty);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [ouraAvail, setOuraAvail] = useState(true);
  const isToday = date === todayKey();

  const set = key => val => setD({ ...d, [key]: val });

  // Oura sync via server route (OURA_TOKEN env var stays server-side)
  async function syncOura() {
    setSyncing(true);
    try {
      const r = await fetch(`/api/oura?date=${date}`);
      const data = await r.json();
      if (data.error) { setOuraAvail(false); return; }
      setOuraAvail(true);
      setD(prev => ({ ...prev,
        sleepScore:     data.sleepScore     || prev.sleepScore,
        sleepHrs:       data.sleepHrs       || prev.sleepHrs,
        sleepQuality:   data.sleepQuality   || prev.sleepQuality,
        readinessScore: data.readinessScore || prev.readinessScore,
        hrv:            data.hrv            || prev.hrv,
        rhr:            data.rhr            || prev.rhr,
      }));
      setLastSync(new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }));
    } catch (e) { console.warn("Oura sync failed", e); }
    finally { setSyncing(false); }
  }

  useEffect(() => {
    if (loaded) syncOura();
  }, [date, loaded]);

  const metrics = [
    { key:"sleep",     label:"Sleep",     color:C.blue,   score:d.sleepScore,     setScore:set("sleepScore"),
      fields:[{label:"Hours",value:d.sleepHrs,onChange:set("sleepHrs"),unit:"h"},{label:"Efficiency",value:d.sleepQuality,onChange:set("sleepQuality"),unit:"%"}] },
    { key:"readiness", label:"Readiness", color:C.green,  score:d.readinessScore, setScore:set("readinessScore"),
      fields:[{label:"HRV",value:d.hrv,onChange:set("hrv"),unit:"ms"},{label:"Resting HR",value:d.rhr,onChange:set("rhr"),unit:"bpm"}] },
    { key:"strain",    label:"Strain",    color:C.yellow, score:d.strainScore,    setScore:set("strainScore"),
      fields:[{label:"Note",value:d.strainNote,onChange:set("strainNote"),unit:""}] },
  ];

  return (
    <div style={{ background: C.panel, borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: "flex" }}>
        {metrics.map((m, mi) => (
          <div key={m.key} style={{
            flex: 1, display: "flex", alignItems: "center", gap: 14,
            padding: "12px 18px", borderRight: mi<2 ? `1px solid ${C.border}` : "none",
          }}>
            <div style={{ position: "relative", flexShrink: 0 }}>
              <Ring score={m.score} color={m.color} size={50}/>
              {isToday && (
                <input value={m.score} onChange={e => m.setScore(e.target.value)}
                  style={{ position:"absolute",inset:0,background:"transparent",border:"none",outline:"none",
                    textAlign:"center",color:"transparent",cursor:"text",width:"100%" }}/>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily:mono, fontSize:9, letterSpacing:"0.25em", textTransform:"uppercase", color:m.color, marginBottom:8 }}>{m.label}</div>
              <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
                {m.fields.map(f => (
                  <div key={f.label} style={{ display:"flex", flexDirection:"column", gap:2 }}>
                    <span style={{ fontFamily:mono, fontSize:9, letterSpacing:"0.2em", textTransform:"uppercase", color:C.dim }}>{f.label}</span>
                    <div style={{ display:"flex", alignItems:"baseline", gap:3 }}>
                      <input value={f.value} onChange={e => !(!isToday) && f.onChange(e.target.value)}
                        readOnly={!isToday} placeholder="—"
                        style={{ background:"transparent",border:"none",outline:"none",
                          color:f.value?C.text:C.dim, fontFamily:serif, fontSize:16, width:52, padding:0 }}/>
                      {f.unit && <span style={{ fontFamily:mono, fontSize:9, color:C.dim }}>{f.unit}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
        {/* Sync status */}
        <div style={{ display:"flex", flexDirection:"column", justifyContent:"center", padding:"12px 16px", gap:6, borderLeft:`1px solid ${C.border}` }}>
          {ouraAvail ? (
            <button onClick={syncOura} disabled={syncing} style={{
              background:"none", border:`1px solid ${C.border2}`, color:syncing?C.dimmer:C.green,
              fontFamily:mono, fontSize:8, letterSpacing:"0.15em", padding:"4px 8px", cursor:"pointer",
            }}>{syncing ? "syncing…" : "↻ oura"}</button>
          ) : (
            <span style={{ fontFamily:mono, fontSize:8, color:C.dimmer, letterSpacing:"0.1em" }}>set OURA_TOKEN in Vercel</span>
          )}
          {lastSync && <span style={{ fontFamily:mono, fontSize:8, color:C.dimmer }}>{lastSync}</span>}
        </div>
      </div>
    </div>
  );
}

// ─── NOTES ────────────────────────────────────────────────────────────────────
function Notes({ date }) {
  const { value: text, setValue: setText } = useAutosave(date, "notes", "");

  return (
    <textarea
      value={text}
      onChange={e => setText(e.target.value)}
      placeholder="Write anything · autosaves"
      style={{
        background:"transparent", border:"none", outline:"none", resize:"none",
        color:C.text, fontFamily:serif, fontSize:13, lineHeight:1.8,
        width:"100%", height:"100%", minHeight:200, padding:0,
      }}
    />
  );
}

// ─── ROW-LIST WIDGET (shared by Meals + Activity) ────────────────────────────
function RowList({ date, type, placeholder, estimatePrompt, calLabel, accentColor }) {
  const emptyRows = () => [{ id: Date.now(), text: "", kcal: null }];
  const { value: rows, setValue: setRows, loaded } = useAutosave(date, type, emptyRows());
  const refs = useRef({});

  // Ensure rows is always an array
  const safeRows = Array.isArray(rows) ? rows : emptyRows();

  const total = safeRows.reduce((s, r) => s + (r.kcal || 0), 0);

  async function estimate(id, text) {
    if (!text.trim()) return;
    setRows(safeRows.map(r => r.id===id ? {...r, estimating:true} : r));
    try {
      const resp = await ai(estimatePrompt(text), "Return only JSON with kcal field.");
      const { kcal } = parseJSON(resp, { kcal: null });
      setRows(safeRows.map(r => r.id===id ? {...r, kcal:kcal||null, estimating:false} : r));
    } catch {
      setRows(safeRows.map(r => r.id===id ? {...r, estimating:false} : r));
    }
  }

  function handleKey(e, id, idx) {
    if (e.key === "Enter") {
      e.preventDefault();
      const newId = Date.now();
      const next = [...safeRows.slice(0,idx+1), {id:newId,text:"",kcal:null}, ...safeRows.slice(idx+1)];
      setRows(next);
      setTimeout(() => refs.current[newId]?.focus(), 30);
    }
    if (e.key === "Backspace" && safeRows[idx].text === "" && safeRows.length > 1) {
      e.preventDefault();
      const next = safeRows.filter(r => r.id !== id);
      setRows(next);
      const prevId = safeRows[idx-1]?.id || safeRows[idx+1]?.id;
      setTimeout(() => refs.current[prevId]?.focus(), 30);
    }
  }

  function handleBlur(id, text) {
    const row = safeRows.find(r => r.id === id);
    if (text.trim() && row && row.kcal === null && !row.estimating) estimate(id, text);
  }

  function updateText(id, text) {
    setRows(safeRows.map(r => r.id===id ? {...r, text, kcal:null} : r));
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
      {total > 0 && (
        <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:8 }}>
          <span style={{ fontFamily:mono, fontSize:11, color:accentColor }}>
            {calLabel}{total} kcal
          </span>
        </div>
      )}
      <div style={{ flex:1, overflow:"auto" }}>
        {safeRows.map((row, idx) => (
          <div key={row.id} style={{ display:"flex", alignItems:"baseline", gap:10, padding:"3px 0", minHeight:28 }}>
            <input
              ref={el => refs.current[row.id] = el}
              value={row.text}
              onChange={e => updateText(row.id, e.target.value)}
              onBlur={e => handleBlur(row.id, e.target.value)}
              onKeyDown={e => handleKey(e, row.id, idx)}
              placeholder={idx===0 ? placeholder : ""}
              style={{
                background:"transparent", border:"none", outline:"none",
                color:row.text?C.text:C.dim, fontFamily:serif,
                fontSize:13, flex:1, padding:0, lineHeight:1.7,
              }}
            />
            <span style={{ fontFamily:mono, fontSize:10, color:accentColor, flexShrink:0, minWidth:44, textAlign:"right" }}>
              {row.estimating ? "…" : row.kcal ? `${calLabel}${row.kcal}` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Meals({ date }) {
  return <RowList date={date} type="meals" placeholder="What did you eat? · Enter for new line"
    estimatePrompt={t => `Calories in: "${t}". JSON: {"kcal":420}`}
    calLabel="" accentColor={C.accent} />;
}

function Activity({ date }) {
  return <RowList date={date} type="activity" placeholder="What did you do? · Enter for new line"
    estimatePrompt={t => `Calories burned doing: "${t}" for a typical adult. JSON: {"kcal":300}`}
    calLabel="−" accentColor={C.green} />;
}

// ─── TASKS ────────────────────────────────────────────────────────────────────
function Tasks({ date, calTasks }) {
  const emptyRows = () => [{ id: Date.now(), text: "", done: false, fromCal: false }];
  const { value: rows, setValue: setRows, loaded } = useAutosave(date, "tasks", emptyRows());
  const refs = useRef({});

  const safeRows = Array.isArray(rows) ? rows : emptyRows();

  // Seed calendar tasks on first load
  useEffect(() => {
    if (!loaded || !calTasks?.length) return;
    const existing = new Set(safeRows.filter(r => r.fromCal).map(r => r.text));
    const novel = calTasks.filter(t => !existing.has(t));
    if (novel.length) {
      setRows([...novel.map((t,i)=>({id:`c${Date.now()}${i}`,text:t,done:false,fromCal:true})), ...safeRows]);
    }
  }, [calTasks, loaded]);

  function handleKey(e, id, idx) {
    if (e.key === "Enter") {
      e.preventDefault();
      const newId = Date.now();
      const next = [...safeRows.slice(0,idx+1), {id:newId,text:"",done:false,fromCal:false}, ...safeRows.slice(idx+1)];
      setRows(next);
      setTimeout(() => refs.current[newId]?.focus(), 30);
    }
    if (e.key === "Backspace" && safeRows[idx].text === "" && safeRows.length > 1) {
      e.preventDefault();
      setRows(safeRows.filter(r => r.id !== id));
      const prev = safeRows[idx-1]?.id;
      if (prev) setTimeout(() => refs.current[prev]?.focus(), 30);
    }
  }

  function toggle(id) { setRows(safeRows.map(r => r.id===id ? {...r,done:!r.done} : r)); }

  const open = safeRows.filter(r => !r.done);
  const done = safeRows.filter(r => r.done);

  return (
    <div style={{ flex:1, overflow:"auto" }}>
      {[...open, ...done].map((row, idx) => (
        <div key={row.id} style={{
          display:"flex", alignItems:"center", gap:10,
          padding:"5px 0", minHeight:28,
          opacity: row.done ? 0.33 : 1,
        }}>
          <button onClick={() => toggle(row.id)} style={{
            width:13, height:13, flexShrink:0, borderRadius:2,
            border:`1px solid ${row.done?C.accent:C.border2}`,
            background:row.done?C.accent:"transparent",
            cursor:"pointer", padding:0,
            display:"flex", alignItems:"center", justifyContent:"center",
          }}>
            {row.done && <span style={{ fontSize:8, color:C.bg }}>✓</span>}
          </button>
          <input
            ref={el => refs.current[row.id] = el}
            value={row.text}
            onChange={e => setRows(safeRows.map(r => r.id===row.id ? {...r,text:e.target.value} : r))}
            onKeyDown={e => handleKey(e, row.id, idx)}
            placeholder={idx===0 && open.length===1 && !row.text ? "Task · Enter for new line" : ""}
            style={{
              background:"transparent", border:"none", outline:"none",
              color:row.done?C.dim:C.text, fontFamily:serif, fontSize:13,
              flex:1, padding:0, lineHeight:1.7,
              textDecoration:row.done?"line-through":"none",
            }}
          />
          {row.fromCal && <span style={{ fontFamily:mono, fontSize:7, color:C.dimmer }}>●</span>}
        </div>
      ))}
    </div>
  );
}

// ─── SETTINGS PANEL ───────────────────────────────────────────────────────────
function Settings({ gcalToken, setGcalToken, onClose }) {
  const [gcal, setGcal] = useState(gcalToken);

  function save() {
    setGcalToken(gcal.trim());
    persist("global", "tokens", { gcal: gcal.trim() });
    onClose();
  }

  return (
    <div style={{
      position:"fixed", inset:0, background:"#000000CC", display:"flex",
      alignItems:"center", justifyContent:"center", zIndex:100,
    }} onClick={onClose}>
      <div style={{
        background:C.panel, border:`1px solid ${C.border2}`,
        padding:28, width:420, maxWidth:"90vw",
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontFamily:mono, fontSize:9, letterSpacing:"0.3em", textTransform:"uppercase", color:C.accent, marginBottom:20 }}>Settings</div>

        <div style={{ marginBottom:20 }}>
          <div style={{ fontFamily:mono, fontSize:9, letterSpacing:"0.2em", color:C.dim, marginBottom:8 }}>GOOGLE CALENDAR TOKEN</div>
          <input value={gcal} onChange={e=>setGcal(e.target.value)}
            placeholder="Paste your OAuth access token"
            style={{ background:C.bg, border:`1px solid ${C.border2}`, color:C.text,
              fontFamily:mono, fontSize:11, padding:"8px 12px", width:"100%", outline:"none" }}/>
          <div style={{ fontFamily:mono, fontSize:8, color:C.dimmer, marginTop:5 }}>
            Get from: developers.google.com/oauthplayground → Google Calendar API v3
          </div>
        </div>

        <div style={{ marginBottom:24, padding:"10px 12px", border:`1px solid ${C.border}`, background:C.bg }}>
          <div style={{ fontFamily:mono, fontSize:8, color:C.dim, marginBottom:6, letterSpacing:"0.15em" }}>OURA + ANTHROPIC API</div>
          <div style={{ fontFamily:mono, fontSize:8, color:C.dimmer, lineHeight:1.6 }}>
            Set OURA_TOKEN and ANTHROPIC_API_KEY in your Vercel project → Settings → Environment Variables. These stay server-side and never touch the browser.
          </div>
        </div>

        <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
          <button onClick={onClose} style={{ background:"none", border:`1px solid ${C.border2}`,
            color:C.dim, fontFamily:mono, fontSize:9, letterSpacing:"0.15em", padding:"7px 14px", cursor:"pointer" }}>cancel</button>
          <button onClick={save} style={{ background:C.accent, border:"none",
            color:C.bg, fontFamily:mono, fontSize:9, letterSpacing:"0.15em", padding:"7px 14px", cursor:"pointer" }}>save</button>
        </div>
      </div>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
const WIDS = ["notes","meals","tasks","activity"];
const WCFG = {
  notes:    { label:"Notes",    color:C.accent },
  meals:    { label:"Meals",    color:C.red },
  tasks:    { label:"Tasks",    color:C.blue },
  activity: { label:"Activity", color:C.green },
};
const WMAP = { notes:Notes, meals:Meals, tasks:Tasks, activity:Activity };

export default function Dashboard() {
  // Default to Monday if today is Sunday (so active week is visible)
  const initSelected = () => {
    const d = new Date();
    if (d.getDay() === 0) return toKey(shift(d, 1));
    return todayKey();
  };
  const [selected, setSelected] = useState(initSelected);
  const [events, setEvents] = useState({});
  const [calTasks, setCalTasks] = useState([]);
  const [syncing, setSyncing] = useState(true);
  const [gcalToken, setGcalToken] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const { order, drag } = useDrag(WIDS);

  // Load saved tokens
  useEffect(() => {
    recall("global","tokens").then(t => {
      if (t?.gcal) setGcalToken(t.gcal);
    });
  }, []);

  // Sync Google Calendar via server route (works anywhere, not just Claude)
  const syncCalendar = useCallback(async (gcalTok) => {
    const token = gcalTok || gcalToken;
    if (!token) { setSyncing(false); return; }
    setSyncing(true);
    try {
      const start = toKey(shift(new Date(), -7));
      const end = toKey(shift(new Date(), 21));
      const r = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, start, end }),
      });
      const data = await r.json();
      if (data.events) setEvents(data.events);
    } catch(e) { console.warn("cal sync failed", e); }
    finally { setSyncing(false); }
  }, [gcalToken]);

  useEffect(() => { syncCalendar(); }, []);

  const h = new Date().getHours();
  const greeting = h<12?"Morning":h<17?"Afternoon":"Evening";

  return (
    <div style={{ background:C.bg, minHeight:"100vh", color:C.text, display:"flex", flexDirection:"column" }}>
      <style>{`
        * { box-sizing:border-box; margin:0; padding:0; }
        ::-webkit-scrollbar { width:3px; } ::-webkit-scrollbar-thumb { background:#222; }
        button { border-radius:0; }
        input::placeholder, textarea::placeholder { color:${C.dim}; opacity:1; }
        a { text-decoration:none; }
      `}</style>

      {showSettings && (
        <Settings
          gcalToken={gcalToken} setGcalToken={setGcalToken}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Top bar */}
      <div style={{
        padding:"8px 20px", background:C.bg, borderBottom:`1px solid ${C.border}`,
        display:"flex", justifyContent:"space-between", alignItems:"center",
      }}>
        <span style={{ fontFamily:mono, fontSize:9, letterSpacing:"0.25em", textTransform:"uppercase", color:C.dim }}>
          {greeting}, Marvin
        </span>
        <div style={{ display:"flex", gap:12, alignItems:"center" }}>
          <span style={{ fontFamily:mono, fontSize:9, color:C.dimmer }}>
            {new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}
          </span>
          <button onClick={() => setShowSettings(true)} style={{
            background:"none", border:`1px solid ${C.border2}`, color:C.dim,
            fontFamily:mono, fontSize:8, letterSpacing:"0.15em", padding:"3px 8px", cursor:"pointer",
          }}>⚙ settings</button>
        </div>
      </div>

      <CalStrip selected={selected} onSelect={setSelected} events={events} syncing={syncing}/>
      <HealthStrip date={selected}/>

      {/* Widget grid */}
      <div style={{
        flex:1, display:"grid", gridTemplateColumns:"1fr 1fr",
        gridAutoRows:"minmax(240px, auto)", gap:2, padding:2, background:C.border,
      }}>
        {order.map((id, i) => {
          const cfg = WCFG[id];
          const W = WMAP[id];
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
