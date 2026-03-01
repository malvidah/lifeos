"use client";
import { useState, useEffect, useRef, useCallback } from "react";

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg: "#0A0A0A", panel: "#101010", border: "#191919", border2: "#222",
  text: "#DDD8D0", dim: "#4A4744", dimmer: "#282624", accent: "#B8A882",
  green: "#5A9470", blue: "#4A7A9B", yellow: "#A8864A", red: "#9B4A4A",
};
const serif = "Georgia, 'Times New Roman', serif";
const mono  = "'SF Mono', ui-monospace, monospace";

// ─── Date utils ───────────────────────────────────────────────────────────────
const toKey   = d  => new Date(d).toISOString().split("T")[0];
const todayKey = () => toKey(new Date());
const shift   = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const DAY3 = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const MON3 = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function weekOf(anchor) {
  const d = new Date(anchor);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => shift(d, i));
}

// ─── AI calorie helper ────────────────────────────────────────────────────────
async function estimateKcal(prompt) {
  const r = await fetch("/api/ai", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514", max_tokens: 64,
      system: "Return only valid JSON with a single `kcal` integer field. No prose.",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const d = await r.json();
  const text = d.content?.find(b => b.type === "text")?.text || "{}";
  try { return JSON.parse(text.match(/\{[\s\S]*\}/)[0]).kcal || null; }
  catch { return null; }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────
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
    if (!r.ok) return null;
    const j = await r.json();
    return j.data ?? null;
  } catch { return null; }
}

// ─── In-memory cache (fast day switching; db is source of truth) ──────────────
const MEM = {};

// ─── useDbSave: load from db, save to db on change ───────────────────────────
function useDbSave(date, type, empty) {
  const ck = `${date}:${type}`;
  const [value, _setValue]  = useState(() => MEM[ck] ?? empty);
  const [loaded, setLoaded] = useState(ck in MEM);
  const live    = useRef(value);
  const dateRef = useRef(date);
  const timer   = useRef(null);
  live.current  = value;

  // Load from db when date/type changes
  useEffect(() => {
    const key = `${date}:${type}`;
    dateRef.current = date;
    if (key in MEM) {
      _setValue(MEM[key]);
      live.current = MEM[key];
      setLoaded(true);
      return;
    }
    setLoaded(false);
    _setValue(empty);
    live.current = empty;
    dbLoad(date, type).then(v => {
      const val = v ?? empty;
      MEM[key] = val;
      _setValue(val);
      live.current = val;
      setLoaded(true);
    });
  }, [date, type]); // eslint-disable-line

  // Flush on tab close / hide
  useEffect(() => {
    const flush = () => {
      clearTimeout(timer.current);
      dbSave(dateRef.current, type, live.current);
    };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); });
    return () => window.removeEventListener("beforeunload", flush);
  }, [type]); // eslint-disable-line

  const setValue = useCallback(updater => {
    const next = typeof updater === "function" ? updater(live.current) : updater;
    live.current = next;
    MEM[`${dateRef.current}:${type}`] = next;
    _setValue(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => dbSave(dateRef.current, type, live.current), 800);
  }, [type]);

  return { value, setValue, loaded };
}

// ─── Drag-to-reorder ─────────────────────────────────────────────────────────
function useDrag(init) {
  const [order, setOrder] = useState(init);
  const from = useRef(null);
  const handlers = i => ({
    draggable: true,
    onDragStart: ()  => { from.current = i; },
    onDragOver:  e   => e.preventDefault(),
    onDrop:      ()  => {
      if (from.current === null || from.current === i) return;
      setOrder(o => {
        const n = [...o];
        n.splice(i, 0, n.splice(from.current, 1)[0]);
        return n;
      });
      from.current = null;
    },
  });
  return { order, handlers };
}

