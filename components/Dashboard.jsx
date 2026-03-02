"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
    // Warm parchment — Substack-inspired. bg and card are close tones, no harsh whites.
    bg:"#EFEBE4", surface:"#E8E4DC", card:"#F5F2ED",
    border:"#DDD8D0", border2:"#CCC7BE",
    text:"#1A1714", muted:"#857F78", dim:"#C0BAB2",
    accent:"#8B6030", green:"#376B48", blue:"#2E5A82",
    yellow:"#8A6A20", red:"#7A3030",
    shadow:"0 1px 2px rgba(40,25,10,0.07),0 2px 6px rgba(40,25,10,0.04)",
    shadowSm:"0 1px 2px rgba(40,25,10,0.05)",
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

const toKey = d => {
  const dt = d instanceof Date ? d : new Date(d);
  // Use local date parts — toISOString() gives UTC which is wrong for US timezones at night
  return [dt.getFullYear(), String(dt.getMonth()+1).padStart(2,"0"), String(dt.getDate()).padStart(2,"0")].join("-");
};
const todayKey = () => toKey(new Date());
const shift    = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };
const DAY3 = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MON3 = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function weekOf(anchor) {
  const d=new Date(anchor); d.setDate(d.getDate()-d.getDay());
  return Array.from({length:7},(_,i)=>shift(d,i));
}

// ─── AI ───────────────────────────────────────────────────────────────────────
async function estimateKcal(prompt, token) {
  const headers = {"Content-Type":"application/json"};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const r = await fetch("/api/ai",{method:"POST",headers,
    body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:64,
      system:"Return only valid JSON with a single `kcal` integer field. No explanation.",
      messages:[{role:"user",content:prompt}]})});
  const d = await r.json();
  if (d.error) { console.warn("[ai]", d.error); return null; }
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
      overflow:"clip",height:"100%",
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
  const [stravaClientId,setStravaClientId]=useState("");
  const [stravaClientSecret,setStravaClientSecret]=useState("");
  const [stravaConnected,setStravaConnected]=useState(false);
  const [saved,setSaved]=useState(false);
  const [saving,setSaving]=useState(false);
  const ref=useRef(null);
  const user=session?.user;
  const initials=user?.user_metadata?.name?.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()||user?.email?.[0]?.toUpperCase()||"?";
  const avatar=user?.user_metadata?.avatar_url;

  const [loadErr,setLoadErr]=useState(false);
  useEffect(()=>{
    if(!token||!open)return;
    setLoadErr(false);
    dbLoad("global","settings",token).then(d=>{
      console.log("[settings load]", d);
      if(d===null){setLoadErr(true);return;}
      if(d?.ouraToken)setOuraKey(d.ouraToken);
      if(d?.anthropicKey)setAnthropicKey(d.anthropicKey);
      if(d?.stravaClientId)setStravaClientId(d.stravaClientId);
      if(d?.stravaClientSecret)setStravaClientSecret(d.stravaClientSecret);
      // Check if strava token exists
      fetch("/api/entries?date=0000-00-00&type=strava_token",{headers:{Authorization:`Bearer ${token}`}})
        .then(r=>r.json()).then(d=>{if(d?.data?.access_token)setStravaConnected(true);}).catch(()=>{});
    }).catch(e=>{console.error("[settings load err]",e);setLoadErr(true);});
  },[token,open]); // eslint-disable-line
  useEffect(()=>{
    if(!open)return;
    const fn=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};
    document.addEventListener("mousedown",fn);
    return ()=>document.removeEventListener("mousedown",fn);
  },[open]);

  async function saveSettings(){
    setSaving(true);
    try {
      const r = await fetch("/api/entries",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
        body:JSON.stringify({date:"global",type:"settings",data:{ouraToken:ouraKey,anthropicKey,stravaClientId,stravaClientSecret}}),
      });
      const result = await r.json();
      console.log("[settings save]", r.status, result);
      if(!r.ok) throw new Error(result.error||r.status);
      setSaving(false);setSaved(true);setTimeout(()=>setSaved(false),2000);
    } catch(e) {
      console.error("[settings save err]",e);
      setSaving(false);setSaved(false);
      alert("Save failed: "+e.message);
    }
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
          <div style={{height:1,background:C.border}}/>
          <div style={{fontFamily:mono,fontSize:8,letterSpacing:"0.15em",textTransform:"uppercase",color:C.muted}}>Strava</div>
          {[
            {label:"Strava Client ID",value:stravaClientId,set:setStravaClientId,ph:"12345",pw:false},
            {label:"Strava Client Secret",value:stravaClientSecret,set:setStravaClientSecret,ph:"abc123…",pw:true},
          ].map(({label,value,set,ph,pw})=>(
            <div key={label}>
              <div style={{fontFamily:mono,fontSize:8,letterSpacing:"0.12em",textTransform:"uppercase",color:C.muted,marginBottom:5}}>{label}</div>
              <input type={pw?"password":"text"} value={value} onChange={e=>{set(e.target.value);setSaved(false);}} placeholder={ph}
                style={{width:"100%",background:C.surface,border:`1px solid ${C.border2}`,borderRadius:6,outline:"none",
                  color:C.text,fontFamily:mono,fontSize:10,padding:"7px 10px"}}/>
            </div>
          ))}
          <button
            disabled={!stravaClientId||!stravaClientSecret||!saved}
            onClick={()=>{
              const redirect=encodeURIComponent(window.location.origin+"/strava-callback");
              const scope="read,activity:read_all";
              window.open(`https://www.strava.com/oauth/authorize?client_id=${stravaClientId}&redirect_uri=${redirect}&response_type=code&scope=${scope}&approval_prompt=auto`,"_blank","width=600,height=700");
            }}
            style={{
              width:"100%",background:stravaConnected?C.green+"22":"transparent",
              border:`1px solid ${stravaConnected?C.green:"#FC4C02"}`,
              borderRadius:6,color:stravaConnected?C.green:"#FC4C02",
              fontFamily:mono,fontSize:9,letterSpacing:"0.12em",textTransform:"uppercase",
              padding:"7px",cursor:(!stravaClientId||!stravaClientSecret||!saved)?"not-allowed":"pointer",
              opacity:(!stravaClientId||!stravaClientSecret||!saved)?0.5:1,transition:"all 0.2s"}}>
            {stravaConnected?"✓ strava connected":"connect strava"}
          </button>
          <div style={{height:1,background:C.border}}/>
          {loadErr&&<div style={{fontFamily:mono,fontSize:8,color:C.red,letterSpacing:"0.08em"}}>
            couldn't load saved keys — check console
          </div>}
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
function TopBar({session,token,userId,syncStatus,theme,onThemeChange,selected}) {
  // Format selected date as "Mon, Mar 1" — the actual context anchor
  const [dateLabel, setDateLabel] = useState("");
  const [isToday, setIsToday] = useState(false);
  useEffect(() => {
    if (!selected) return;
    const selDate = new Date(selected + "T12:00:00");
    const today = toKey(new Date());
    setIsToday(selected === today);
    setDateLabel(selDate.toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric"
    }));
  }, [selected]);
  return (
    <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,padding:"0 16px",
      height:48,display:"flex",alignItems:"center",gap:12,flexShrink:0,
      position:"sticky",top:0,zIndex:100}}>
      <div style={{display:"flex",alignItems:"baseline",gap:7}}>
        <span style={{fontFamily:serif,fontSize:16,color:C.text,letterSpacing:"-0.01em"}}>{dateLabel}</span>
        {isToday && <span style={{fontFamily:mono,fontSize:8,color:C.accent,letterSpacing:"0.12em",
          textTransform:"uppercase",opacity:0.9}}>today</span>}
      </div>
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

