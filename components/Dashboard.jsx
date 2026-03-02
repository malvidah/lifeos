"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "../lib/supabase.js";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  DragOverlay, defaultDropAnimationSideEffects,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const THEMES = {
  dark: {
    bg:"#0D0D0F", surface:"#16171A", card:"#1C1D21",
    border:"#26272C", border2:"#2E2F35",
    text:"#E8E4DC", muted:"#6B6870", dim:"#3A3840",
    accent:"#C4A882", green:"#4E9268", blue:"#4A82B0",
    yellow:"#B08A3E", red:"#A05050",
    shadow:"0 1px 2px rgba(0,0,0,0.5),0 4px 16px rgba(0,0,0,0.25)",
    shadowSm:"0 1px 3px rgba(0,0,0,0.4)",
  },
  light: {
    // Warm parchment — Substack-inspired, no harsh whites or shadows
    bg:"#F7F4F0", surface:"#F0EDE8", card:"#FAF8F5",
    border:"#E5E0D8", border2:"#D8D2C8",
    text:"#1C1916", muted:"#8C8680", dim:"#C4BFB8",
    accent:"#9B6B3A", green:"#3D7A52", blue:"#3A6A94",
    yellow:"#9A7A2A", red:"#8A3A3A",
    shadow:"0 1px 2px rgba(60,40,20,0.06),0 2px 8px rgba(60,40,20,0.04)",
    shadowSm:"0 1px 2px rgba(60,40,20,0.05)",
  },
};
// C is set at render time via setTheme — default dark
let C = THEMES.dark;
const serif = "Georgia, 'Times New Roman', serif";
const mono  = "'SF Mono', 'Fira Code', ui-monospace, monospace";

// ─── Responsive hook ──────────────────────────────────────────────────────────
function useIsMobile() {
  const [mobile, setMobile] = useState(false); // always false on SSR
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < 768);
    fn(); // set correct value immediately on mount
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return mobile;
}


const R = "12px";

const toKey    = d => new Date(d).toISOString().split("T")[0];
const todayKey = () => toKey(new Date());
const shift    = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };
const DAY3 = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MON3 = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function weekOf(anchor) {
  const d=new Date(anchor); d.setDate(d.getDate()-d.getDay());
  return Array.from({length:7},(_,i)=>shift(d,i));
}

// ─── AI ───────────────────────────────────────────────────────────────────────
async function estimateKcal(prompt) {
  const r = await fetch("/api/ai",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:64,
      system:"Return only valid JSON with a single `kcal` integer field.",
      messages:[{role:"user",content:prompt}]})});
  const d = await r.json();
  const text = d.content?.find(b=>b.type==="text")?.text||"{}";
  try { return JSON.parse(text.match(/\{[\s\S]*\}/)[0]).kcal||null; } catch { return null; }
}

// ─── DB ───────────────────────────────────────────────────────────────────────
async function dbSave(date,type,data,token) {
  if (!token) return;
  const url="/api/entries";
  const body=JSON.stringify({date,type,data});
  const headers={"Content-Type":"application/json","Authorization":`Bearer ${token}`};
  // sendBeacon is fire-and-forget and survives iOS page suspension
  // We encode auth in the body since Beacon can't set custom headers
  try {
    await fetch(url,{method:"POST",headers,body});
  } catch(e) {
    // Fallback: sendBeacon (no custom headers, but works during suspension)
    if (navigator.sendBeacon) {
      const blob = new Blob([body],{type:"application/json"});
      navigator.sendBeacon(url+"?token="+encodeURIComponent(token), blob);
    }
  }
}
async function dbLoad(date,type,token) {
  if (!token) return null;
  try {
    const r = await fetch(`/api/entries?date=${date}&type=${type}`,{headers:{"Authorization":`Bearer ${token}`}});
    if (!r.ok) return null;
    return (await r.json()).data ?? null;
  } catch { return null; }
}
// Module-level cache — keyed by "userId:date:type" to prevent cross-user bleed
const MEM = {};
const DIRTY = {};
let CURRENT_USER_ID = null;

// Call this when auth state changes — wipes cache for previous user
function clearCacheForUser(newUserId) {
  if (CURRENT_USER_ID && CURRENT_USER_ID !== newUserId) {
    // Different user logged in — purge everything
    for (const k of Object.keys(MEM)) delete MEM[k];
    for (const k of Object.keys(DIRTY)) delete DIRTY[k];
  }
  CURRENT_USER_ID = newUserId;
}

function useDbSave(date, type, empty, token, userId) {
  // Include userId in cache key so different users never share cache entries
  const cacheKey = `${userId||"anon"}:${date}:${type}`;
  const [value, _set] = useState(() => MEM[cacheKey] ?? empty);
  const [loaded, setLoaded] = useState(cacheKey in MEM);
  const [rev, setRev] = useState(0);
  const live = useRef(value);
  const dateRef = useRef(date);
  const timerRef = useRef(null);
  live.current = value;

  // Fetch from DB whenever date/type/token/userId changes, or rev bumps (poll/visibility)
  useEffect(() => {
    if (!token || !userId) return;
    dateRef.current = date;
    // Use cache only for initial render (rev===0) when data is clean
    if (rev === 0 && cacheKey in MEM && !DIRTY[cacheKey]) {
      _set(MEM[cacheKey]); live.current = MEM[cacheKey]; setLoaded(true); return;
    }
    // Always fetch from DB on rev bump or dirty state
    dbLoad(date, type, token).then(remote => {
      if (DIRTY[cacheKey]) {
        // User has typed since we started fetching — last local write wins, don't overwrite
        // But save immediately to push local to DB
        dbSave(date, type, live.current, token);
        DIRTY[cacheKey] = false;
      } else {
        // No local changes — accept DB value authoritatively
        const val = remote ?? empty;
        MEM[cacheKey] = val; _set(val); live.current = val;
      }
      setLoaded(true);
    }).catch(() => setLoaded(true)); // on error, show what we have
  }, [date, type, token, userId, rev]); // eslint-disable-line

  useEffect(() => {
    if (!token) return;
    const flush = () => {
      clearTimeout(timerRef.current);
      if (DIRTY[cacheKey]) {
        dbSave(dateRef.current, type, live.current, token);
        DIRTY[cacheKey] = false;
      }
    };
    const onVis = () => {
      if (document.hidden) {
        flush(); // leaving — save immediately
      } else {
        flush(); // returning — save then re-fetch
        setRev(r => r + 1);
      }
    };
    const onPageHide = () => flush();
    // Poll every 30s passively — only if no local dirty changes
    const poll = setInterval(() => {
      if (!DIRTY[cacheKey]) setRev(r => r + 1);
    }, 30000);
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(poll);
    };
  }, [type, token, cacheKey]); // eslint-disable-line

  const setValue = useCallback(u => {
    const next = typeof u === "function" ? u(live.current) : u;
    live.current = next;
    MEM[cacheKey] = next;
    DIRTY[cacheKey] = true;
    _set(next);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      dbSave(dateRef.current, type, live.current, token);
      DIRTY[cacheKey] = false;
    }, 200);
  }, [type, token, cacheKey]); // eslint-disable-line

  return { value, setValue, loaded };
}