// ─── Ring ─────────────────────────────────────────────────────────────────────
function Ring({ score, color, size = 44 }) {
  const r    = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const val  = parseFloat(score) || 0;
  const pct  = Math.min(val / 100, 1);
  const elite = val >= 90;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
      <circle cx={size/2} cy={size/2} r={r} fill={elite ? color+"22" : "none"} stroke={C.dimmer} strokeWidth={3}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color}
        strokeWidth={elite ? 4 : 3} strokeLinecap="round"
        strokeDasharray={`${pct*circ} ${circ}`}
        style={{ transition: "stroke-dasharray 0.4s ease" }}/>
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central"
        style={{ fill: elite ? color : score ? C.text : C.dim, fontSize: 10,
          fontFamily: serif, fontWeight: elite ? "bold" : "normal",
          transform: "rotate(90deg)", transformOrigin: `${size/2}px ${size/2}px` }}>
        {score || "—"}
      </text>
    </svg>
  );
}

// ─── Widget shell ─────────────────────────────────────────────────────────────
function Widget({ label, color, dragHandlers, children }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`,
      display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div {...dragHandlers} style={{ display: "flex", alignItems: "center", gap: 8,
        padding: "8px 12px", cursor: "grab", userSelect: "none",
        borderBottom: `1px solid ${C.border}`, borderTop: `2px solid ${color}` }}>
        <span style={{ color: C.dimmer, fontSize: 11 }}>⠿</span>
        <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.25em",
          textTransform: "uppercase", color }}>{label}</span>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 12 }}>{children}</div>
    </div>
  );
}

// ─── CalStrip ─────────────────────────────────────────────────────────────────
function CalStrip({ selected, onSelect, events, syncStatus, healthDots }) {
  const [anchor, setAnchor] = useState(() => new Date());
  const days   = weekOf(anchor);
  const today  = todayKey();
  const months = [...new Set(days.map(d => MON3[d.getMonth()]))].join(" · ");
  const year   = days[0].getFullYear();

  return (
    <div style={{ background: C.panel, borderBottom: `1px solid ${C.border}` }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8,
        padding: "10px 12px 8px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontFamily: serif, fontSize: 20, color: C.text,
          letterSpacing: "-0.02em", lineHeight: 1 }}>
          {months} <span style={{ color: C.dim, fontSize: 15 }}>{year}</span>
        </div>
        <div style={{ flex: 1 }}/>
        <span style={{ fontFamily: mono, fontSize: 8, whiteSpace: "nowrap",
          color: syncStatus.syncing ? C.dimmer : C.green, letterSpacing: "0.08em" }}>
          {syncStatus.syncing ? "syncing…" : syncStatus.lastSync ? `● ${syncStatus.lastSync}` : "● synced"}
        </span>
        {[["‹", () => setAnchor(d => shift(d, -7))],
          ["today", () => { setAnchor(new Date()); onSelect(todayKey()); }],
          ["›", () => setAnchor(d => shift(d, 7))]
        ].map(([l, fn]) => (
          <button key={l} onClick={fn} style={{ background: "none", cursor: "pointer",
            border: `1px solid ${C.border2}`, color: C.dim, fontFamily: mono,
            padding: l === "today" ? "3px 7px" : "3px 6px",
            fontSize: l === "today" ? 8 : 12, letterSpacing: l === "today" ? "0.1em" : 0 }}>
            {l}
          </button>
        ))}
      </div>

      {/* Day columns */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
        {days.map((d, i) => {
          const k    = toKey(d);
          const sel  = k === selected;
          const tod  = k === today;
          const evts = (events[k] || []).slice().sort((a,b) => (a.time||"").localeCompare(b.time||""));
          const dot  = healthDots[k] || {};
          return (
            <div key={k} onClick={() => onSelect(k)} style={{ cursor: "pointer",
              borderRight: i < 6 ? `1px solid ${C.border}` : "none",
              background: sel ? "#FFFFFF05" : "transparent" }}>
              <div style={{ padding: "6px 6px 3px", display: "flex", flexDirection: "column",
                alignItems: "center", gap: 1, borderBottom: `1px solid ${C.border}`,
                borderTop: sel ? `2px solid ${C.accent}` : tod ? `2px solid ${C.dim}` : `2px solid transparent` }}>
                <span style={{ fontFamily: mono, fontSize: 7, color: sel ? C.accent : C.dimmer }}>{DAY3[i]}</span>
                <span style={{ fontFamily: serif, fontSize: 14, lineHeight: 1,
                  color: tod ? C.accent : sel ? C.text : C.dim }}>{d.getDate()}</span>
                <div style={{ display: "flex", gap: 2, height: 4, alignItems: "center" }}>
                  {dot.sleep    >= 90 && <span style={{ width:3,height:3,borderRadius:"50%",background:C.blue,  display:"inline-block" }}/>}
                  {dot.readiness>= 90 && <span style={{ width:3,height:3,borderRadius:"50%",background:C.green, display:"inline-block" }}/>}
                  {dot.strain   >= 90 && <span style={{ width:3,height:3,borderRadius:"50%",background:C.yellow,display:"inline-block" }}/>}
                </div>
              </div>
              <div style={{ padding: "3px 4px", display: "flex", flexDirection: "column", gap: 2, minHeight: 52 }}>
                {evts.length === 0
                  ? <span style={{ fontFamily: mono, fontSize: 7, color: C.dimmer }}>—</span>
                  : evts.map((ev, ei) => (
                    <div key={ei} style={{ borderLeft: `2px solid ${ev.color||C.accent}`, paddingLeft: 3 }}>
                      <div style={{ fontFamily: mono, fontSize: 7, color: C.dim }}>{ev.time}</div>
                      <div style={{ fontFamily: serif, fontSize: 9, lineHeight: 1.3,
                        wordBreak: "break-word", color: sel ? C.text : C.dim }}>{ev.title}</div>
                      {ev.zoomUrl && (
                        <a href={ev.zoomUrl} target="_blank" rel="noreferrer"
                          onClick={e => e.stopPropagation()}
                          style={{ fontFamily: mono, fontSize: 7, color: C.blue }}>JOIN ↗</a>
                      )}
                    </div>
                  ))
                }
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── HealthStrip ──────────────────────────────────────────────────────────────
const HEALTH_EMPTY = { sleepScore:"", sleepHrs:"", sleepEff:"", readinessScore:"", hrv:"", rhr:"", strainScore:"", strainNote:"" };

function HealthStrip({ date, onHealthChange, onSyncStart, onSyncEnd }) {
  const { value: h, setValue: setH, loaded } = useDbSave(date, "health", HEALTH_EMPTY);
  const set = k => e => setH(prev => ({ ...prev, [k]: e.target.value }));

  // Notify parent for calendar dots
  useEffect(() => { if (loaded) onHealthChange(date, h); }, [h, loaded]); // eslint-disable-line

  // Auto-sync Oura — only fills empty fields so manual edits are preserved
  useEffect(() => {
    if (!loaded) return;
    onSyncStart("oura");
    fetch(`/api/oura?date=${date}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) return;
        setH(prev => ({
          ...prev,
          sleepScore:     prev.sleepScore     || data.sleepScore     || "",
          sleepHrs:       prev.sleepHrs       || data.sleepHrs       || "",
          sleepEff:       prev.sleepEff       || data.sleepQuality   || "",
          readinessScore: prev.readinessScore || data.readinessScore || "",
          hrv:            prev.hrv            || data.hrv            || "",
          rhr:            prev.rhr            || data.rhr            || "",
        }));
      })
      .catch(() => {})
      .finally(() => onSyncEnd("oura"));
  }, [date, loaded]); // eslint-disable-line

  const metrics = [
    { key: "sleep",     label: "Sleep",     color: C.blue,
      score: h.sleepScore,     setScore: e => setH(p => ({...p, sleepScore: e.target.value})),
      fields: [{ label:"Hrs", value:h.sleepHrs, onChange:set("sleepHrs"), unit:"h" },
               { label:"Eff", value:h.sleepEff, onChange:set("sleepEff"), unit:"%" }] },
    { key: "readiness", label: "Readiness", color: C.green,
      score: h.readinessScore, setScore: e => setH(p => ({...p, readinessScore: e.target.value})),
      fields: [{ label:"HRV", value:h.hrv, onChange:set("hrv"), unit:"ms" },
               { label:"RHR", value:h.rhr, onChange:set("rhr"), unit:"bpm" }] },
    { key: "strain",    label: "Strain",    color: C.yellow,
      score: h.strainScore,    setScore: e => setH(p => ({...p, strainScore: e.target.value})),
      fields: [{ label:"Note", value:h.strainNote, onChange:set("strainNote"), unit:"" }] },
  ];

  return (
    <div style={{ background: C.panel, borderBottom: `1px solid ${C.border}`, overflowX: "auto" }}>
      <div style={{ display: "flex", minWidth: 280 }}>
        {metrics.map((m, mi) => (
          <div key={m.key} style={{ flex: "1 1 0", display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px", minWidth: 90,
            borderRight: mi < 2 ? `1px solid ${C.border}` : "none" }}>
            {/* Clickable ring */}
            <div style={{ position: "relative", flexShrink: 0 }}>
              <Ring score={m.score} color={m.color} size={44}/>
              <input value={m.score} onChange={m.setScore}
                style={{ position:"absolute",inset:0,opacity:0,cursor:"text",width:"100%",fontSize:16 }}/>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: mono, fontSize: 8, letterSpacing: "0.18em",
                textTransform: "uppercase", color: m.color, marginBottom: 5 }}>{m.label}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {m.fields.map(f => (
                  <div key={f.label}>
                    <div style={{ fontFamily: mono, fontSize: 7, textTransform: "uppercase",
                      color: C.dim, marginBottom: 1 }}>{f.label}</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
                      <input value={f.value} onChange={f.onChange} placeholder="—"
                        style={{ background:"transparent",border:"none",outline:"none",padding:0,
                          color: f.value ? C.text : C.dim, fontFamily: serif, fontSize: 16, width: 36 }}/>
                      {f.unit && <span style={{ fontFamily: mono, fontSize: 7, color: C.dim }}>{f.unit}</span>}
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
  const { value, setValue, loaded } = useDbSave(date, "notes", "");
  return (
    <textarea value={value} onChange={e => setValue(e.target.value)}
      placeholder={loaded ? "Write anything…" : "Loading…"} disabled={!loaded}
      style={{ background:"transparent",border:"none",outline:"none",resize:"none",padding:0,
        color:C.text, fontFamily:serif, fontSize:16, lineHeight:1.8,
        width:"100%", height:"100%", minHeight:180, opacity: loaded ? 1 : 0.4 }}/>
  );
}

// ─── RowList (Meals + Activity) ───────────────────────────────────────────────
function RowList({ date, type, placeholder, promptFn, prefix, color }) {
  const mkRow  = () => ({ id: Date.now(), text: "", kcal: null });
  const { value: rows, setValue: setRows, loaded } = useDbSave(date, type, [mkRow()]);
  const inputRefs = useRef({});
  const safe  = Array.isArray(rows) && rows.length ? rows : [mkRow()];
  const total = safe.reduce((s, r) => s + (r.kcal || 0), 0);

  async function runEstimate(id, text) {
    setRows(safe.map(r => r.id === id ? { ...r, estimating: true } : r));
    const kcal = await estimateKcal(promptFn(text)).catch(() => null);
    setRows(prev => (Array.isArray(prev) ? prev : safe).map(r =>
      r.id === id ? { ...r, kcal, estimating: false } : r));
  }

  function onKey(e, id, idx) {
    if (e.key === "Enter") {
      e.preventDefault();
      const row = mkRow();
      setRows([...safe.slice(0, idx+1), row, ...safe.slice(idx+1)]);
      setTimeout(() => inputRefs.current[row.id]?.focus(), 30);
    }
    if (e.key === "Backspace" && safe[idx].text === "" && safe.length > 1) {
      e.preventDefault();
      setRows(safe.filter(r => r.id !== id));
      const target = safe[idx-1]?.id ?? safe[idx+1]?.id;
      setTimeout(() => inputRefs.current[target]?.focus(), 30);
    }
  }

  if (!loaded) return <div style={{ fontFamily:mono, fontSize:9, color:C.dimmer }}>Loading…</div>;
  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
      {total > 0 && (
        <div style={{ textAlign:"right", marginBottom:6 }}>
          <span style={{ fontFamily:mono, fontSize:11, color }}>{prefix}{total} kcal</span>
        </div>
      )}
      {safe.map((row, idx) => (
        <div key={row.id} style={{ display:"flex", alignItems:"baseline", gap:8, padding:"2px 0", minHeight:26 }}>
          <input ref={el => inputRefs.current[row.id] = el}
            value={row.text}
            onChange={e => setRows(safe.map(r => r.id===row.id ? {...r,text:e.target.value,kcal:null} : r))}
            onBlur={e => {
              const r = safe.find(r => r.id===row.id);
              if (e.target.value.trim() && r?.kcal===null && !r?.estimating) runEstimate(row.id, e.target.value);
            }}
            onKeyDown={e => onKey(e, row.id, idx)}
            placeholder={idx === 0 ? placeholder : ""}
            style={{ background:"transparent",border:"none",outline:"none",padding:0,flex:1,lineHeight:1.7,
              color: row.text ? C.text : C.dim, fontFamily:serif, fontSize:16 }}/>
          <span style={{ fontFamily:mono, fontSize:10, color, flexShrink:0, minWidth:38, textAlign:"right" }}>
            {row.estimating ? "…" : row.kcal ? `${prefix}${row.kcal}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function Meals({ date }) {
  return <RowList date={date} type="meals" placeholder="What did you eat?"
    promptFn={t => `Calories in: "${t}". Return JSON: {"kcal":420}`} prefix="" color={C.accent}/>;
}
function Activity({ date }) {
  return <RowList date={date} type="activity" placeholder="What did you do?"
    promptFn={t => `Calories burned: "${t}" for a typical adult. Return JSON: {"kcal":300}`} prefix="−" color={C.green}/>;
}

// ─── Tasks ────────────────────────────────────────────────────────────────────
function Tasks({ date }) {
  const mkRow  = () => ({ id: Date.now(), text: "", done: false });
  const { value: rows, setValue: setRows, loaded } = useDbSave(date, "tasks", [mkRow()]);
  const inputRefs = useRef({});
  const safe  = Array.isArray(rows) && rows.length ? rows : [mkRow()];
  const open  = safe.filter(r => !r.done);
  const done  = safe.filter(r =>  r.done);

  function onKey(e, id, idx) {
    if (e.key === "Enter") {
      e.preventDefault();
      const row = mkRow();
      setRows([...safe.slice(0, idx+1), row, ...safe.slice(idx+1)]);
      setTimeout(() => inputRefs.current[row.id]?.focus(), 30);
    }
    if (e.key === "Backspace" && safe[idx].text === "" && safe.length > 1) {
      e.preventDefault();
      setRows(safe.filter(r => r.id !== id));
      if (safe[idx-1]) setTimeout(() => inputRefs.current[safe[idx-1].id]?.focus(), 30);
    }
  }

  if (!loaded) return <div style={{ fontFamily:mono, fontSize:9, color:C.dimmer }}>Loading…</div>;
  return (
    <div style={{ flex:1, overflow:"auto" }}>
      {[...open, ...done].map((row, idx) => (
        <div key={row.id} style={{ display:"flex", alignItems:"center", gap:8,
          padding:"4px 0", minHeight:26, opacity: row.done ? 0.33 : 1 }}>
          <button onClick={() => setRows(safe.map(r => r.id===row.id ? {...r,done:!r.done} : r))}
            style={{ width:13,height:13,flexShrink:0,borderRadius:2,padding:0,cursor:"pointer",
              border:`1px solid ${row.done?C.accent:C.border2}`,
              background: row.done ? C.accent : "transparent",
              display:"flex",alignItems:"center",justifyContent:"center" }}>
            {row.done && <span style={{ fontSize:8, color:C.bg }}>✓</span>}
          </button>
          <input ref={el => inputRefs.current[row.id] = el}
            value={row.text}
            onChange={e => setRows(safe.map(r => r.id===row.id ? {...r,text:e.target.value} : r))}
            onKeyDown={e => onKey(e, row.id, idx)}
            placeholder={idx===0 && open.length===1 && !row.text ? "Task · Enter for new line" : ""}
            style={{ background:"transparent",border:"none",outline:"none",padding:0,flex:1,lineHeight:1.7,
              color: row.done ? C.dim : C.text, fontFamily:serif, fontSize:16,
              textDecoration: row.done ? "line-through" : "none" }}/>
        </div>
      ))}
    </div>
  );
}

// ─── Dashboard root ───────────────────────────────────────────────────────────
const WIDGETS = [
  { id:"notes",    label:"Notes",    color:C.accent, Comp:Notes    },
  { id:"meals",    label:"Meals",    color:C.red,    Comp:Meals    },
  { id:"tasks",    label:"Tasks",    color:C.blue,   Comp:Tasks    },
  { id:"activity", label:"Activity", color:C.green,  Comp:Activity },
];

export default function Dashboard() {
  const [selected, setSelected] = useState(todayKey);
  const [events,     setEvents]     = useState({});
  const [healthDots, setHealthDots] = useState({});
  const [syncing,    setSyncing]    = useState(new Set());
  const [lastSync,   setLastSync]   = useState(null);
  const { order, handlers } = useDrag(WIDGETS.map(w => w.id));

  const startSync = useCallback(k => setSyncing(s => new Set([...s, k])), []);
  const endSync   = useCallback(k => {
    setSyncing(s => { const n = new Set(s); n.delete(k); return n; });
    setLastSync(new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }));
  }, []);

  const syncStatus = { syncing: syncing.size > 0, lastSync };

  // Google Calendar sync on mount
  useEffect(() => {
    dbLoad("global", "tokens").then(t => {
      if (!t?.gcal) return;
      startSync("cal");
      fetch("/api/calendar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: t.gcal, start: toKey(shift(new Date(),-7)), end: toKey(shift(new Date(),21)) }),
      })
        .then(r => r.json())
        .then(d => { if (d.events) setEvents(d.events); })
        .catch(() => {})
        .finally(() => endSync("cal"));
    });
  }, []); // eslint-disable-line

  const onHealthChange = useCallback((date, data) => {
    setHealthDots(prev => ({
      ...prev,
      [date]: { sleep:+data.sleepScore||0, readiness:+data.readinessScore||0, strain:+data.strainScore||0 },
    }));
  }, []);

  const wMap = Object.fromEntries(WIDGETS.map(w => [w.id, w]));

  return (
    <div style={{ background:C.bg, minHeight:"100vh", color:C.text, display:"flex", flexDirection:"column" }}>
      <style>{`
        *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
        ::-webkit-scrollbar { width:3px; height:3px; }
        ::-webkit-scrollbar-thumb { background:#222; }
        button { border-radius:0; }
        input::placeholder, textarea::placeholder { color:${C.dim}; opacity:1; }
        a { text-decoration:none; }
        input, textarea, select { font-size:16px; }
        @media (max-width:600px) { .wgrid { grid-template-columns:1fr !important; } }
      `}</style>

      <CalStrip selected={selected} onSelect={setSelected}
        events={events} syncStatus={syncStatus} healthDots={healthDots}/>

      <HealthStrip date={selected} onHealthChange={onHealthChange}
        onSyncStart={startSync} onSyncEnd={endSync}/>

      <div className="wgrid" style={{ flex:1, display:"grid", gridTemplateColumns:"1fr 1fr",
        gridAutoRows:"minmax(220px,auto)", gap:1, padding:1, background:C.border }}>
        {order.map((id, i) => {
          const { label, color, Comp } = wMap[id];
          return (
            <Widget key={id} label={label} color={color} dragHandlers={handlers(i)}>
              <Comp date={selected}/>
            </Widget>
          );
        })}
      </div>
    </div>
  );
}