// ─── CalStrip ─────────────────────────────────────────────────────────────────
// Single epoch: Jan 1 2026. All offsets are integer days from this point.
const MONTHS_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// Convert a YYYY-MM-DD key or Date to an integer day number.
// We avoid epoch subtraction entirely — just count calendar days from a fixed point.
// This sidesteps ALL timezone/DST issues.
function keyToDayNum(key) {
  // key is always "YYYY-MM-DD" local date
  const [y, m, d] = key.split("-").map(Number);
  // Days since a distant fixed point (Jan 1 2000) using pure calendar math
  // Zeller-like: count days in each year/month without Date arithmetic
  function daysFromY2K(yr, mo, dy) {
    let total = 0;
    for (let y = 2000; y < yr; y++) {
      total += (y%4===0&&(y%100!==0||y%400===0)) ? 366 : 365;
    }
    const mdays = [0,31,28,31,30,31,30,31,31,30,31,30,31];
    if (yr%4===0&&(yr%100!==0||yr%400===0)) mdays[2]=29;
    for (let m2 = 1; m2 < mo; m2++) total += mdays[m2];
    return total + dy - 1;
  }
  return daysFromY2K(y, m, d);
}

function dayOffset(dateOrKey) {
  const key = typeof dateOrKey === "string" ? dateOrKey : toKey(dateOrKey);
  return keyToDayNum(key);
}

function offsetToDate(n) {
  // Convert day number back to a local Date at noon
  // We walk from Y2K adding years/months until we land on the right day
  let rem = Math.round(n);
  let yr = 2000;
  while (true) {
    const isLeap = yr%4===0&&(yr%100!==0||yr%400===0);
    const ydays = isLeap ? 366 : 365;
    if (rem < ydays) break;
    rem -= ydays; yr++;
  }
  const mdays = [0,31,28,31,30,31,30,31,31,30,31,30,31];
  if (yr%4===0&&(yr%100!==0||yr%400===0)) mdays[2]=29;
  let mo = 1;
  while (rem >= mdays[mo]) { rem -= mdays[mo]; mo++; }
  // Return as a local noon Date (noon avoids any DST edge)
  return new Date(yr, mo-1, rem+1, 12, 0, 0);
}