// ─── Ring ─────────────────────────────────────────────────────────────────────
function Ring({score,color,size=48}) {
  const r=(size-7)/2,circ=2*Math.PI*r,val=parseFloat(score)||0,pct=Math.min(val/100,1),elite=val>=90;
  return (
    <svg width={size} height={size} style={{transform:"rotate(-90deg)",flexShrink:0}}>
      <circle cx={size/2} cy={size/2} r={r} fill={elite?color+"18":"none"} stroke={C.dim} strokeWidth={3}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color}
        strokeWidth={elite?4:2.5} strokeLinecap="round" strokeDasharray={`${pct*circ} ${circ}`}
        style={{transition:"stroke-dasharray 0.5s cubic-bezier(.4,0,.2,1)"}}/>
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central"
        style={{fill:score?C.text:C.muted,fontSize:11,fontFamily:serif,
          transform:"rotate(90deg)",transformOrigin:`${size/2}px ${size/2}px`}}>
        {score||"—"}
      </text>
    </svg>
  );
}

// ─── Resizable container ──────────────────────────────────────────────────────
function Resizable({defaultH, minH=100, children, fill=false}) {
  const [h, setH] = useState(defaultH);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);

  // If fill=true, stretch to remaining container height instead
  if (fill) {
    return <div style={{flex:1,minHeight:minH,display:"flex",flexDirection:"column"}}>{children}</div>;
  }

  function onPointerDown(e) {
    e.preventDefault(); e.stopPropagation();
    dragging.current=true;
    startY.current=e.clientY;
    startH.current=h;

    function onMove(e) {
      if (!dragging.current) return;
      setH(Math.max(minH, startH.current + (e.clientY - startY.current)));
    }
    function onUp() {
      dragging.current=false;
      window.removeEventListener("pointermove",onMove);
      window.removeEventListener("pointerup",onUp);
    }
    window.addEventListener("pointermove",onMove);
    window.addEventListener("pointerup",onUp);
  }

  return (
    <div style={{position:"relative",height:h,flexShrink:0}}>
      <div style={{height:"100%"}}>{children}</div>
      {/* Resize handle strip */}
      <div onPointerDown={onPointerDown} style={{
        position:"absolute",bottom:-4,left:0,right:0,height:10,
        cursor:"ns-resize",zIndex:20,
        display:"flex",alignItems:"center",justifyContent:"center",
      }}>
        <div className="resize-pill" style={{
          width:36,height:4,borderRadius:3,
          background:C.border2,transition:"background 0.15s, transform 0.15s",
        }}/>
      </div>
    </div>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────
function Card({children,style={}}) {
  return (
    <div style={{
      background:C.card,borderRadius:R,border:`1px solid ${C.border}`,
      overflow:"hidden",height:"100%",
      boxShadow:C.shadow,
      display:"flex",flexDirection:"column",
      ...style,
    }}>{children}</div>
  );
}

// ─── Sortable wrapper ─────────────────────────────────────────────────────────
function SortableCard({id,children}) {
  const {attributes,listeners,setNodeRef,transform,transition,isDragging} = useSortable({id});
  return (
    <div ref={setNodeRef} style={{
      transform:CSS.Transform.toString(transform),
      transition:transition||"transform 200ms cubic-bezier(.4,0,.2,1)",
      opacity:isDragging?0:1,
    }}>
      {children({dragProps:{...attributes,...listeners}})}
    </div>
  );
}

// ─── Widget card ─────────────────────────────────────────────────────────────
function Widget({label,color,dragProps,children}) {
  return (
    <div style={{height:"100%",display:"flex",flexDirection:"column"}}>
      <Card>
        <div style={{
          display:"flex",alignItems:"center",gap:8,padding:"10px 14px",
          borderBottom:`1px solid ${C.border}`,flexShrink:0,
        }}>
          <div {...dragProps} style={{cursor:"grab",color:C.dim,fontSize:15,
            lineHeight:1,touchAction:"none",userSelect:"none"}}>⠿</div>
          <div style={{width:3,height:13,borderRadius:2,background:color,flexShrink:0}}/>
          <span style={{fontFamily:mono,fontSize:9,letterSpacing:"0.2em",
            textTransform:"uppercase",color:C.muted}}>{label}</span>
        </div>
        <div style={{flex:1,overflow:"auto",padding:14,minHeight:0}}>{children}</div>
      </Card>
    </div>
  );
}

// ─── UserMenu ─────────────────────────────────────────────────────────────────
function UserMenu({session,token,userId,theme,onThemeChange}) {
  const [open,setOpen]=useState(false);
  const [ouraKey,setOuraKey]=useState("");
  const [anthropicKey,setAnthropicKey]=useState("");
  const [saved,setSaved]=useState(false);
  const [saving,setSaving]=useState(false);
  const ref=useRef(null);
  const user=session?.user;
  const initials=user?.user_metadata?.name?.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()||user?.email?.[0]?.toUpperCase()||"?";
  const avatar=user?.user_metadata?.avatar_url;

  useEffect(()=>{
    if(!token||!open)return;
    dbLoad("global","settings",token,userId).then(d=>{
      if(d?.ouraToken)setOuraKey(d.ouraToken);
      if(d?.anthropicKey)setAnthropicKey(d.anthropicKey);
    });
  },[token,open,userId]); // eslint-disable-line
  useEffect(()=>{
    if(!open)return;
    const fn=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};
    document.addEventListener("mousedown",fn);
    return ()=>document.removeEventListener("mousedown",fn);
  },[open]);

  async function saveSettings(){
    setSaving(true);
    await dbSave("global","settings",{ouraToken:ouraKey,anthropicKey},token);
    setSaving(false);setSaved(true);setTimeout(()=>setSaved(false),2000);
  }

  return (
    <div ref={ref} style={{position:"relative"}}>
      <button onClick={()=>setOpen(o=>!o)} style={{
        width:32,height:32,borderRadius:"50%",padding:0,cursor:"pointer",
        border:`1.5px solid ${C.border2}`,background:avatar?"transparent":C.surface,
        overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center"}}>
        {avatar?<img src={avatar} width={32} height={32} style={{objectFit:"cover"}} alt=""/>
          :<span style={{fontFamily:mono,fontSize:10,color:C.muted}}>{initials}</span>}
      </button>
      {open&&(
        <div style={{position:"absolute",top:40,right:0,width:272,zIndex:300,
          background:C.card,border:`1px solid ${C.border2}`,borderRadius:R,
          padding:16,display:"flex",flexDirection:"column",gap:10,
          boxShadow:C.shadow}}>
          <div>
            <div style={{fontFamily:serif,fontSize:14,color:C.text}}>{user?.user_metadata?.name||"—"}</div>
            <div style={{fontFamily:mono,fontSize:9,color:C.muted,marginTop:3}}>{user?.email}</div>
          </div>
          <div style={{height:1,background:C.border}}/>
          {[
            {label:"Oura API Key",value:ouraKey,set:setOuraKey,ph:"paste token here"},
            {label:"Anthropic API Key",value:anthropicKey,set:setAnthropicKey,ph:"sk-ant-…"},
          ].map(({label,value,set,ph})=>(
            <div key={label}>
              <div style={{fontFamily:mono,fontSize:8,letterSpacing:"0.12em",textTransform:"uppercase",color:C.muted,marginBottom:5}}>{label}</div>
              <input type="password" value={value} onChange={e=>{set(e.target.value);setSaved(false);}} placeholder={ph}
                style={{width:"100%",background:C.surface,border:`1px solid ${C.border2}`,borderRadius:6,outline:"none",
                  color:C.text,fontFamily:mono,fontSize:10,padding:"7px 10px"}}/>
            </div>
          ))}
          <button onClick={saveSettings} disabled={saving} style={{
            width:"100%",background:saved?C.green+"22":"none",border:`1px solid ${saved?C.green:C.border2}`,
            borderRadius:6,color:saved?C.green:C.text,
            fontFamily:mono,fontSize:9,letterSpacing:"0.12em",textTransform:"uppercase",
            padding:"7px",cursor:"pointer",transition:"all 0.2s"}}>
            {saved?"saved ✓":saving?"saving…":"save settings"}
          </button>
          <div style={{height:1,background:C.border}}/>
          {/* Light / Dark toggle */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span style={{fontFamily:mono,fontSize:8,letterSpacing:"0.12em",textTransform:"uppercase",color:C.muted}}>
              {theme==="dark"?"Dark mode":"Light mode"}
            </span>
            <button onClick={()=>onThemeChange(t=>t==="dark"?"light":"dark")}
              style={{
                background:theme==="dark"?"rgba(196,168,130,0.15)":"rgba(155,107,58,0.12)",
                border:`1px solid ${C.border2}`,borderRadius:20,cursor:"pointer",
                padding:3,display:"flex",alignItems:"center",width:44,height:24,
                justifyContent:theme==="dark"?"flex-end":"flex-start",
                transition:"all 0.25s"}}>
              <div style={{width:16,height:16,borderRadius:"50%",
                background:C.accent,
                boxShadow:C.shadowSm,
                transition:"all 0.25s"}}/>
            </button>
          </div>
          <div style={{height:1,background:C.border}}/>
          <button onClick={async()=>{const s=createClient();await s.auth.signOut();}}
            style={{background:"none",border:"none",padding:0,textAlign:"left",cursor:"pointer",
              color:C.muted,fontFamily:mono,fontSize:9,letterSpacing:"0.12em",textTransform:"uppercase"}}>
            sign out →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── TopBar ───────────────────────────────────────────────────────────────────
function TopBar({session,token,userId,syncStatus,theme,onThemeChange}) {
  const [greeting, setGreeting] = useState("");
  useEffect(() => {
    function update() {
      const now = new Date();
      const day = now.toLocaleDateString("en-US",{weekday:"long",timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});
      setGreeting(`It's ${day},`);
    }
    update();
    // Update at midnight
    const ms = new Date().setHours(24,0,0,0) - Date.now();
    const t = setTimeout(update, ms);
    return () => clearTimeout(t);
  }, []);
  return (
    <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,padding:"0 16px",
      height:48,display:"flex",alignItems:"center",gap:12,flexShrink:0,
      position:"sticky",top:0,zIndex:100}}>
      <span style={{fontFamily:serif,fontSize:15,color:C.text,letterSpacing:"-0.01em",}}>{greeting}</span>
      <div style={{flex:1}}/>
      <div style={{display:"flex",alignItems:"center",gap:6}}>
        <div style={{width:6,height:6,borderRadius:"50%",
          background:syncStatus.syncing?C.yellow:C.green,
          boxShadow:syncStatus.syncing?`0 0 6px ${C.yellow}`:`0 0 6px ${C.green}`,
          transition:"background 0.3s"}}/>
        <span style={{fontFamily:mono,fontSize:9,color:C.muted,letterSpacing:"0.06em"}}>
          {syncStatus.syncing?"syncing":syncStatus.lastSync||"synced"}
        </span>
      </div>
      <UserMenu session={session} token={token} userId={userId} theme={theme} onThemeChange={onThemeChange}/>
    </div>
  );
}

// ─── CalStrip ────────────────────────────────────────────────────────────────
// Day 0 = Jan 1 2026 (arbitrary fixed epoch for offset math)
const CAL_EPOCH = new Date("2026-01-01T00:00:00");
const MONTHS_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function dayOffset(dateOrKey) {
  const d = typeof dateOrKey === "string" ? new Date(dateOrKey + "T12:00:00") : dateOrKey;
  return Math.round((d - CAL_EPOCH) / 86400000);
}
function offsetToDate(n) {
  const d = new Date(CAL_EPOCH);
  d.setDate(d.getDate() + Math.round(n));
  return d;
}

// Mobile parallax drum-roll picker
function MobileCalPicker({selected, onSelect, events}) {
  const today = todayKey();
  const containerRef = useRef(null);
  const [containerW, setContainerW] = useState(375);

  // Live drag offset (fractional days), committed on release
  const dragOffset  = useRef(0);   // current drag delta in px
  const velocity    = useRef(0);   // px/ms
  const lastX       = useRef(null);
  const lastT       = useRef(null);
  const rafId       = useRef(null);
  const committed   = useRef(dayOffset(selected)); // integer days from epoch
  const [render,    setRender]    = useState(0);   // bump to repaint
  const liveOffset  = useRef(0);  // fractional offset in days (float)

  // Measure container width
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(e => setContainerW(e[0].contentRect.width));
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // DAY_W: width in px for one day on the day ribbon
  const DAY_W = Math.min(56, containerW / 7);

  function cancelRaf() { if (rafId.current) { cancelAnimationFrame(rafId.current); rafId.current = null; } }

  function snap(targetFrac) {
    cancelRaf();
    const target = Math.round(targetFrac);
    const dateKey = toKey(offsetToDate(target));
    committed.current = target;
    liveOffset.current = target;
    dragOffset.current = 0;
    onSelect(dateKey);
    setRender(r => r + 1);
  }

  function runMomentum() {
    cancelRaf();
    const FRICTION = 0.88;
    const tick = () => {
      velocity.current *= FRICTION;
      if (Math.abs(velocity.current) < 0.02) {
        snap(liveOffset.current);
        return;
      }
      liveOffset.current -= velocity.current / DAY_W;
      setRender(r => r + 1);
      rafId.current = requestAnimationFrame(tick);
    };
    rafId.current = requestAnimationFrame(tick);
  }

  function onTouchStart(e) {
    cancelRaf();
    lastX.current = e.touches[0].clientX;
    lastT.current = performance.now();
    velocity.current = 0;
    dragOffset.current = 0;
  }

  function onTouchMove(e) {
    e.preventDefault();
    const x = e.touches[0].clientX;
    const t = performance.now();
    const dx = x - lastX.current;
    const dt = t - lastT.current || 1;
    velocity.current = dx / dt; // px/ms
    liveOffset.current -= dx / DAY_W;
    lastX.current = x;
    lastT.current = t;
    setRender(r => r + 1);
  }

  function onTouchEnd() {
    if (Math.abs(velocity.current) < 0.05) {
      snap(liveOffset.current);
    } else {
      runMomentum();
    }
  }

  // Sync liveOffset when selected changes externally (e.g. "today" button)
  useEffect(() => {
    const n = dayOffset(selected);
    if (Math.round(liveOffset.current) !== n) {
      committed.current = n;
      liveOffset.current = n;
      setRender(r => r + 1);
    }
  }, [selected]);

  // Derive display from liveOffset
  const centerDate  = offsetToDate(liveOffset.current);
  const centerYear  = centerDate.getFullYear();
  const centerMonth = centerDate.getMonth();
  const daysInMonth = new Date(centerYear, centerMonth + 1, 0).getDate();
  const dayInMonth  = centerDate.getDate(); // 1-based

  // Year band: position = fraction of year elapsed → moves ~1px per 4 days
  // We show a ribbon of years centered on centerYear
  const yearFrac    = (liveOffset.current) / 365.25;   // years from epoch
  const yearPx      = yearFrac * 120;  // 120px per year visually

  // Month band: position in months from epoch
  const monthsFromEpoch = (centerYear - 2026) * 12 + centerMonth; // months since Jan 2026
  const monthFracWithin = (dayInMonth - 1) / daysInMonth;        // 0→1 within month
  const monthFloat      = monthsFromEpoch + monthFracWithin;
  const MONTH_W = 100; // px per month on ribbon

  // Day band: DAY_W px per day
  const dayPx = liveOffset.current * DAY_W;

  // Build visible day range for day ribbon (±14 days around center)
  const visibleDays = [];
  for (let i = -14; i <= 14; i++) {
    const d = offsetToDate(Math.round(liveOffset.current) + i);
    visibleDays.push({ d, offset: i });
  }

  // Build visible months for month ribbon (±5 months)
  const visibleMonths = [];
  for (let i = -5; i <= 5; i++) {
    const mIdx = monthsFromEpoch + i;
    const yr   = 2026 + Math.floor(mIdx / 12);
    const mo   = ((mIdx % 12) + 12) % 12;
    visibleMonths.push({ label: MONTHS_FULL[mo].slice(0,3).toUpperCase(), yr, mIdx, i });
  }

  // Build visible years (±2)
  const centerYearInt = Math.round(yearFrac) + 2026;
  const visibleYears = [-2,-1,0,1,2].map(i => centerYearInt + i);

  const selKey = toKey(offsetToDate(Math.round(liveOffset.current)));

  return (
    <div ref={containerRef} style={{overflow:"hidden",userSelect:"none"}}>
      {/* ── Year ribbon ── very slow */}
      <div style={{
        height:28, overflow:"hidden", position:"relative",
        borderBottom:`1px solid ${C.border}`,
        background:"transparent",
      }}>
        <div style={{
          position:"absolute", top:0,
          left:"50%",
          display:"flex", alignItems:"center",
          transform:`translateX(calc(-50% - ${yearPx % (120 * visibleYears.length)}px))`,
          willChange:"transform",
          transition:"none",
        }}>
          {visibleYears.map(yr => (
            <div key={yr} style={{
              width:120, textAlign:"center", flexShrink:0,
              fontFamily:mono, fontSize:9, letterSpacing:"0.2em",
              color: yr === centerYear ? C.muted : C.dim,
              textTransform:"uppercase",
              lineHeight:"28px",
            }}>{yr}</div>
          ))}
        </div>
      </div>

      {/* ── Month ribbon ── medium speed */}
      <div style={{
        height:36, overflow:"hidden", position:"relative",
        borderBottom:`1px solid ${C.border}`,
      }}>
        <div style={{
          position:"absolute", top:0,
          left:"50%",
          display:"flex", alignItems:"center",
          transform:`translateX(calc(-50% - ${(monthFloat % (MONTH_W * 24)) * MONTH_W}px))`,
          willChange:"transform",
        }}>
          {visibleMonths.map(({label,yr,mIdx,i}) => {
            const isCenter = i === 0;
            return (
              <div key={mIdx} style={{
                width:MONTH_W, textAlign:"center", flexShrink:0,
                fontFamily:serif, fontSize: isCenter ? 16 : 13,
                letterSpacing:"-0.01em",
                color: isCenter ? C.text : C.muted,
                lineHeight:"36px",
                transition:"font-size 0.15s, color 0.15s",
              }}>{label.charAt(0) + label.slice(1).toLowerCase()}</div>
            );
          })}
        </div>
      </div>

      {/* ── Day ribbon ── fastest, touch target */}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          height:56, overflow:"hidden", position:"relative",
          borderBottom:`1px solid ${C.border}`,
          touchAction:"none",
        }}
      >
        {/* Center selection indicator */}
        <div style={{
          position:"absolute", top:0, bottom:0,
          left:"50%", transform:"translateX(-50%)",
          width:DAY_W,
          background:`${C.accent}18`,
          borderLeft:`1px solid ${C.accent}40`,
          borderRight:`1px solid ${C.accent}40`,
          pointerEvents:"none",
        }}/>
        <div style={{
          position:"absolute", top:0,
          left:"50%",
          display:"flex", alignItems:"center",
          transform:`translateX(calc(-50% - ${(liveOffset.current % visibleDays.length) * DAY_W}px - ${(liveOffset.current - Math.round(liveOffset.current)) * DAY_W}px))`,
          willChange:"transform",
        }}>
          {visibleDays.map(({d, offset}) => {
            const k = toKey(d);
            const isSelected = offset === 0;
            const isToday = k === today;
            const hasEvents = (events[k]||[]).length > 0;
            const dayNames = ["Su","Mo","Tu","We","Th","Fr","Sa"];
            return (
              <div key={k} onClick={() => snap(Math.round(liveOffset.current) + offset)}
                style={{
                  width:DAY_W, flexShrink:0, textAlign:"center",
                  cursor:"pointer", padding:"6px 0",
                }}>
                <div style={{
                  fontFamily:mono, fontSize:8, letterSpacing:"0.06em",
                  color: isSelected ? C.accent : C.muted,
                  marginBottom:2,
                }}>{dayNames[d.getDay()]}</div>
                <div style={{
                  fontFamily:serif, fontSize: isSelected ? 22 : 17,
                  lineHeight:1, fontWeight: isSelected ? "600" : "normal",
                  color: isToday ? C.accent : isSelected ? C.text : C.muted,
                  transition:"font-size 0.1s",
                }}>{d.getDate()}</div>
                {hasEvents && <div style={{
                  width:4, height:4, borderRadius:"50%",
                  background: isSelected ? C.accent : C.dim,
                  margin:"3px auto 0",
                }}/>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected day events list */}
      {(()=>{
        const selEvts = (events[selKey]||[]).slice().sort((a,b)=>(a.time||"").localeCompare(b.time||""));
        const selDate = offsetToDate(Math.round(liveOffset.current));
        const selLabel = selDate.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"});
        return (
          <div style={{padding:"10px 16px", minHeight:60, flex:1, overflowY:"auto"}}>
            <div style={{fontFamily:mono,fontSize:8,color:C.muted,letterSpacing:"0.1em",
              textTransform:"uppercase",marginBottom:8}}>{selLabel}</div>
            {selEvts.length === 0
              ? <span style={{fontFamily:mono,fontSize:9,color:C.dim}}>No events</span>
              : selEvts.map((ev,i) => (
                  <div key={i} style={{display:"flex",gap:10,alignItems:"baseline",
                    padding:"5px 0",
                    borderBottom:i<selEvts.length-1?`1px solid ${C.border}`:"none"}}>
                    <span style={{fontFamily:mono,fontSize:10,color:ev.color||C.accent,flexShrink:0,minWidth:60}}>{ev.time}</span>
                    <span style={{fontFamily:serif,fontSize:14,lineHeight:1.4,color:C.text}}>{ev.title}</span>
                  </div>
              ))
            }
          </div>
        );
      })()}
    </div>
  );
}

function CalStrip({selected, onSelect, events, healthDots, dragProps}) {
  const mobile = useIsMobile();
  const [anchor, setAnchor] = useState(() => new Date());
  const days = weekOf(anchor), today = todayKey();

  return (
    <Card>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",
        borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
        <div {...dragProps} style={{cursor:"grab",color:C.dim,fontSize:15,lineHeight:1,
          touchAction:"none",userSelect:"none"}}>⠿</div>
        <div style={{width:3,height:13,borderRadius:2,background:C.blue,flexShrink:0}}/>
        <span style={{fontFamily:mono,fontSize:9,letterSpacing:"0.2em",
          textTransform:"uppercase",color:C.muted}}>Calendar</span>
        <div style={{flex:1}}/>
        {mobile
          ? <button onClick={() => onSelect(todayKey())} style={{
              background:"none",border:"none",cursor:"pointer",color:C.muted,
              fontFamily:mono,fontSize:9,letterSpacing:"0.08em",opacity:0.7,padding:"4px 6px"}}>today</button>
          : [["‹",()=>setAnchor(d=>shift(d,-7))],["today",()=>{setAnchor(new Date());onSelect(todayKey());}],["›",()=>setAnchor(d=>shift(d,7))]].map(([l,fn])=>(
              <button key={l} onClick={fn} style={{background:"none",cursor:"pointer",
                border:"none",color:C.muted,fontFamily:mono,
                padding:l==="today"?"4px 6px":"4px 5px",fontSize:l==="today"?9:14,
                letterSpacing:l==="today"?"0.08em":"0",opacity:0.7,transition:"opacity 0.15s"}}
                onMouseEnter={e=>e.currentTarget.style.opacity="1"}
                onMouseLeave={e=>e.currentTarget.style.opacity="0.7"}>{l}</button>
          ))
        }
      </div>

      {mobile
        ? <MobileCalPicker selected={selected} onSelect={onSelect} events={events}/>
        : (<>
            {/* Desktop: month label + 7-day grid */}
            <div style={{padding:"6px 14px 4px",display:"flex",alignItems:"baseline",gap:6,
              flexShrink:0,borderBottom:`1px solid ${C.border}`}}>
              <span style={{fontFamily:serif,fontSize:14,color:C.text,letterSpacing:"-0.01em"}}>
                {[...new Set(days.map(d=>MON3[d.getMonth()]))].join(" · ")}
              </span>
              <span style={{fontFamily:mono,fontSize:10,color:C.muted}}>{days[0].getFullYear()}</span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",flexShrink:0,overflow:"hidden"}}>
              {days.map((d,i)=>{
                const k=toKey(d),sel=k===selected,tod=k===today;
                const allEvts=(events[k]||[]).slice().sort((a,b)=>(a.time||"").localeCompare(b.time||""));
                const dot=healthDots[k]||{};
                return (
                  <div key={k} onClick={()=>onSelect(k)} style={{cursor:"pointer",
                    borderRight:i<6?`1px solid ${C.border}`:"none",
                    background:sel?`${C.accent}0D`:"transparent",transition:"background 0.15s",
                    display:"flex",flexDirection:"column"}}>
                    <div style={{padding:"8px 6px 5px",display:"flex",flexDirection:"column",
                      alignItems:"center",gap:1,
                      borderBottom:`1px solid ${C.border}`,flexShrink:0,
                      borderTop:sel?`2px solid ${C.accent}`:tod?`2px solid ${C.muted}`:`2px solid transparent`}}>
                      <span style={{fontFamily:mono,fontSize:9,letterSpacing:"0.06em",
                        color:sel?C.accent:C.muted}}>{DAY3[i]}</span>
                      <span style={{fontFamily:serif,fontSize:17,lineHeight:1,
                        color:tod?C.accent:C.text}}>{d.getDate()}</span>
                      <div style={{display:"flex",gap:2,height:4,alignItems:"center",marginTop:1}}>
                        {dot.sleep>=90    &&<span style={{width:3,height:3,borderRadius:"50%",background:C.blue,display:"inline-block"}}/>}
                        {dot.readiness>=90&&<span style={{width:3,height:3,borderRadius:"50%",background:C.green,display:"inline-block"}}/>}
                      </div>
                    </div>
                    <div style={{padding:"5px 6px",display:"flex",flexDirection:"column",
                      gap:3,flex:1,overflow:"hidden"}}>
                      {allEvts.length===0
                        ? <span style={{fontFamily:mono,fontSize:9,color:C.dim}}>—</span>
                        : allEvts.map((ev,ei)=>(
                            <div key={ei} style={{display:"flex",gap:4,alignItems:"baseline"}}>
                              <span style={{fontFamily:mono,fontSize:8,color:ev.color||C.accent,
                                flexShrink:0,whiteSpace:"nowrap",opacity:0.9}}>{ev.time}</span>
                              <span style={{fontFamily:serif,fontSize:11,lineHeight:1.4,
                                wordBreak:"break-word",color:sel?C.text:"#AAA5A0",
                                overflow:"hidden",display:"-webkit-box",
                                WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{ev.title}</span>
                            </div>
                        ))
                      }
                    </div>
                  </div>
                );
              })}
            </div>
          </>)
      }
    </Card>
  );
}

// ─── Skeleton shimmer ─────────────────────────────────────────────────────────
function Shimmer({width="100%", height=14, style={}}) {
  return (
    <div style={{
      width, height, borderRadius:4,
      background:`linear-gradient(90deg, ${C.border} 25%, ${C.border2} 50%, ${C.border} 75%)`,
      backgroundSize:"200% 100%",
      animation:"shimmer 1.4s infinite",
      ...style,
    }}/>
  );
}

// ─── HealthStrip ──────────────────────────────────────────────────────────────
const H_EMPTY={sleepScore:"",sleepHrs:"",sleepEff:"",readinessScore:"",hrv:"",rhr:""};
function HealthStrip({date,token,userId,onHealthChange,onSyncStart,onSyncEnd,dragProps}) {
  const {value:h,setValue:setH,loaded}=useDbSave(date,"health",H_EMPTY,token,userId);
  const set=k=>e=>setH(p=>({...p,[k]:e.target.value}));
  useEffect(()=>{if(loaded)onHealthChange(date,h);},[h,loaded]); // eslint-disable-line
  useEffect(()=>{
    if(!loaded||!token)return;
    onSyncStart("oura");
    fetch(`/api/oura?date=${date}`,{headers:{Authorization:`Bearer ${token}`}})
      .then(r=>r.json()).then(data=>{
        // error:"no_token" means user hasn't set up Oura — silent, not an error
        if(data.error)return;
        // Only fill fields that don't already have manually entered values
        setH(p=>({...p,
          sleepScore:p.sleepScore||data.sleepScore||"",
          sleepHrs:p.sleepHrs||data.sleepHrs||"",
          sleepEff:p.sleepEff||data.sleepQuality||"",
          readinessScore:p.readinessScore||data.readinessScore||"",
          hrv:p.hrv||data.hrv||"",
          rhr:p.rhr||data.rhr||"",
        }));
      }).catch(()=>{}).finally(()=>onSyncEnd("oura"));
  },[date,loaded,token]); // eslint-disable-line

  const metrics=[
    {key:"sleep",label:"Sleep",color:C.blue,score:h.sleepScore,setScore:e=>setH(p=>({...p,sleepScore:e.target.value})),
      fields:[{label:"Hours",value:h.sleepHrs,onChange:set("sleepHrs"),unit:"h"},{label:"Efficiency",value:h.sleepEff,onChange:set("sleepEff"),unit:"%"}]},
    {key:"readiness",label:"Readiness",color:C.green,score:h.readinessScore,setScore:e=>setH(p=>({...p,readinessScore:e.target.value})),
      fields:[{label:"HRV",value:h.hrv,onChange:set("hrv"),unit:"ms"},{label:"Resting HR",value:h.rhr,onChange:set("rhr"),unit:"bpm"}]},

  ];

  const mobileH = useIsMobile();
  return (
    <Card style={{overflow:"visible"}}>
      <div style={{display:"flex",alignItems:"stretch",flexWrap:mobileH?"wrap":"nowrap"}}>
        {!mobileH && <div style={{display:"flex",alignItems:"center",padding:"0 10px",borderRight:`1px solid ${C.border}`}}>
          <div {...dragProps} style={{cursor:"grab",color:C.dim,fontSize:15,lineHeight:1,touchAction:"none",userSelect:"none"}}>⠿</div>
        </div>}
        {metrics.map((m,mi)=>(
          <div key={m.key} style={{flex:mobileH?"1 1 30%":"1 1 0",display:"flex",alignItems:"center",gap:mobileH?8:12,
            padding:mobileH?"10px 10px":"12px 14px",borderRight:(!mobileH&&mi<2)?`1px solid ${C.border}`:"none",
            borderBottom:mobileH&&mi<2?`1px solid ${C.border}`:"none"}}>
            <div style={{position:"relative",flexShrink:0}}>
              <Ring score={m.score} color={m.color} size={48}/>
              <input value={m.score} onChange={m.setScore} style={{position:"absolute",inset:0,opacity:0,cursor:"text",width:"100%",fontSize:16}}/>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontFamily:mono,fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:m.color,marginBottom:6}}>{m.label}</div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                {m.fields.map(f=>(
                  <div key={f.label}>
                    <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",color:C.muted,marginBottom:2,letterSpacing:"0.08em"}}>{f.label}</div>
                    <div style={{display:"flex",alignItems:"baseline",gap:2}}>
                      <input value={f.value} onChange={f.onChange} placeholder="—"
                        style={{background:"transparent",border:"none",outline:"none",padding:0,
                          color:f.value?C.text:C.dim,fontFamily:serif,fontSize:17,width:f.unit?38:80}}/>
                      {f.unit&&<span style={{fontFamily:mono,fontSize:9,color:C.muted}}>{f.unit}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Notes ────────────────────────────────────────────────────────────────────
// ─── Notes ────────────────────────────────────────────────────────────────────
// Plain textarea with a transparent overlay that colorizes "# heading" lines.
// Cmd+B / Cmd+I wrap selected text in ** / *.
function Notes({date,userId,token}) {
  const {value,setValue,loaded} = useDbSave(date,"notes","",token,userId);
  const [editing, setEditing] = useState(false);
  const taRef = useRef(null);

  useEffect(() => {
    if (editing) taRef.current?.focus();
  }, [editing]);

  function wrapSelection(marker) {
    const ta = taRef.current;
    if (!ta) return;
    const {selectionStart:s, selectionEnd:e, value:v} = ta;
    if (s === e) return;
    setValue(v.slice(0,s) + marker + v.slice(s,e) + marker + v.slice(e));
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(s + marker.length, e + marker.length);
    });
  }

  function handleKeyDown(e) {
    if ((e.metaKey||e.ctrlKey) && e.key==="b") { e.preventDefault(); wrapSelection("**"); }
    if ((e.metaKey||e.ctrlKey) && e.key==="i") { e.preventDefault(); wrapSelection("*"); }
  }

  // Render markdown as React elements
  function renderContent(text) {
    if (!text || !text.trim()) return null;
    return text.split("\n").map((line, i) => {
      // Heading
      if (line.startsWith("# ")) {
        return <div key={i} style={{color:"#D4A853",fontFamily:serif,fontSize:16,lineHeight:"1.7"}}>{renderInline(line.slice(2))}</div>;
      }
      // Empty line
      if (!line.trim()) {
        return <div key={i} style={{height:"1.8em"}}>&nbsp;</div>;
      }
      // Normal
      return <div key={i} style={{color:C.text,fontFamily:serif,fontSize:16,lineHeight:"1.7"}}>{renderInline(line)}</div>;
    });
  }

  function renderInline(text) {
    const re = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
    const parts = []; let last=0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      if (m[0].startsWith("**")) parts.push(<strong key={m.index}>{m[2]}</strong>);
      else parts.push(<em key={m.index}>{m[3]}</em>);
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  }

  if (!loaded) return (
    <div style={{display:"flex",flexDirection:"column",gap:10,padding:"4px 0"}}>
      <Shimmer width="80%" height={14}/>
      <Shimmer width="60%" height={14}/>
      <Shimmer width="70%" height={14}/>
      <Shimmer width="40%" height={14}/>
    </div>
  );

  const textareaStyle = {
    fontFamily:serif, fontSize:16, lineHeight:"1.7",
    padding:0, margin:0, border:"none", outline:"none",
    width:"100%", height:"100%", resize:"none",
    background:"transparent", color:C.text, caretColor:C.accent,
    whiteSpace:"pre-wrap", wordBreak:"break-word",
  };

  if (editing) {
    return (
      <textarea
        ref={taRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={handleKeyDown}
        style={textareaStyle}
      />
    );
  }

  return (
    <div
      onClick={() => setEditing(true)}
      style={{height:"100%", overflow:"auto", cursor:"text"}}
    >
      {value && value.trim()
        ? renderContent(value)
        : <div style={{color:C.muted,fontFamily:serif,fontSize:16,lineHeight:"1.7"}}>
            What's on your mind?
          </div>
      }
    </div>
  );
}

// ─── RowList ─────────────────────────────────────────────────────────────────
function RowList({date,type,placeholder,promptFn,prefix,color,token,userId}) {
  const mkRow=()=>({id:Date.now(),text:"",kcal:null});
  const {value:rows,setValue:setRows,loaded}=useDbSave(date,type,[mkRow()],token,userId);
  const refs=useRef({});
  const safe=Array.isArray(rows)&&rows.length?rows:[mkRow()];
  const total=safe.reduce((s,r)=>s+(r.kcal||0),0);

  async function runEstimate(id,text){
    setRows(safe.map(r=>r.id===id?{...r,estimating:true}:r));
    const kcal=await estimateKcal(promptFn(text)).catch(()=>null);
    setRows(prev=>(Array.isArray(prev)?prev:safe).map(r=>r.id===id?{...r,kcal,estimating:false}:r));
  }
  function onKey(e,id,idx){
    if(e.key==="Enter"){e.preventDefault();const row=mkRow();setRows([...safe.slice(0,idx+1),row,...safe.slice(idx+1)]);setTimeout(()=>refs.current[row.id]?.focus(),30);}
    if(e.key==="Backspace"&&safe[idx].text===""&&safe.length>1){e.preventDefault();setRows(safe.filter(r=>r.id!==id));const t=safe[idx-1]?.id??safe[idx+1]?.id;setTimeout(()=>refs.current[t]?.focus(),30);}
  }
  if(!loaded) return (
    <div style={{display:"flex",flexDirection:"column",gap:8,padding:"4px 0"}}>
      <Shimmer width="75%" height={13}/>
      <Shimmer width="55%" height={13}/>
      <Shimmer width="65%" height={13}/>
    </div>
  );
  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
      {/* Scrollable rows — flex:1 fills space, total stays visible below */}
      <div style={{flex:1,overflowY:"auto",minHeight:0}}>
        {safe.map((row,idx)=>(
          <div key={row.id} style={{display:"flex",alignItems:"baseline",gap:8,padding:"2px 0",minHeight:28}}>
            <input ref={el=>refs.current[row.id]=el} value={row.text}
              onChange={e=>setRows(safe.map(r=>r.id===row.id?{...r,text:e.target.value,kcal:null}:r))}
              onBlur={e=>{const r=safe.find(r=>r.id===row.id);if(e.target.value.trim()&&r?.kcal===null&&!r?.estimating)runEstimate(row.id,e.target.value);}}
              onKeyDown={e=>onKey(e,row.id,idx)} placeholder={idx===0?placeholder:""}
              style={{background:"transparent",border:"none",outline:"none",padding:0,flex:1,lineHeight:1.7,
                color:row.text?C.text:C.muted,fontFamily:serif,fontSize:16}}/>
            <span style={{fontFamily:mono,fontSize:10,color,flexShrink:0,minWidth:38,textAlign:"right",opacity:0.85}}>
              {row.estimating?"…":row.kcal?`${prefix}${row.kcal}`:""}
            </span>
          </div>
        ))}
      </div>
      {/* Total always visible at bottom, outside scroll area */}
      {total>0&&(
        <div style={{flexShrink:0,paddingTop:6,display:"flex",alignItems:"center",gap:8,borderTop:`1px solid ${C.border}`}}>
          <div style={{flex:1}}/>
          <span style={{fontFamily:mono,fontSize:11,color,opacity:0.9}}>{prefix}{total} kcal</span>
        </div>
      )}
    </div>
  );
}
function Meals({date,token,userId}){return <RowList date={date} type="meals" token={token} userId={userId} placeholder="What did you eat?" promptFn={t=>`Calories in: "${t}". Return JSON: {"kcal":420}`} prefix="" color={C.accent}/>;}
function Activity({date,token,userId}){return <RowList date={date} type="activity" token={token} userId={userId} placeholder="What did you do?" promptFn={t=>`Calories burned: "${t}" for a typical adult. Return JSON: {"kcal":300}`} prefix="−" color={C.green}/>;}

// ─── Tasks ────────────────────────────────────────────────────────────────────
function Tasks({date,token,userId}) {
  const mkRow=()=>({id:Date.now(),text:"",done:false});
  const {value:rows,setValue:setRows,loaded}=useDbSave(date,"tasks",[mkRow()],token,userId);
  const refs=useRef({});
  const safe=Array.isArray(rows)&&rows.length?rows:[mkRow()];
  const open=safe.filter(r=>!r.done),done=safe.filter(r=>r.done);
  function onKey(e,id,idx){
    if(e.key==="Enter"){e.preventDefault();const row=mkRow();setRows([...safe.slice(0,idx+1),row,...safe.slice(idx+1)]);setTimeout(()=>refs.current[row.id]?.focus(),30);}
    if(e.key==="Backspace"&&safe[idx].text===""&&safe.length>1){e.preventDefault();setRows(safe.filter(r=>r.id!==id));if(safe[idx-1])setTimeout(()=>refs.current[safe[idx-1].id]?.focus(),30);}
  }
  if(!loaded) return (
    <div style={{display:"flex",flexDirection:"column",gap:8,padding:"4px 0"}}>
      <Shimmer width="75%" height={13}/>
      <Shimmer width="55%" height={13}/>
      <Shimmer width="65%" height={13}/>
    </div>
  );
  return (
    <div style={{flex:1,overflow:"auto"}}>
      {[...open,...done].map((row,idx)=>(
        <div key={row.id} style={{display:"flex",alignItems:"center",gap:10,padding:"4px 0",minHeight:28,
          opacity:row.done?0.35:1,transition:"opacity 0.2s"}}>
          <button onClick={()=>setRows(safe.map(r=>r.id===row.id?{...r,done:!r.done}:r))}
            style={{width:15,height:15,flexShrink:0,borderRadius:4,padding:0,cursor:"pointer",
              border:`1.5px solid ${row.done?C.accent:C.border2}`,background:row.done?C.accent:"transparent",
              display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.15s"}}>
            {row.done&&<span style={{fontSize:8,color:C.bg,lineHeight:1}}>✓</span>}
          </button>
          <input ref={el=>refs.current[row.id]=el} value={row.text}
            onChange={e=>setRows(safe.map(r=>r.id===row.id?{...r,text:e.target.value}:r))}
            onKeyDown={e=>onKey(e,row.id,idx)}
            placeholder={idx===0&&open.length===1&&!row.text?"Add a task…":""}
            style={{background:"transparent",border:"none",outline:"none",padding:0,flex:1,lineHeight:1.7,
              color:row.done?C.muted:C.text,fontFamily:serif,fontSize:16,textDecoration:row.done?"line-through":"none"}}/>
        </div>
      ))}
    </div>
  );
}

// ─── Login ────────────────────────────────────────────────────────────────────
function LoginScreen() {
  const [loading,setLoading]=useState(false);
  return (
    <div style={{background:C.bg,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontFamily:serif,fontSize:32,color:C.text,marginBottom:6,letterSpacing:"-0.02em"}}>Life OS</div>
        <div style={{fontFamily:mono,fontSize:9,color:C.muted,letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:48}}>your personal dashboard</div>
        <button disabled={loading} onClick={async()=>{
          setLoading(true);
          const supabase=createClient();
          await supabase.auth.signInWithOAuth({provider:"google",options:{
            scopes:"https://www.googleapis.com/auth/calendar.readonly",
            redirectTo:`${window.location.origin}/auth/callback`,
          }});
        }} style={{background:"none",border:`1px solid ${C.border2}`,borderRadius:8,
          color:loading?C.muted:C.text,fontFamily:mono,fontSize:10,letterSpacing:"0.15em",
          textTransform:"uppercase",padding:"13px 32px",cursor:loading?"not-allowed":"pointer"}}>
          {loading?"redirecting…":"sign in with google"}
        </button>
      </div>
    </div>
  );
}

// ─── Widget definitions ───────────────────────────────────────────────────────
const WIDGET_DEFS = [
  {id:"notes",    label:"Notes",    color:C.accent, Comp:Notes},
  {id:"tasks",    label:"Tasks",    color:C.blue,   Comp:Tasks},
  {id:"meals",    label:"Meals",    color:C.red,    Comp:Meals},
  {id:"activity", label:"Activity", color:C.green,  Comp:Activity},
];
const FULL_IDS   = ["cal","health"];
const WIDGET_IDS = WIDGET_DEFS.map(w=>w.id);

// ─── ResizeHandle ────────────────────────────────────────────────────────────
function ResizeHandle({onPointerDown}) {
  return (
    <div onPointerDown={onPointerDown} style={{
      height:10,display:"flex",alignItems:"center",justifyContent:"center",
      cursor:"ns-resize",flexShrink:0,
    }}>
      <div style={{
        width:32,height:3,borderRadius:2,background:C.border,
        transition:"background 0.15s",
      }}
        onPointerEnter={e=>e.currentTarget.style.background=C.accent}
        onPointerLeave={e=>e.currentTarget.style.background=C.border}
      />
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [theme, setTheme] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("theme") || "dark";
    return "dark";
  });
  // Set C globally before any render
  C = THEMES[theme] || THEMES.dark;

  const [session,   setSession]   = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [selected,  setSelected]  = useState(todayKey);
  const [events,    setEvents]    = useState({});
  const [healthDots,setHealthDots]= useState({});
  const [syncing,   setSyncing]   = useState(new Set());
  const [lastSync,  setLastSync]  = useState(null);

  // Full-width sections order
  const [fullOrder, setFullOrder] = useState(FULL_IDS);
  // Left column: first widget; right column: rest
  const [leftId,    setLeftId]    = useState("notes");
  const [rightOrder,setRightOrder]= useState(["tasks","meals","activity"]);

  // Heights (resizable)
  const [heights, setHeights] = useState({
    cal:300,
    tasks:1, meals:1, activity:1,  // flex ratios for right column
  });

  const sensors = useSensors(useSensor(PointerSensor,{activationConstraint:{distance:8}}));

  useEffect(()=>{
    localStorage.setItem("theme", theme);
    C = THEMES[theme] || THEMES.dark;
  },[theme]);

  useEffect(()=>{
    const supabase=createClient();
    const code=new URLSearchParams(window.location.search).get("code");
    if(code){supabase.auth.exchangeCodeForSession(code).then(()=>window.history.replaceState({},document.title,window.location.pathname));}
    supabase.auth.getSession().then(({data:{session}})=>{
      clearCacheForUser(session?.user?.id ?? null);
      setSession(session);setAuthReady(true);
    });
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_,s)=>{
      clearCacheForUser(s?.user?.id ?? null);
      setSession(s);setAuthReady(true);
    });
    return ()=>subscription.unsubscribe();
  },[]);

  const token=session?.access_token;
  const userId=session?.user?.id ?? null;
  const googleToken=session?.provider_token;
  const startSync=useCallback(k=>setSyncing(s=>new Set([...s,k])),[]);
  const endSync=useCallback(k=>{
    setSyncing(s=>{const n=new Set(s);n.delete(k);return n;});
    setLastSync(new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}));
  },[]);

  useEffect(()=>{
    if(!googleToken)return;
    startSync("cal");
    fetch("/api/calendar",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({token:googleToken,start:toKey(shift(new Date(),-7)),end:toKey(shift(new Date(),21))})})
      .then(r=>r.json()).then(d=>{if(d.events)setEvents(d.events);}).catch(()=>{}).finally(()=>endSync("cal"));
  },[googleToken]); // eslint-disable-line

  const onHealthChange=useCallback((date,data)=>{
    setHealthDots(prev=>({...prev,[date]:{sleep:+data.sleepScore||0,readiness:+data.readinessScore||0}}));
  },[]);

  const wMap=Object.fromEntries(WIDGET_DEFS.map(w=>[w.id,w]));

  function makeResizeHandler(id) {
    return function(e){
      e.preventDefault(); e.stopPropagation();
      if (id === "cal") {
        // Cal uses px height
        const startY=e.clientY, startH=heights.cal;
        function onMove(e){setHeights(h=>({...h,cal:Math.max(120,startH+(e.clientY-startY))}));}
        function onUp(){window.removeEventListener("pointermove",onMove);window.removeEventListener("pointerup",onUp);}
        window.addEventListener("pointermove",onMove);
        window.addEventListener("pointerup",onUp);
      } else {
        // Right column widgets use flex ratios
        const startY=e.clientY, startRatio=heights[id]||1;
        function onMove(e){
          const delta=(e.clientY-startY)/100; // scale delta to ratio units
          setHeights(h=>({...h,[id]:Math.max(0.2,startRatio+delta)}));
        }
        function onUp(){window.removeEventListener("pointermove",onMove);window.removeEventListener("pointerup",onUp);}
        window.addEventListener("pointermove",onMove);
        window.addEventListener("pointerup",onUp);
      }
    };
  }

  // All hooks must be called before any conditional returns
  const mobile = useIsMobile();

  // Drag handling for full-width sections
  const [activeId,setActiveId]=useState(null);
  function handleDragStart({active}){setActiveId(active.id);}
  function handleDragEnd({active,over}){
    setActiveId(null);
    if(!over||active.id===over.id)return;
    setFullOrder(o=>arrayMove(o,o.indexOf(active.id),o.indexOf(over.id)));
  }

  if(!authReady) return (
    <div style={{background:C.bg,height:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <span style={{fontFamily:mono,fontSize:9,color:C.muted,letterSpacing:"0.2em"}}>loading…</span>
    </div>
  );
  if(!session) return <LoginScreen/>;

  const syncStatus={syncing:syncing.size>0,lastSync};
  const leftWidget  = wMap[leftId];
  const rightWidgets = rightOrder.map(id=>wMap[id]).filter(Boolean);
  const calH = mobile ? 200 : heights.cal;

  return (
    <div style={{background:C.bg,height:"100vh",color:C.text,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        html,body{height:100%;overflow:hidden;background:${C.bg};}
        ::-webkit-scrollbar{width:3px;height:3px;}
        ::-webkit-scrollbar-thumb{background:${C.border2};border-radius:4px;}
        button{border-radius:0;}
        input::placeholder,textarea::placeholder{color:${C.muted};opacity:1;}
        a{text-decoration:none;}
        input,textarea,select{font-size:16px;}
        @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
      `}</style>

      <TopBar session={session} token={token} userId={userId} syncStatus={syncStatus} theme={theme} onThemeChange={setTheme}/>

      {mobile ? (
        /* ── MOBILE: single scrollable column with drag ─────────────────── */
        <div style={{flex:1,overflowY:"auto",padding:8,display:"flex",flexDirection:"column",gap:8}}>
          {/* Cal + Health sortable */}
          <DndContext sensors={sensors} collisionDetection={closestCenter}
            onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <SortableContext items={fullOrder} strategy={verticalListSortingStrategy}>
              {fullOrder.map(id=>(
                <div key={id}>
                  <SortableCard id={id}>
                    {({dragProps})=>
                      id==="cal"
                        ? <div style={{height:calH,flexShrink:0}}>
                            <CalStrip selected={selected} onSelect={setSelected}
                              events={events} healthDots={healthDots} dragProps={dragProps}/>
                          </div>
                        : <HealthStrip date={selected} token={token} userId={userId}
                            onHealthChange={onHealthChange} onSyncStart={startSync} onSyncEnd={endSync}
                            dragProps={dragProps}/>
                    }
                  </SortableCard>
                </div>
              ))}
            </SortableContext>
            <DragOverlay>
              {activeId&&(
                <div style={{background:C.card,border:`1px solid ${C.accent}`,borderRadius:R,
                  padding:"12px 18px",fontFamily:mono,fontSize:10,color:C.accent}}>
                  {activeId==="cal"?"Calendar":"Health"}
                </div>
              )}
            </DragOverlay>
          </DndContext>
          {/* Widgets stacked, each draggable by their grab handle */}
          {[leftWidget,...rightWidgets].map(w=>(
            <div key={w.id} style={{minHeight:220}}>
              <Widget label={w.label} color={w.color} dragProps={{}}>
                <w.Comp date={selected} token={token} userId={userId}/>
              </Widget>
            </div>
          ))}
        </div>
      ) : (
        /* ── DESKTOP: fixed layout ──────────────────────────────────────── */
        <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column",padding:10,gap:8,minHeight:0}}>

          {/* Full-width: cal + health */}
          <DndContext sensors={sensors} collisionDetection={closestCenter}
            onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <SortableContext items={fullOrder} strategy={verticalListSortingStrategy}>
              <div style={{display:"flex",flexDirection:"column",gap:0,flexShrink:0}}>
                {fullOrder.map((id,idx)=>(
                  <div key={id} style={{marginBottom:idx<fullOrder.length-1?8:0}}>
                    <SortableCard id={id}>
                      {({dragProps})=>
                        id==="cal"
                          ? <div style={{height:heights.cal}}>
                              <CalStrip selected={selected} onSelect={setSelected}
                                events={events} healthDots={healthDots} dragProps={dragProps}/>
                            </div>
                          : <HealthStrip date={selected} token={token} userId={userId}
                              onHealthChange={onHealthChange} onSyncStart={startSync} onSyncEnd={endSync}
                              dragProps={dragProps}/>
                      }
                    </SortableCard>
                    {id==="cal" && <ResizeHandle onPointerDown={makeResizeHandler("cal")}/> }
                  </div>
                ))}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeId&&(
                <div style={{background:C.card,border:`1px solid ${C.accent}`,borderRadius:R,
                  padding:"12px 18px",fontFamily:mono,fontSize:10,letterSpacing:"0.15em",
                  textTransform:"uppercase",color:C.accent,boxShadow:"0 12px 40px rgba(0,0,0,0.7)"}}>
                  {activeId==="cal"?"Calendar":"Health"}
                </div>
              )}
            </DragOverlay>
          </DndContext>

          {/* Widget area — fills remaining space */}
          <div style={{flex:1,display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,minHeight:0}}>
            <div style={{minHeight:0,height:"100%"}}>
              <Widget label={leftWidget.label} color={leftWidget.color} dragProps={{}}>
                <leftWidget.Comp date={selected} token={token} userId={userId}/>
              </Widget>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8,minHeight:0}}>
              {rightWidgets.map((w,i)=>(
                <div key={w.id} style={{flex:heights[w.id]||1,minHeight:80,display:"flex",flexDirection:"column"}}>
                  <div style={{flex:1,minHeight:0}}>
                    <Widget label={w.label} color={w.color} dragProps={{}}>
                      <w.Comp date={selected} token={token} userId={userId}/>
                    </Widget>
                  </div>
                  {i < rightWidgets.length-1 && <ResizeHandle onPointerDown={makeResizeHandler(w.id)}/>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