// Mobile date picker — horizontal day strip with physics momentum
// Month and year are static labels (snap discretely). Only the day ribbon moves.
function MobileCalPicker({selected, onSelect, events, healthDots={}, desktop=false}) {
  const today = todayKey();
  const DAY_W = desktop ? 72 : 52;

  // Single source of truth: fractional day offset from epoch
  const liveOff    = useRef(dayOffset(selected));
  const vel        = useRef(0);          // px/frame rolling average
  const lastX      = useRef(null);
  const lastT      = useRef(null);
  const totalDrag  = useRef(0);          // total px dragged this gesture
  const rafId      = useRef(null);
  const [, bump]   = useState(0);
  const repaint    = () => bump(n => n + 1);

  function cancelRaf() {
    if (rafId.current) { cancelAnimationFrame(rafId.current); rafId.current = null; }
  }

  // Animate liveOff toward a target with spring ease-out
  function animateTo(target) {
    cancelRaf();
    vel.current = 0;
    const startVal = liveOff.current;
    const startTime = performance.now();
    const DURATION = 280; // ms — feel of a physical spinner click
    const tick = (now) => {
      const t = Math.min((now - startTime) / DURATION, 1);
      // Ease-out cubic: decelerates gently into place
      const ease = 1 - Math.pow(1 - t, 3);
      liveOff.current = startVal + (target - startVal) * ease;
      repaint();
      if (t < 1) {
        rafId.current = requestAnimationFrame(tick);
      } else {
        liveOff.current = target;
        repaint();
        onSelect(toKey(offsetToDate(target)));
      }
    };
    rafId.current = requestAnimationFrame(tick);
  }

  function snap() {
    animateTo(Math.round(liveOff.current));
  }

  function runMomentum() {
    cancelRaf();
    const FRICTION = 0.86;
    const tick = () => {
      vel.current *= FRICTION;
      liveOff.current -= vel.current / DAY_W;
      repaint();
      // Once velocity is low enough, hand off to the smooth snap animation
      if (Math.abs(vel.current) > 1.5) {
        rafId.current = requestAnimationFrame(tick);
      } else {
        animateTo(Math.round(liveOff.current));
      }
    };
    rafId.current = requestAnimationFrame(tick);
  }

  const onTouchStart = e => {
    cancelRaf();
    vel.current = 0;
    totalDrag.current = 0;
    lastX.current = e.touches[0].clientX;
    lastT.current = performance.now();
  };

  const onTouchMove = e => {
    e.preventDefault();
    const x  = e.touches[0].clientX;
    const t  = performance.now();
    const dt = Math.max(t - lastT.current, 4);
    const dx = x - lastX.current;
    totalDrag.current += Math.abs(dx);
    // Rolling average velocity (px/frame at 60fps)
    const newVel = (dx / dt) * 16;
    vel.current = vel.current * 0.5 + newVel * 0.5;
    liveOff.current -= dx / DAY_W;
    lastX.current = x;
    lastT.current = t;
    repaint();
  };

  const onTouchEnd = () => {
    if (totalDrag.current > 8 && Math.abs(vel.current) > 1.5) {
      runMomentum();
    } else {
      snap();
    }
  };

  // Sync when parent forces a date (e.g. "today" button)
  useEffect(() => {
    const n = dayOffset(selected);
    if (Math.round(liveOff.current) !== n) {
      cancelRaf();
      liveOff.current = n;
      vel.current = 0;
      repaint();
    }
  }, [selected]); // eslint-disable-line
  useEffect(() => () => cancelRaf(), []); // eslint-disable-line

  // Derived from liveOff
  const off      = liveOff.current;
  const selInt   = Math.round(off);          // which day is "selected"
  const fracSlot = off - selInt;             // sub-slot pixel fraction [-0.5, 0.5]
  const selDate  = offsetToDate(selInt);
  const selMonth = MONTHS_FULL[selDate.getMonth()];
  const selYear  = selDate.getFullYear();

  // Build day items: 12 either side
  const N = 12;
  const dayItems = [];
  for (let i = -N; i <= N; i++) {
    dayItems.push({ d: offsetToDate(selInt + i), i });
  }

  const selKey    = toKey(selDate);
  // Parse "7:00 PM" / "8:00 AM" style times to 24h minutes for correct sort
  function timeToMins(t) {
    if (!t || t === "all day") return -1;
    const m = t.match(/(\d+):(\d+)\s*(AM|PM)?/i);
    if (!m) return 9999;
    let h = parseInt(m[1]), min = parseInt(m[2]);
    const period = (m[3]||"").toUpperCase();
    if (period === "PM" && h !== 12) h += 12;
    if (period === "AM" && h === 12) h = 0;
    return h * 60 + min;
  }
  const selEvents = (events[selKey] || []).slice().sort((a,b) => timeToMins(a.time) - timeToMins(b.time));
  const DAY_NAMES = ["Su","Mo","Tu","We","Th","Fr","Sa"];

  // Tap a visible day — only fires on clean taps (< 8px total drag)
  const tapDay = (targetOffset) => {
    if (totalDrag.current > 8) return;
    animateTo(targetOffset);
  };

  return (
    <div style={{userSelect:"none", display:"flex", flexDirection:"column", height:"100%"}}>

      {/* ── Static month + year header ────────────────────────────────────── */}
      <div style={{
        display:"flex", alignItems:"baseline", gap:8,
        padding:"8px 16px 6px",
        borderBottom:`1px solid ${C.border}`,
        flexShrink:0,
      }}>
        <span style={{
          fontFamily:serif, fontSize:18, letterSpacing:"-0.02em",
          color:C.muted, lineHeight:1,
        }}>{selMonth}</span>
        <span style={{
          fontFamily:mono, fontSize:10, letterSpacing:"0.12em",
          color:C.muted, lineHeight:1,
        }}>{selYear}</span>
      </div>

      {/* ── Day ribbon ───────────────────────────────────────────────────── */}
      <div style={{
        height:66, overflow:"hidden", position:"relative",
        borderBottom:`1px solid ${C.border}`, flexShrink:0,
        touchAction:"none", cursor: desktop ? "grab" : "default",
      }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onMouseDown={desktop ? e => { onTouchStart({touches:[{clientX:e.clientX}]}); } : undefined}
        onMouseMove={desktop ? e => { if(e.buttons!==1)return; onTouchMove({preventDefault:()=>{},touches:[{clientX:e.clientX}]}); } : undefined}
        onMouseUp={desktop ? e => { onTouchEnd(); } : undefined}
        onMouseLeave={desktop ? e => { if(e.buttons===1) onTouchEnd(); } : undefined}
      >
        {/* Center slot highlight */}
        <div style={{
          position:"absolute", top:0, bottom:0,
          left:"50%", transform:"translateX(-50%)",
          width:DAY_W,
          background:`${C.accent}15`,
          borderLeft:`1px solid ${C.accent}25`,
          borderRight:`1px solid ${C.accent}25`,
          pointerEvents:"none",
        }}/>

        {/* Scrolling row */}
        <div style={{
          position:"absolute", top:0, bottom:0, left:"50%",
          display:"flex", alignItems:"center",
          transform:`translateX(calc(-50% - ${fracSlot * DAY_W}px))`,
          willChange:"transform",
        }}>
          {dayItems.map(({d, i}) => {
            const k      = toKey(d);
            const isCtr  = i === 0;
            const isTdy  = k === today;
            return (
              <div key={k}
                onClick={() => tapDay(selInt + i)}
                style={{
                  width:DAY_W, flexShrink:0, textAlign:"center",
                  padding:"10px 0 6px",
                  cursor: isCtr ? "default" : "pointer",
                }}>
                <div style={{
                  fontFamily:mono, fontSize:8, letterSpacing:"0.07em",
                  color: isCtr ? C.accent : C.muted,
                  opacity: isCtr ? 1 : Math.max(0.25, 1 - Math.abs(i) * 0.12),
                  marginBottom:4,
                }}>{DAY_NAMES[d.getDay()]}</div>
                <div style={{
                  fontFamily:serif,
                  fontSize: isCtr ? 22 : 16,
                  fontWeight: isCtr ? "600" : "normal",
                  lineHeight:1,
                  color: isTdy ? C.accent : isCtr ? C.text : C.muted,
                  opacity: isCtr ? 1 : Math.max(0.25, 1 - Math.abs(i) * 0.1),
                }}>{d.getDate()}</div>
                <div style={{display:"flex",gap:2,justifyContent:"center",marginTop:4,height:4,alignItems:"center"}}>
                  {(healthDots[k]?.sleep >= 85) && (
                    <div style={{width:3,height:3,borderRadius:"50%",
                      background:C.blue, opacity: isCtr ? 1 : 0.5}}/>
                  )}
                  {(healthDots[k]?.readiness >= 85) && (
                    <div style={{width:3,height:3,borderRadius:"50%",
                      background:C.green, opacity: isCtr ? 1 : 0.5}}/>
                  )}
                  {(healthDots[k]?.activity >= 85) && (
                    <div style={{width:3,height:3,borderRadius:"50%",
                      background:C.accent, opacity: isCtr ? 1 : 0.5}}/>
                  )}
                  {(healthDots[k]?.resilience >= 85) && (
                    <div style={{width:3,height:3,borderRadius:"50%",
                      background:"#8B6BB5", opacity: isCtr ? 1 : 0.5}}/>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Events for selected day ───────────────────────────────────────── */}
      <div style={{padding:"10px 16px 24px"}}>
        <div style={{
          fontFamily:mono, fontSize:8, color:C.muted,
          letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:8,
        }}>
          {selDate.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}
        </div>
        {selEvents.length === 0
          ? <span style={{fontFamily:mono, fontSize:9, color:C.dim}}>No events</span>
          : selEvents.map((ev, i) => (
              <div key={i} style={{
                display:"flex", gap:12, alignItems:"baseline",
                padding:"5px 0",
                borderBottom: i < selEvents.length-1 ? `1px solid ${C.border}` : "none",
              }}>
                <span style={{fontFamily:mono, fontSize:10, color:ev.color||C.accent,
                  flexShrink:0, minWidth:64}}>{ev.time}</span>
                <span style={{fontFamily:serif, fontSize:14, lineHeight:1.4, color:C.muted}}>{ev.title}</span>
              </div>
          ))
        }
      </div>
    </div>
  );
}
function CalStrip({selected, onSelect, events, healthDots, dragProps}) {
  const mobile = useIsMobile();

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
        <button onClick={() => onSelect(todayKey())} style={{
          background:"none",border:"none",cursor:"pointer",color:C.muted,
          fontFamily:mono,fontSize:9,letterSpacing:"0.08em",opacity:0.7,padding:"4px 6px",
          transition:"opacity 0.15s"}}
          onMouseEnter={e=>e.currentTarget.style.opacity="1"}
          onMouseLeave={e=>e.currentTarget.style.opacity="0.7"}>today</button>
      </div>

      {/* Same picker on both — mobile uses touch, desktop uses click */}
      <MobileCalPicker selected={selected} onSelect={onSelect} events={events} healthDots={healthDots} desktop={!mobile}/>
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
const H_EMPTY={sleepScore:"",sleepHrs:"",sleepEff:"",readinessScore:"",hrv:"",rhr:"",activityScore:"",activeCalories:"",steps:"",resilienceScore:"",stressMins:"",recoveryMins:"",deepMins:"",remMins:"",lightMins:"",awakeMins:""};

function fmtMins(val) {
  const m = parseInt(val)||0;
  if (!m) return "—";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m/60), rem = m%60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

function SleepDetail({h}) {
  const stages = [
    {label:"Deep",   mins:parseInt(h.deepMins)||0,   color:"#4A82B0"},
    {label:"REM",    mins:parseInt(h.remMins)||0,    color:"#8B6BB5"},
    {label:"Light",  mins:parseInt(h.lightMins)||0,  color:"#6B9CC4"},
    {label:"Awake",  mins:parseInt(h.awakeMins)||0,  color:"#8A7060"},
  ];
  const total = stages.reduce((s,st)=>s+st.mins,0)||1;
  return (
    <div style={{padding:"14px 16px"}}>
      <div style={{fontFamily:mono,fontSize:8,letterSpacing:"0.15em",textTransform:"uppercase",color:C.muted,marginBottom:10}}>Sleep Stages</div>
      {/* Stacked bar */}
      <div style={{display:"flex",height:8,borderRadius:4,overflow:"hidden",marginBottom:12}}>
        {stages.map(st=>st.mins>0&&(
          <div key={st.label} style={{flex:st.mins/total,background:st.color,minWidth:2}}/>
        ))}
      </div>
      {/* Legend */}
      <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
        {stages.map(st=>(
          <div key={st.label} style={{display:"flex",alignItems:"center",gap:5}}>
            <div style={{width:8,height:8,borderRadius:2,background:st.color,flexShrink:0}}/>
            <div>
              <div style={{fontFamily:mono,fontSize:8,color:C.muted,textTransform:"uppercase"}}>{st.label}</div>
              <div style={{fontFamily:serif,fontSize:14,color:st.mins?C.text:C.dim}}>{fmtMins(st.mins)}</div>
            </div>
          </div>
        ))}
        {h.sleepEff&&(
          <div style={{display:"flex",alignItems:"center",gap:5}}>
            <div style={{width:8,height:8,borderRadius:2,background:C.border2,flexShrink:0}}/>
            <div>
              <div style={{fontFamily:mono,fontSize:8,color:C.muted,textTransform:"uppercase"}}>Efficiency</div>
              <div style={{fontFamily:serif,fontSize:14,color:C.text}}>{h.sleepEff}%</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ReadinessDetail({h}) {
  const items=[
    {label:"HRV",value:h.hrv,unit:"ms"},
    {label:"Resting HR",value:h.rhr,unit:"bpm"},
    {label:"Score",value:h.readinessScore,unit:"/ 100"},
  ];
  return (
    <div style={{padding:"14px 16px",display:"flex",gap:24,flexWrap:"wrap"}}>
      {items.map(it=>(
        <div key={it.label}>
          <div style={{fontFamily:mono,fontSize:8,letterSpacing:"0.12em",textTransform:"uppercase",color:C.muted,marginBottom:4}}>{it.label}</div>
          <div style={{display:"flex",alignItems:"baseline",gap:4}}>
            <span style={{fontFamily:serif,fontSize:22,color:it.value?C.text:C.dim}}>{it.value||"—"}</span>
            {it.value&&<span style={{fontFamily:mono,fontSize:9,color:C.muted}}>{it.unit}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

const SPORT_EMOJI = {
  Run:"🏃",Ride:"🚴",Swim:"🏊",Walk:"🚶",Hike:"🥾",
  WeightTraining:"🏋️",Yoga:"🧘",Workout:"💪",
  VirtualRide:"🚴",VirtualRun:"🏃",Soccer:"⚽",
  Rowing:"🚣",Kayaking:"🛶",Surfing:"🏄",
  Snowboard:"🏂",AlpineSki:"⛷️",NordicSki:"⛷️",
  default:"🏅",
};
function sportEmoji(type){return SPORT_EMOJI[type]||SPORT_EMOJI.default;}

function ActivityDetail({h,ouraWorkouts,stravaActivities}) {
  const oura = ouraWorkouts||[];
  const strava = stravaActivities||[];
  const hasAny = oura.length>0||strava.length>0;
  return (
    <div style={{padding:"14px 16px"}}>
      {/* Strava activities */}
      {strava.length>0&&(
        <>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
            <span style={{fontSize:11}}>🟠</span>
            <span style={{fontFamily:mono,fontSize:8,letterSpacing:"0.15em",textTransform:"uppercase",color:C.muted}}>Strava</span>
          </div>
          {strava.map((a,i)=>(
            <div key={a.id||i} style={{display:"flex",alignItems:"baseline",gap:10,padding:"5px 0",
              borderBottom:i<strava.length-1?`1px solid ${C.border}`:"none"}}>
              <span style={{fontSize:14,flexShrink:0}}>{sportEmoji(a.sport||a.type)}</span>
              <span style={{fontFamily:serif,fontSize:14,color:C.text,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name}</span>
              <span style={{fontFamily:mono,fontSize:10,color:C.muted,flexShrink:0}}>{fmtMins(a.duration)}</span>
              {a.distance&&<span style={{fontFamily:mono,fontSize:10,color:C.blue,flexShrink:0}}>{a.distance}km</span>}
              {a.calories&&<span style={{fontFamily:mono,fontSize:10,color:C.accent,flexShrink:0}}>{a.calories}kcal</span>}
            </div>
          ))}
          {oura.length>0&&<div style={{height:1,background:C.border,margin:"8px 0"}}/>}
        </>
      )}
      {/* Oura workouts */}
      {oura.length>0&&(
        <>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
            <span style={{fontSize:11}}>⭕</span>
            <span style={{fontFamily:mono,fontSize:8,letterSpacing:"0.15em",textTransform:"uppercase",color:C.muted}}>Oura Workouts</span>
          </div>
          {oura.map((w,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"4px 0",
              borderBottom:i<oura.length-1?`1px solid ${C.border}`:"none"}}>
              <span style={{fontFamily:serif,fontSize:14,color:C.text,flex:1,textTransform:"capitalize"}}>{w.activity.replace(/_/g," ")}</span>
              <span style={{fontFamily:mono,fontSize:10,color:C.muted}}>{fmtMins(w.duration)}</span>
              {w.calories&&<span style={{fontFamily:mono,fontSize:10,color:C.accent}}>{w.calories} kcal</span>}
              {w.distance&&<span style={{fontFamily:mono,fontSize:10,color:C.muted}}>{w.distance}km</span>}
            </div>
          ))}
        </>
      )}
      {/* Oura summary stats */}
      <div style={{display:"flex",gap:24,flexWrap:"wrap",marginTop:hasAny?12:0}}>
        {[{label:"Steps",value:h.steps?Number(h.steps).toLocaleString():""},{label:"Cal Burned",value:h.activeCalories,unit:"kcal"}].map(it=>(
          <div key={it.label}>
            <div style={{fontFamily:mono,fontSize:8,letterSpacing:"0.12em",textTransform:"uppercase",color:C.muted,marginBottom:4}}>{it.label}</div>
            <div style={{display:"flex",alignItems:"baseline",gap:4}}>
              <span style={{fontFamily:serif,fontSize:22,color:it.value?C.text:C.dim}}>{it.value||"—"}</span>
              {it.value&&it.unit&&<span style={{fontFamily:mono,fontSize:9,color:C.muted}}>{it.unit}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Oura stress levels: 0=unknown/missing, 1=restored, 2=relaxed, 3=engaged, 4=stressed
const STRESS_ZONES = [
  {level:1, label:"Restored", color:"#4A82B0", y:0.88},
  {level:2, label:"Relaxed",  color:"#4E9268", y:0.62},
  {level:3, label:"Engaged",  color:"#B08A3E", y:0.37},
  {level:4, label:"Stressed", color:"#A05050", y:0.10},
];
function stressColor(s){
  if(s<=0)return null;
  return STRESS_ZONES.find(z=>z.level===s)?.color || "#857F78";
}
function stressY(s, h){
  // map level 1-4 to y position in chart (1=bottom=restored, 4=top=stressed)
  if(!s||s<1||s>4)return null;
  const zone = STRESS_ZONES.find(z=>z.level===s);
  return zone ? zone.y * h : null;
}

function ResilienceDetail({h, ouraDetail}) {
  const stressM   = parseInt(h.stressMins)||0;
  const recoverM  = parseInt(h.recoveryMins)||0;
  const total     = stressM+recoverM||1;
  const timeline  = ouraDetail?.stressTimeline;

  // Chart dimensions
  const W=460, H=110, PAD={t:8,r:8,b:24,l:0};
  const cw=W-PAD.l-PAD.r, ch=H-PAD.t-PAD.b;

  // Build chart points from timeline
  const pts = useMemo(()=>{
    if(!timeline||timeline.length===0)return [];
    // Filter to valid readings (s > 0)
    const valid = timeline.filter(p=>p.s>0);
    if(valid.length===0)return [];
    // Map to chart X by time-of-day (0-24h span)
    const dayStr = h.date||"";
    // Find min/max time for x axis
    const times = valid.map(p=>new Date(p.t).getTime());
    const tMin = Math.min(...times), tMax = Math.max(...times);
    const span = tMax-tMin||1;
    return valid.map(p=>{
      const x = PAD.l + ((new Date(p.t).getTime()-tMin)/span)*cw;
      const y = PAD.t + (1-(p.s-1)/3)*ch; // s:1→bottom, s:4→top
      return {x,y,s:p.s,t:p.t};
    });
  },[timeline, h.date]);

  // Hour labels for x-axis from timeline
  const hourLabels = useMemo(()=>{
    if(!timeline||timeline.length===0)return [];
    const valid = timeline.filter(p=>p.s>0);
    if(valid.length<2)return [];
    const times = valid.map(p=>new Date(p.t).getTime());
    const tMin = Math.min(...times), tMax = Math.max(...times);
    const span = tMax-tMin||1;
    // Show ~5 hour labels
    const labels=[];
    const tMinD=new Date(tMin), tMaxD=new Date(tMax);
    const startHour=tMinD.getHours(), endHour=tMaxD.getHours()+(tMaxD.getDate()!==tMinD.getDate()?24:0);
    const step=Math.ceil((endHour-startHour)/4)||1;
    for(let hr=Math.ceil(startHour/step)*step;hr<=endHour;hr+=step){
      const t=new Date(tMin); t.setHours(tMinD.getHours()+hr-startHour,0,0,0);
      const x=PAD.l+((t.getTime()-tMin)/span)*cw;
      if(x>=PAD.l&&x<=PAD.l+cw){
        const disp=((tMinD.getHours()+hr-startHour)%24).toString().padStart(2,"0");
        labels.push({x,label:disp});
      }
    }
    return labels;
  },[timeline]);

  // Build SVG polyline from pts
  const linePts = pts.map(p=>`${p.x},${p.y}`).join(" ");

  const hasData = pts.length>1;

  return (
    <div style={{padding:"14px 16px"}}>
      {/* Daytime stress chart */}
      {hasData ? (
        <div style={{marginBottom:12}}>
          <div style={{fontFamily:mono,fontSize:8,letterSpacing:"0.12em",textTransform:"uppercase",color:C.muted,marginBottom:6}}>Daytime Stress</div>
          <div style={{position:"relative",overflowX:"auto"}}>
            <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",display:"block"}} preserveAspectRatio="none">
              {/* Zone background bands */}
              {STRESS_ZONES.map((z,i)=>{
                const y1=PAD.t+((i)/4)*ch, y2=PAD.t+((i+1)/4)*ch;
                return <rect key={z.level} x={PAD.l} y={y1} width={cw} height={ch/4}
                  fill={z.color} opacity={0.06}/>;
              })}
              {/* Zone labels on right */}
              {STRESS_ZONES.map((z,i)=>(
                <text key={z.level} x={W-PAD.r-2} y={PAD.t+(i/4)*ch+ch/8+4}
                  textAnchor="end" fontSize={6} fontFamily="monospace"
                  fill={z.color} opacity={0.7}>{z.label}</text>
              ))}
              {/* Connecting line */}
              <polyline points={linePts} fill="none" stroke={C.muted} strokeWidth={1.2} strokeLinejoin="round" opacity={0.5}/>
              {/* Dots colored by stress level */}
              {pts.map((p,i)=>(
                <circle key={i} cx={p.x} cy={p.y} r={pts.length>60?1.5:2.5}
                  fill={stressColor(p.s)} opacity={0.9}/>
              ))}
              {/* X-axis hour labels */}
              {hourLabels.map(({x,label})=>(
                <text key={label} x={x} y={H-2} textAnchor="middle"
                  fontSize={7} fontFamily="monospace" fill={C.muted}>{label}</text>
              ))}
            </svg>
          </div>
        </div>
      ) : (
        <div style={{fontFamily:mono,fontSize:9,color:C.dim,marginBottom:12,padding:"16px 0",textAlign:"center"}}>
          No stress timeline — wear your ring during the day
        </div>
      )}
      {/* Stressed / Recovery summary */}
      <div style={{display:"flex",height:6,borderRadius:3,overflow:"hidden",marginBottom:10}}>
        <div style={{flex:stressM/total,background:"#A05050",minWidth:stressM?2:0}}/>
        <div style={{flex:recoverM/total,background:"#4A82B0",minWidth:recoverM?2:0}}/>
      </div>
      <div style={{display:"flex",gap:20}}>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <div style={{width:7,height:7,borderRadius:2,background:"#A05050"}}/>
          <div>
            <div style={{fontFamily:mono,fontSize:7,color:C.muted,textTransform:"uppercase",letterSpacing:"0.1em"}}>Stressed</div>
            <div style={{fontFamily:serif,fontSize:15,color:stressM?C.text:C.dim}}>{fmtMins(stressM)}</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <div style={{width:7,height:7,borderRadius:2,background:"#4A82B0"}}/>
          <div>
            <div style={{fontFamily:mono,fontSize:7,color:C.muted,textTransform:"uppercase",letterSpacing:"0.1em"}}>Restored</div>
            <div style={{fontFamily:serif,fontSize:15,color:recoverM?C.text:C.dim}}>{fmtMins(recoverM)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HealthStrip({date,token,userId,onHealthChange,onSyncStart,onSyncEnd,dragProps}) {
  const {value:h,setValue:setH,loaded}=useDbSave(date,"health",H_EMPTY,token,userId);
  const set=k=>e=>setH(p=>({...p,[k]:e.target.value}));
  const [active,setActive]=useState("sleep");
  const [ouraDetail,setOuraDetail]=useState(null); // full oura response for detail panels
  const [stravaActivities,setStravaActivities]=useState([]); // strava activities for this date

  useEffect(()=>{if(loaded)onHealthChange(date,h);},[h,loaded]); // eslint-disable-line
  useEffect(()=>{
    if(!loaded||!token)return;
    onSyncStart("oura");
    fetch(`/api/oura?date=${date}`,{headers:{Authorization:`Bearer ${token}`}})
      .then(r=>r.json()).then(data=>{
        console.log("[oura]", date, data);
        if(data.error)return;
        setOuraDetail(data);
        setH(p=>({...p,
          sleepScore:data.sleepScore||p.sleepScore||"",
          sleepHrs:data.sleepHrs||p.sleepHrs||"",
          sleepEff:data.sleepQuality||p.sleepEff||"",
          readinessScore:data.readinessScore||p.readinessScore||"",
          hrv:data.hrv||p.hrv||"",
          rhr:data.rhr||p.rhr||"",
          activityScore:data.activityScore||p.activityScore||"",
          activeCalories:data.activeCalories||p.activeCalories||"",
          steps:data.steps||p.steps||"",
          resilienceScore:data.resilienceScore||p.resilienceScore||"",
          stressMins:data.stressMins||p.stressMins||"",
          recoveryMins:data.recoveryMins||p.recoveryMins||"",
          // sleep stages from oura (not user-editable, just display)
          deepMins:data.sleepStages?.deep!=null?String(data.sleepStages.deep):p.deepMins||"",
          remMins:data.sleepStages?.rem!=null?String(data.sleepStages.rem):p.remMins||"",
          lightMins:data.sleepStages?.light!=null?String(data.sleepStages.light):p.lightMins||"",
          awakeMins:data.sleepStages?.awake!=null?String(data.sleepStages.awake):p.awakeMins||"",
        }));
      }).catch(()=>{}).finally(()=>onSyncEnd("oura"));
  },[date,loaded,token]); // eslint-disable-line

  // Fetch Strava activities for this date
  useEffect(()=>{
    if(!token)return;
    setStravaActivities([]);
    fetch(`/api/strava?date=${date}`,{headers:{Authorization:`Bearer ${token}`}})
      .then(r=>r.json()).then(data=>{
        if(data.activities&&Array.isArray(data.activities))setStravaActivities(data.activities);
      }).catch(()=>{});
  },[date,token]); // eslint-disable-line

  const purple = "#8B6BB5";
  const metrics=[
    {key:"sleep",label:"Sleep",color:C.blue,score:h.sleepScore,setScore:e=>setH(p=>({...p,sleepScore:e.target.value})),
      fields:[{label:"Hours",value:h.sleepHrs,onChange:set("sleepHrs"),unit:"h"},{label:"Effic.",value:h.sleepEff,onChange:set("sleepEff"),unit:"%"}]},
    {key:"readiness",label:"Readiness",color:C.green,score:h.readinessScore,setScore:e=>setH(p=>({...p,readinessScore:e.target.value})),
      fields:[{label:"HRV",value:h.hrv,onChange:set("hrv"),unit:"ms"},{label:"RHR",value:h.rhr,onChange:set("rhr"),unit:"bpm"}]},
    {key:"activity",label:"Activity",color:C.accent,score:h.activityScore,setScore:e=>setH(p=>({...p,activityScore:e.target.value})),
      fields:[{label:"Cals",value:h.activeCalories,onChange:set("activeCalories"),unit:"kcal"},{label:"Steps",value:h.steps,onChange:set("steps"),unit:""}]},
    {key:"resilience",label:"Resilience",color:purple,score:h.resilienceScore,setScore:e=>setH(p=>({...p,resilienceScore:e.target.value})),
      fields:[{label:"Stress",value:fmtMins(h.stressMins),unit:""},{label:"Recov.",value:fmtMins(h.recoveryMins),unit:""}]},
  ];

  const detailMap = {
    sleep:     <SleepDetail h={h}/>,
    readiness: <ReadinessDetail h={h}/>,
    activity:  <ActivityDetail h={h} ouraWorkouts={ouraDetail?.workouts} stravaActivities={stravaActivities}/>,
    resilience: <ResilienceDetail h={h} ouraDetail={ouraDetail}/>,
  };

  return (
    <Card>
      {/* Card header */}
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",
        borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
        <div {...dragProps} style={{cursor:"grab",color:C.dim,fontSize:15,lineHeight:1,
          touchAction:"none",userSelect:"none"}}>⠿</div>
        <div style={{width:3,height:13,borderRadius:2,background:C.green,flexShrink:0}}/>
        <span style={{fontFamily:mono,fontSize:9,letterSpacing:"0.2em",
          textTransform:"uppercase",color:C.muted}}>Health</span>
      </div>
      {/* Metrics row */}
      <div style={{display:"flex",alignItems:"stretch",overflow:"auto"}}>
        {metrics.map((m,mi)=>{
          const isActive = active===m.key;
          return (
            <div key={m.key} onClick={()=>setActive(m.key)}
              style={{flex:"1 0 auto",minWidth:130,display:"flex",alignItems:"center",gap:12,
                padding:"12px 14px",cursor:"pointer",transition:"background 0.15s",
                background:isActive?`${m.color}10`:"transparent",
                borderRight:mi<metrics.length-1?`1px solid ${C.border}`:"none",
                borderBottom:isActive?`2px solid ${m.color}`:`2px solid transparent`}}>
              <div style={{position:"relative",flexShrink:0}}>
                <Ring score={m.score} color={m.color} size={48}/>
                <input value={m.score} onChange={m.setScore} onClick={e=>e.stopPropagation()}
                  style={{position:"absolute",inset:0,opacity:0,cursor:"text",width:"100%",fontSize:16}}/>
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontFamily:mono,fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:m.color,marginBottom:6}}>{m.label}</div>
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                  {m.fields.map(f=>(
                    <div key={f.label}>
                      <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",color:C.muted,marginBottom:2,letterSpacing:"0.08em"}}>{f.label}</div>
                      <div style={{display:"flex",alignItems:"baseline",gap:2}}>
                        {f.onChange
                          ? <input value={f.value} onChange={f.onChange} placeholder="—" onClick={e=>e.stopPropagation()}
                              style={{background:"transparent",border:"none",outline:"none",padding:0,
                                color:f.value?C.text:C.dim,fontFamily:serif,fontSize:17,width:f.unit?38:80}}/>
                          : <span style={{fontFamily:serif,fontSize:17,color:f.value&&f.value!=="—"?C.text:C.dim}}>{f.value||"—"}</span>
                        }
                        {f.unit&&<span style={{fontFamily:mono,fontSize:9,color:C.muted}}>{f.unit}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {/* Detail panel — expands below the metric row */}
      <div style={{borderTop:`1px solid ${C.border}`}}>
        {detailMap[active]}
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
    const kcal=await estimateKcal(promptFn(text),token).catch(()=>null);
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
function Activity({date,token,userId}) {
  const [strava,setStrava]=useState([]);

  useEffect(()=>{
    if(!token)return;
    setStrava([]);
    fetch(`/api/strava?date=${date}`,{headers:{Authorization:`Bearer ${token}`}})
      .then(r=>r.json()).then(d=>{if(d.activities)setStrava(d.activities);}).catch(()=>{});
  },[date,token]); // eslint-disable-line

  return (
    <div style={{display:"flex",flexDirection:"column",gap:0,height:"100%"}}>
      {strava.length>0&&(
        <div style={{padding:"10px 14px 6px",borderBottom:`1px solid ${C.border}`}}>
          <div style={{fontFamily:mono,fontSize:7,letterSpacing:"0.15em",textTransform:"uppercase",color:"#FC4C02",marginBottom:6}}>🟠 Strava</div>
          {strava.map((a,i)=>(
            <div key={a.id||i} style={{display:"flex",alignItems:"baseline",gap:8,padding:"3px 0",
              borderBottom:i<strava.length-1?`1px solid ${C.border}`:"none"}}>
              <span style={{fontSize:13}}>{sportEmoji(a.sport||a.type)}</span>
              <span style={{fontFamily:serif,fontSize:14,color:C.text,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name}</span>
              <span style={{fontFamily:mono,fontSize:10,color:C.muted,flexShrink:0}}>{fmtMins(a.duration)}</span>
              {a.distance&&<span style={{fontFamily:mono,fontSize:10,color:C.blue,flexShrink:0}}>{a.distance}km</span>}
              {a.calories&&<span style={{fontFamily:mono,fontSize:10,color:C.accent,flexShrink:0}}>{a.calories}kcal</span>}
            </div>
          ))}
        </div>
      )}
      <div style={{flex:1,minHeight:0}}>
        <RowList date={date} type="activity" token={token} userId={userId}
          placeholder="What did you do?"
          promptFn={t=>`Calories burned: "${t}" for a typical adult. Return JSON: {"kcal":300}`}
          prefix="−" color={C.green}/>
      </div>
    </div>
  );
}

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
    // Apply bg to document so html/body are correct color, not just the React root
    document.documentElement.style.background = C.bg;
    document.body.style.background = C.bg;
    document.documentElement.style.colorScheme = theme === "light" ? "light" : "dark";
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
  const sessionGoogleToken=session?.provider_token; // only present right after login
  const startSync=useCallback(k=>setSyncing(s=>new Set([...s,k])),[]);
  const endSync=useCallback(k=>{
    setSyncing(s=>{const n=new Set(s);n.delete(k);return n;});
    setLastSync(new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}));
  },[]);

  // When we get a fresh provider_token from Google (right after login), save it to DB
  useEffect(()=>{
    if(!sessionGoogleToken||!token)return;
    fetch("/api/google-token",{method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
      body:JSON.stringify({googleToken:sessionGoogleToken})})
      .catch(()=>{});
  },[sessionGoogleToken,token]);

  // Fetch calendar events — get token from DB if not in session
  useEffect(()=>{
    if(!token)return;
    startSync("cal");
    const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
    const start=toKey(shift(new Date(),-30));
    const end=toKey(shift(new Date(),60));

    const fetchCal=(googleToken)=>{
      fetch("/api/calendar",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({token:googleToken,start,end,tz})})
        .then(r=>r.json())
        .then(d=>{
          if(d.events&&Object.keys(d.events).length>0){
            setEvents(d.events);
          } else if(d.error){
            console.warn("[cal] API error:",d.error);
          }
        })
        .catch(e=>console.error("[cal] fetch err:",e))
        .finally(()=>endSync("cal"));
    };

    if(sessionGoogleToken){
      fetchCal(sessionGoogleToken);
    } else {
      // Retrieve stored token from DB
      fetch("/api/google-token",{headers:{"Authorization":`Bearer ${token}`}})
        .then(r=>r.json())
        .then(d=>{
          if(d.googleToken) fetchCal(d.googleToken);
          else { console.warn("[cal] no stored google token"); endSync("cal"); }
        })
        .catch(()=>endSync("cal"));
    }
  },[token]); // eslint-disable-line

  const onHealthChange=useCallback((date,data)=>{
    setHealthDots(prev=>({...prev,[date]:{sleep:+data.sleepScore||0,readiness:+data.readinessScore||0,activity:+data.activityScore||0,resilience:+data.resilienceScore||0}}));
  },[]);

  // Prefetch Oura scores for ±14 days around today so dots show without clicking each day
  useEffect(()=>{
    if(!token||!userId)return;
    const dates=[];
    for(let i=-14;i<=1;i++) dates.push(toKey(shift(new Date(),i)));
    dates.forEach((d,i)=>{
      setTimeout(()=>{
        fetch(`/api/oura?date=${d}`,{headers:{Authorization:`Bearer ${token}`}})
          .then(r=>r.json()).then(data=>{
            if(data.error)return;
            setHealthDots(prev=>({...prev,[d]:{
              sleep:+data.sleepScore||0,
              readiness:+data.readinessScore||0,
              activity:+data.activityScore||0,
              resilience:+data.resilienceScore||0,
            }}));
          }).catch(()=>{});
      }, i*150); // stagger 150ms apart to avoid hammering
    });
  },[token,userId]); // eslint-disable-line

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
  const calH = heights.cal;

  return (
    <div style={{background:C.bg,height:"100vh",color:C.text,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        html,body{height:100%;overflow:hidden;background:${C.bg};}
        ::-webkit-scrollbar{display:none;}
        *{scrollbar-width:none;-ms-overflow-style:none;}
        button{border-radius:0;}
        input::placeholder,textarea::placeholder{color:${C.muted};opacity:1;}
        a{text-decoration:none;}
        input,textarea,select{font-size:16px;}
        @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
      `}</style>

      <TopBar session={session} token={token} userId={userId} syncStatus={syncStatus} theme={theme} onThemeChange={setTheme} selected={selected}/>

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
                        ? <div>
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
        /* ── DESKTOP: stacked layout — cal, health, then 2-col widgets ─── */
        <div style={{flex:1,overflowY:"auto",padding:10,display:"flex",flexDirection:"column",gap:8}}>

          {/* Calendar — full width, fixed height */}
          <div style={{height:360,flexShrink:0}}>
            <CalStrip selected={selected} onSelect={setSelected}
              events={events} healthDots={healthDots} dragProps={{}}/>
          </div>

          {/* Health strip — full width */}
          <div style={{flexShrink:0}}>
            <HealthStrip date={selected} token={token} userId={userId}
              onHealthChange={onHealthChange} onSyncStart={startSync} onSyncEnd={endSync}
              dragProps={{}}/>
          </div>

          {/* Widgets — notes on left (wider), tasks+meals+activity on right */}
          <div style={{display:"flex",gap:8,alignItems:"stretch",minHeight:480}}>
            {/* Notes — left, wider */}
            <div style={{flex:"2 1 0",minWidth:0}}>
              <Widget label={leftWidget.label} color={leftWidget.color} dragProps={{}}>
                <leftWidget.Comp date={selected} token={token} userId={userId}/>
              </Widget>
            </div>
            {/* Tasks, Meals, Activity stacked on right */}
            <div style={{flex:"1 1 0",minWidth:0,display:"flex",flexDirection:"column",gap:8}}>
              {rightWidgets.map(w=>(
                <div key={w.id} style={{flex:"1 1 0",minHeight:140}}>
                  <Widget label={w.label} color={w.color} dragProps={{}}>
                    <w.Comp date={selected} token={token} userId={userId}/>
                  </Widget>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
