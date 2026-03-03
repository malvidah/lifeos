"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "../lib/supabase.js";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  DragOverlay,
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

// ─── AI ───────────────────────────────────────────────────────────────────────
async function estimateNutrition(prompt, token) {
  if (!token) return null;
  try {
    const r = await fetch("/api/ai",{method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
      body:JSON.stringify({model:"claude-haiku-4-5",max_tokens:80,
        system:"Return ONLY a valid JSON object with the requested integer fields. No explanation, no markdown, no backticks.",
        messages:[{role:"user",content:prompt}]})});
    const d = await r.json();
    if (d.error) return null;
    const text = d.content?.find(b=>b.type==="text")?.text||"{}";
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)[0]);
    if (!parsed.kcal) return null;
    return parsed; // {kcal, protein} for meals, {kcal} for activities
  } catch { return null; }
}

// ─── Oura response cache (per date+user, avoids double-fetching) ─────────────
const _ouraCache = {};
function ouraKey(userId, date) { return `${userId}|${date}`; }
function cachedOuraFetch(date, token, userId) {
  const k = ouraKey(userId, date);
  if (_ouraCache[k]) return _ouraCache[k];
  const p = fetch(`/api/oura?date=${date}`,{headers:{Authorization:`Bearer ${token}`}})
    .then(r=>r.json()).catch(()=>({}));
  _ouraCache[k] = p;
  // Expire after 5 minutes
  setTimeout(()=>{ delete _ouraCache[k]; }, 5 * 60 * 1000);
  return p;
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
      if(d===null){setLoadErr(true);return;}
      if(d?.ouraToken)setOuraKey(d.ouraToken);
      if(d?.anthropicKey)setAnthropicKey(d.anthropicKey);
      if(d?.stravaClientId)setStravaClientId(d.stravaClientId);
      if(d?.stravaClientSecret)setStravaClientSecret(d.stravaClientSecret);
      // Check if strava token exists
      fetch("/api/entries?date=0000-00-00&type=strava_token",{headers:{Authorization:`Bearer ${token}`}})
        .then(r=>r.json()).then(d=>{if(d?.data?.access_token)setStravaConnected(true);}).catch(()=>{});
    }).catch(()=>setLoadErr(true));
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
      if(!r.ok) throw new Error(result.error||r.status);
      setSaving(false);setSaved(true);setTimeout(()=>setSaved(false),2000);
    } catch(e) {
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
          color:C.text, lineHeight:1,
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
                  {(healthDots[k]?.recovery >= 85) && (
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
                <span style={{fontFamily:serif, fontSize:14, lineHeight:1.4, color:C.text}}>{ev.title}</span>
              </div>
          ))
        }
      </div>
    </div>
  );
}

// ─── Week View ───────────────────────────────────────────────────────────────
function WeekView({selected, onSelect, events, healthDots}) {
  const selDate = new Date(selected + "T12:00:00");
  // Get Monday of the selected week
  const day = selDate.getDay();
  const mondayOff = day === 0 ? -6 : 1 - day;
  const monday = new Date(selDate);
  monday.setDate(monday.getDate() + mondayOff);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    days.push(d);
  }

  const NAMES = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const today = todayKey();

  function timeToMins(t) {
    if (!t || t === "all day") return -1;
    const m = t.match(/(\d+):(\d+)\s*(AM|PM)?/i);
    if (!m) return 9999;
    let h = parseInt(m[1]), min = parseInt(m[2]);
    const p = (m[3]||"").toUpperCase();
    if (p === "PM" && h !== 12) h += 12;
    if (p === "AM" && h === 12) h = 0;
    return h * 60 + min;
  }

  return (
    <div style={{padding:"6px 8px 16px", flex:1, overflow:"auto"}}>
      <div style={{display:"grid", gridTemplateColumns:"repeat(7, 1fr)", gap:4}}>
        {days.map((d, i) => {
          const k = toKey(d);
          const isSel = k === selected;
          const isTdy = k === today;
          const dayEvents = (events[k] || []).slice().sort((a,b) => timeToMins(a.time) - timeToMins(b.time));
          const dots = healthDots[k];
          return (
            <div key={k} onClick={() => onSelect(k)}
              style={{
                cursor:"pointer", padding:"6px 4px", borderRadius:8,
                background: isSel ? `${C.accent}12` : "transparent",
                border: isSel ? `1px solid ${C.accent}30` : "1px solid transparent",
                minHeight: 100,
              }}>
              <div style={{textAlign:"center", marginBottom:6}}>
                <div style={{fontFamily:mono, fontSize:8, letterSpacing:"0.08em",
                  color: isSel ? C.accent : C.muted}}>{NAMES[i]}</div>
                <div style={{fontFamily:serif, fontSize:16, fontWeight: isSel ? "600" : "normal",
                  color: isTdy ? C.accent : isSel ? C.text : C.muted,
                  lineHeight:1.4}}>{d.getDate()}</div>
                {dots && (
                  <div style={{display:"flex",gap:2,justifyContent:"center",marginTop:2,height:4}}>
                    {dots.sleep >= 85 && <div style={{width:3,height:3,borderRadius:"50%",background:C.blue}}/>}
                    {dots.readiness >= 85 && <div style={{width:3,height:3,borderRadius:"50%",background:C.green}}/>}
                    {dots.activity >= 85 && <div style={{width:3,height:3,borderRadius:"50%",background:C.accent}}/>}
                  </div>
                )}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:2}}>
                {dayEvents.slice(0,4).map((ev,j) => (
                  <div key={j} style={{
                    padding:"2px 4px", borderRadius:3,
                    borderLeft:`2px solid ${ev.color||C.accent}`,
                    background:`${ev.color||C.accent}10`,
                  }}>
                    <div style={{fontFamily:mono, fontSize:7, color:C.muted, lineHeight:1.2}}>
                      {ev.time !== "all day" ? ev.time : ""}
                    </div>
                    <div style={{fontFamily:serif, fontSize:10, color:C.text, lineHeight:1.3,
                      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{ev.title}</div>
                  </div>
                ))}
                {dayEvents.length > 4 && (
                  <span style={{fontFamily:mono, fontSize:7, color:C.muted, textAlign:"center"}}>
                    +{dayEvents.length - 4} more
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Month View ──────────────────────────────────────────────────────────────
function MonthView({selected, onSelect, events, healthDots}) {
  const selDate = new Date(selected + "T12:00:00");
  const year = selDate.getFullYear();
  const month = selDate.getMonth();
  const today = todayKey();

  // First day of month and total days
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Monday-start: 0=Mon, 6=Sun
  let startOffset = firstDay.getDay() - 1;
  if (startOffset < 0) startOffset = 6;

  const NAMES = ["M","T","W","T","F","S","S"];

  // Navigate months
  const prevMonth = () => {
    const d = new Date(year, month - 1, 1);
    onSelect(toKey(d));
  };
  const nextMonth = () => {
    const d = new Date(year, month + 1, 1);
    onSelect(toKey(d));
  };

  function timeToMins(t) {
    if (!t || t === "all day") return -1;
    const m = t.match(/(\d+):(\d+)\s*(AM|PM)?/i);
    if (!m) return 9999;
    let h = parseInt(m[1]), min = parseInt(m[2]);
    const p = (m[3]||"").toUpperCase();
    if (p === "PM" && h !== 12) h += 12;
    if (p === "AM" && h === 12) h = 0;
    return h * 60 + min;
  }

  const selKey = selected;
  const selEvents = (events[selKey] || []).slice().sort((a,b) => timeToMins(a.time) - timeToMins(b.time));

  return (
    <div style={{display:"flex", flexDirection:"column", flex:1, overflow:"hidden"}}>
      {/* Month navigation */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:16,padding:"6px 16px"}}>
        <button onClick={prevMonth} style={{background:"none",border:"none",cursor:"pointer",
          color:C.muted,fontFamily:mono,fontSize:14,padding:"2px 8px"}}>‹</button>
        <span style={{fontFamily:serif,fontSize:16,color:C.text,letterSpacing:"-0.02em",minWidth:120,textAlign:"center"}}>
          {MONTHS_FULL[month]} {year}
        </span>
        <button onClick={nextMonth} style={{background:"none",border:"none",cursor:"pointer",
          color:C.muted,fontFamily:mono,fontSize:14,padding:"2px 8px"}}>›</button>
      </div>

      {/* Day name headers */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",padding:"0 12px"}}>
        {NAMES.map((n,i)=>(
          <div key={i} style={{textAlign:"center",fontFamily:mono,fontSize:8,color:C.muted,
            letterSpacing:"0.08em",padding:"4px 0"}}>{n}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",padding:"0 12px",gap:1}}>
        {Array.from({length:startOffset}).map((_,i)=><div key={`e${i}`}/>)}
        {Array.from({length:daysInMonth}).map((_,i)=>{
          const day = i + 1;
          const k = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
          const isSel = k === selected;
          const isTdy = k === today;
          const hasEvents = events[k] && events[k].length > 0;
          const dots = healthDots[k];
          return (
            <div key={k} onClick={() => onSelect(k)} style={{
              textAlign:"center", padding:"4px 2px", cursor:"pointer", borderRadius:6,
              background: isSel ? `${C.accent}15` : "transparent",
            }}>
              <div style={{
                fontFamily:serif, fontSize:13,
                color: isTdy ? C.accent : isSel ? C.text : C.muted,
                fontWeight: isSel ? "600" : "normal",
                lineHeight:1.6,
              }}>{day}</div>
              <div style={{display:"flex",gap:2,justifyContent:"center",height:4}}>
                {hasEvents && <div style={{width:3,height:3,borderRadius:"50%",background:C.blue}}/>}
                {dots?.sleep >= 85 && <div style={{width:3,height:3,borderRadius:"50%",background:C.green}}/>}
                {dots?.readiness >= 85 && <div style={{width:3,height:3,borderRadius:"50%",background:C.accent}}/>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected day events below grid */}
      <div style={{padding:"8px 16px 12px", borderTop:`1px solid ${C.border}`, marginTop:6, flex:1, overflowY:"auto"}}>
        <div style={{fontFamily:mono, fontSize:8, color:C.muted, letterSpacing:"0.12em",
          textTransform:"uppercase", marginBottom:6}}>
          {new Date(selected+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}
        </div>
        {selEvents.length === 0
          ? <span style={{fontFamily:mono, fontSize:9, color:C.dim}}>No events</span>
          : selEvents.map((ev, i) => (
              <div key={i} style={{display:"flex", gap:12, alignItems:"baseline",
                padding:"4px 0", borderBottom: i < selEvents.length-1 ? `1px solid ${C.border}` : "none"}}>
                <span style={{fontFamily:mono, fontSize:10, color:ev.color||C.accent,
                  flexShrink:0, minWidth:64}}>{ev.time}</span>
                <span style={{fontFamily:serif, fontSize:13, lineHeight:1.4, color:C.text}}>{ev.title}</span>
              </div>
          ))
        }
      </div>
    </div>
  );
}

function CalStrip({selected, onSelect, events, setEvents, healthDots, dragProps, token, googleToken}) {
  const mobile = useIsMobile();
  const [adding, setAdding] = useState(false);
  const [calView, setCalView] = useState("day");  // day | week | month
  const [form, setForm] = useState({title:"", startTime:"", endTime:"", allDay:false});
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  function openAdd() { setForm({title:"",startTime:"",endTime:"",allDay:false}); setSaveErr(""); setAdding(true); }
  function closeAdd() { setAdding(false); }

  async function submitEvent(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true); setSaveErr("");
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      const res = await fetch("/api/calendar-create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: form.title.trim(), date: selected, startTime: form.allDay?"":form.startTime, endTime: form.allDay?"":form.endTime, allDay: form.allDay, tz, googleToken }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setSaveErr(data.error || "Failed to create event"); setSaving(false); return; }
      // Optimistically add to local events
      const newEv = {
        title: form.title.trim(),
        time: form.allDay ? "all day" : (form.startTime ? form.startTime : "all day"),
        color: "#B8A882",
      };
      setEvents(prev => ({ ...prev, [selected]: [...(prev[selected]||[]), newEv] }));
      setSaving(false); setAdding(false);
    } catch(err) { setSaveErr(err.message); setSaving(false); }
  }

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

        {/* View mode toggle */}
        <div style={{display:"flex",gap:0,background:C.surface,borderRadius:5,padding:2,border:`1px solid ${C.border}`}}>
          {["day","week","month"].map(v=>(
            <button key={v} onClick={()=>setCalView(v)} style={{
              background: calView===v ? C.card : "transparent",
              border: calView===v ? `1px solid ${C.border2}` : "1px solid transparent",
              borderRadius:4, cursor:"pointer", padding:"3px 8px",
              fontFamily:mono, fontSize:8, letterSpacing:"0.08em",
              color: calView===v ? C.text : C.muted,
              textTransform:"uppercase", lineHeight:1,
              transition:"all 0.15s",
            }}>{v[0].toUpperCase()}</button>
          ))}
        </div>

        <button onClick={() => { onSelect(todayKey()); setCalView("day"); }} style={{
          background:"none",border:`1px solid ${C.border2}`,borderRadius:5,cursor:"pointer",
          color:C.muted,fontFamily:mono,fontSize:8,letterSpacing:"0.08em",padding:"4px 8px",
          transition:"all 0.15s"}}
          onMouseEnter={e=>{e.currentTarget.style.color=C.text;e.currentTarget.style.borderColor=C.text;}}
          onMouseLeave={e=>{e.currentTarget.style.color=C.muted;e.currentTarget.style.borderColor=C.border2;}}>
          TODAY</button>
        <button onClick={openAdd} style={{
          background:"none",border:`1px solid ${C.border2}`,borderRadius:5,cursor:"pointer",
          color:C.muted,fontFamily:mono,fontSize:13,lineHeight:1,padding:"2px 7px",
          transition:"all 0.15s"}}
          onMouseEnter={e=>{e.currentTarget.style.color=C.text;e.currentTarget.style.borderColor=C.text;}}
          onMouseLeave={e=>{e.currentTarget.style.color=C.muted;e.currentTarget.style.borderColor=C.border2;}}
          title="Add event">+</button>
      </div>

      {/* Quick-add form */}
      {adding && (
        <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,background:`${C.blue}08`}}>
          <div style={{fontFamily:mono,fontSize:8,letterSpacing:"0.15em",textTransform:"uppercase",color:C.muted,marginBottom:10}}>
            New event · {new Date(selected+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}
          </div>
          <input autoFocus value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))}
            placeholder="Event title"
            style={{width:"100%",background:"transparent",border:"none",borderBottom:`1px solid ${C.border2}`,
              outline:"none",padding:"4px 0",fontFamily:serif,fontSize:16,color:C.text,marginBottom:10}} />
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:8}}>
            <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}>
              <input type="checkbox" checked={form.allDay} onChange={e=>setForm(f=>({...f,allDay:e.target.checked}))}
                style={{accentColor:C.blue,width:12,height:12}}/>
              <span style={{fontFamily:mono,fontSize:9,color:C.muted,letterSpacing:"0.08em"}}>All day</span>
            </label>
            {!form.allDay && (
              <>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontFamily:mono,fontSize:9,color:C.muted}}>Start</span>
                  <input type="time" value={form.startTime} onChange={e=>setForm(f=>({...f,startTime:e.target.value}))}
                    style={{background:"transparent",border:`1px solid ${C.border2}`,borderRadius:4,
                      outline:"none",padding:"3px 6px",fontFamily:mono,fontSize:10,color:C.text}}/>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontFamily:mono,fontSize:9,color:C.muted}}>End</span>
                  <input type="time" value={form.endTime} onChange={e=>setForm(f=>({...f,endTime:e.target.value}))}
                    style={{background:"transparent",border:`1px solid ${C.border2}`,borderRadius:4,
                      outline:"none",padding:"3px 6px",fontFamily:mono,fontSize:10,color:C.text}}/>
                </div>
              </>
            )}
          </div>
          {saveErr && <div style={{fontFamily:mono,fontSize:9,color:"#A05050",marginBottom:8}}>{saveErr}</div>}
          <div style={{display:"flex",gap:8}}>
            <button onClick={submitEvent} disabled={saving||!form.title.trim()} style={{
              background:C.blue,border:"none",borderRadius:5,padding:"6px 14px",
              color:"#fff",fontFamily:mono,fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase",
              cursor:saving||!form.title.trim()?"not-allowed":"pointer",opacity:saving||!form.title.trim()?0.5:1}}>
              {saving?"saving…":"add to google cal"}
            </button>
            <button onClick={closeAdd} style={{
              background:"none",border:`1px solid ${C.border2}`,borderRadius:5,padding:"6px 14px",
              color:C.muted,fontFamily:mono,fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase",cursor:"pointer"}}>
              cancel
            </button>
          </div>
        </div>
      )}

      {/* Same picker on both — mobile uses touch, desktop uses click */}
      {calView === "day" && <MobileCalPicker selected={selected} onSelect={onSelect} events={events} healthDots={healthDots} desktop={!mobile}/>}
      {calView === "week" && <WeekView selected={selected} onSelect={onSelect} events={events} healthDots={healthDots}/>}
      {calView === "month" && <MonthView selected={selected} onSelect={onSelect} events={events} healthDots={healthDots}/>}
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
const H_EMPTY={sleepScore:"",sleepHrs:"",sleepEff:"",readinessScore:"",hrv:"",rhr:"",activityScore:"",activeCalories:"",totalCalories:"",steps:"",activeMinutes:"",resilienceScore:"",stressMins:"",recoveryMins:""};

const SPORT_EMOJI = {
  Run:"🏃",Ride:"🚴",Swim:"🏊",Walk:"🚶",Hike:"🥾",
  WeightTraining:"🏋️",Yoga:"🧘",Workout:"💪",
  VirtualRide:"🚴",VirtualRun:"🏃",Soccer:"⚽",
  Rowing:"🚣",Kayaking:"🛶",Surfing:"🏄",
  Snowboard:"🏂",AlpineSki:"⛷️",NordicSki:"⛷️",
  default:"🏅",
};
function sportEmoji(type){
  if(!type)return SPORT_EMOJI.default;
  const k=Object.keys(SPORT_EMOJI).find(k=>k.toLowerCase()===type.toLowerCase().replace(/_/g,""));
  return SPORT_EMOJI[k]||SPORT_EMOJI.default;
}

function fmtMins(val) {
  const m = parseInt(val)||0;
  if (!m) return "—";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m/60), rem = m%60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}
function fmtMinsField(val) {
  const m = parseInt(val)||0;
  if (!m) return {value:"—", unit:""};
  if (m < 60) return {value:String(m), unit:"m"};
  const h = Math.floor(m/60), rem = m%60;
  return rem ? {value:`${h}h ${rem}`, unit:"m"} : {value:String(h), unit:"h"};
}


function HealthStrip({date,token,userId,onHealthChange,onSyncStart,onSyncEnd,dragProps}) {
  const {value:h,setValue:setH,loaded}=useDbSave(date,"health",H_EMPTY,token,userId);

  useEffect(()=>{if(loaded)onHealthChange(date,h);},[h,loaded]); // eslint-disable-line
  useEffect(()=>{
    if(!loaded||!token)return;
    onSyncStart("oura");
    cachedOuraFetch(date, token, userId).then(data=>{
        if(data.error)return;
        setH(p=>({...p,
          sleepScore:data.sleepScore||p.sleepScore||"",
          sleepHrs:data.sleepHrs||p.sleepHrs||"",
          sleepEff:data.sleepQuality||p.sleepEff||"",
          readinessScore:data.readinessScore||p.readinessScore||"",
          hrv:data.hrv||p.hrv||"",
          rhr:data.rhr||p.rhr||"",
          activityScore:data.activityScore||p.activityScore||"",
          activeCalories:data.activeCalories||p.activeCalories||"",
          totalCalories:data.totalCalories||p.totalCalories||"",
          steps:data.steps||p.steps||"",
          activeMinutes:data.activeMinutes||p.activeMinutes||"",
          resilienceScore:data.resilienceScore||p.resilienceScore||"",
          stressMins:data.stressMins||p.stressMins||"",
          recoveryMins:data.recoveryMins||p.recoveryMins||"",
        }));
      }).catch(()=>{}).finally(()=>onSyncEnd("oura"));
  },[date,loaded,token]); // eslint-disable-line


  const purple = "#8B6BB5";
  // All fields are read-only — data comes from Oura, no onChange handlers
  const metrics=[
    {key:"sleep",label:"Sleep",color:C.blue,score:h.sleepScore,
      fields:[{label:"Hours",value:h.sleepHrs,unit:"h"},{label:"Effic.",value:h.sleepEff,unit:"%"}]},
    {key:"readiness",label:"Readiness",color:C.green,score:h.readinessScore,
      fields:[{label:"HRV",value:h.hrv,unit:"ms"},{label:"RHR",value:h.rhr,unit:"bpm"}]},
    {key:"activity",label:"Activity",color:C.accent,score:h.activityScore,
      fields:[{label:"Burn",value:h.totalCalories||h.activeCalories,unit:"cal"},{label:"Active",value:h.activeMinutes,unit:"min"}]},
    {key:"recovery",label:"Recovery",color:purple,score:h.resilienceScore,
      fields:[{label:"Stress",...fmtMinsField(h.stressMins)},{label:"Recov.",...fmtMinsField(h.recoveryMins)}]},
  ];


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
        {metrics.map((m,mi)=>(
            <div key={m.key}
              style={{flex:"1 0 auto",minWidth:130,display:"flex",alignItems:"center",gap:12,
                padding:"12px 14px",
                borderRight:mi<metrics.length-1?`1px solid ${C.border}`:"none"}}>
              <div style={{flexShrink:0}}>
                <Ring score={m.score} color={m.color} size={48}/>
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontFamily:mono,fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:m.color,marginBottom:6}}>{m.label}</div>
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                  {m.fields.map(f=>(
                    <div key={f.label}>
                      <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",color:C.muted,marginBottom:2,letterSpacing:"0.08em"}}>{f.label}</div>
                      <div style={{display:"flex",alignItems:"baseline",gap:2}}>
                        <span style={{fontFamily:serif,fontSize:17,color:f.value&&f.value!=="—"?C.text:C.dim}}>{f.value||"—"}</span>
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
// syncedRows: live from API, may have native kcal (Strava) or need estimation (Oura)
// AI estimates for synced rows persist to DB under type+"_kcal" key
function RowList({date,type,placeholder,promptFn,prefix,color,token,userId,syncedRows=[],showProtein=false}) {
  const mkRow = () => ({id:Date.now(), text:"", kcal:null, protein:null});
  const {value:rows, setValue:setRows, loaded} = useDbSave(date, type, [mkRow()], token, userId);
  const {value:savedEstimates, setValue:setSavedEstimates, loaded:estimatesLoaded} = useDbSave(date, type+"_kcal", {}, token, userId);
  const estimating = useRef(new Set());
  const refs = useRef({});
  const [tick, setTick] = useState(0);

  const safe = Array.isArray(rows) && rows.length ? rows : [mkRow()];
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

  // Estimate for synced rows with no native calories
  useEffect(() => {
    if (!token || !loaded || !estimatesLoaded) return;
    merged
      .filter(r => !r.kcal && r.text && !estimating.current.has(r.id))
      .forEach(row => {
        estimating.current.add(row.id);
        setTick(t => t+1);
        estimateNutrition(promptFn(row.text), token).then(result => {
          estimating.current.delete(row.id);
          if (result) setSavedEstimates(prev => ({...(typeof prev==="object"&&prev?prev:{}), [row.id]:result}));
          else setTick(t => t+1);
        });
      });
  }, [syncedRows, loaded, estimatesLoaded, token]); // eslint-disable-line

  async function runEstimate(id, text) {
    setRows(safe.map(r => r.id===id ? {...r, estimating:true} : r));
    const result = await estimateNutrition(promptFn(text), token);
    setRows(prev => (Array.isArray(prev)?prev:safe).map(r => r.id===id ? {...r, kcal:result?.kcal||null, protein:result?.protein||null, estimating:false} : r));
  }

  function onKey(e, id, idx) {
    if (e.key==="Enter") {
      e.preventDefault();
      const row = mkRow();
      const i = safe.findIndex(r => r.id===id);
      setRows([...safe.slice(0,i+1), row, ...safe.slice(i+1)]);
      setTimeout(() => refs.current[row.id]?.focus(), 30);
    }
    if (e.key==="Backspace" && safe[idx]?.text==="" && safe.length>1) {
      e.preventDefault();
      setRows(safe.filter(r => r.id!==id));
      const t = safe[idx-1]?.id ?? safe[idx+1]?.id;
      setTimeout(() => refs.current[t]?.focus(), 30);
    }
  }

  if (!loaded) return (
    <div style={{display:"flex",flexDirection:"column",gap:8,padding:"4px 0"}}>
      <Shimmer width="75%" height={13}/>
      <Shimmer width="55%" height={13}/>
      <Shimmer width="65%" height={13}/>
    </div>
  );

  const rowStyle = {display:"flex", alignItems:"baseline", gap:8, padding:"2px 0", minHeight:28};
  const kcalStyle = {fontFamily:mono, fontSize:10, color, flexShrink:0, minWidth:38, textAlign:"right", opacity:0.85};
  const proteinStyle = {fontFamily:mono, fontSize:10, color:C.blue, flexShrink:0, minWidth:30, textAlign:"right", opacity:0.85};

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
      <div style={{flex:1,overflowY:"auto",minHeight:0}}>
        {merged.map(row => (
          <div key={row.id} style={rowStyle}>
            <span style={{lineHeight:1.7,color:C.text,fontFamily:serif,fontSize:16,
              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flexShrink:1,minWidth:0}}>
              {row.text}
            </span>
            {row.details && row.details.length > 0 && (
              <span style={{display:"flex",gap:6,flexShrink:0,alignItems:"baseline"}}>
                {row.details.map((d,i) => {
                  const match = d.match(/^(.*\d)\s*([a-z]+)$/i);
                  const val = match ? match[1] : d;
                  const unit = match ? match[2] : "";
                  return (
                    <span key={i} style={{whiteSpace:"nowrap"}}>
                      <span style={{fontFamily:mono,fontSize:11,color:C.text,opacity:0.7}}>{val}</span>
                      {unit && <span style={{fontFamily:mono,fontSize:8,color:C.muted,marginLeft:1}}>{unit}</span>}
                    </span>
                  );
                })}
              </span>
            )}
            <SourceBadge source={row.source}/>
            <span style={{flex:1}}/>
            {showProtein && (
              <span style={proteinStyle}>
                {estimating.current.has(row.id) ? "…" : row.protein ? `${row.protein}p` : ""}
              </span>
            )}
            <span style={kcalStyle}>
              {estimating.current.has(row.id) ? "…" : row.kcal ? `${prefix}${row.kcal}` : ""}
            </span>
          </div>
        ))}
        {safe.map((row, idx) => (
          <div key={row.id} style={rowStyle}>
            <input ref={el=>refs.current[row.id]=el} value={row.text}
              onChange={e => setRows(safe.map(r => r.id===row.id ? {...r,text:e.target.value,kcal:null,protein:null} : r))}
              onBlur={e => { const r=safe.find(r=>r.id===row.id); if(e.target.value.trim()&&r?.kcal===null&&!r?.estimating) runEstimate(row.id,e.target.value); }}
              onKeyDown={e => onKey(e,row.id,idx)}
              placeholder={idx===0 && merged.length===0 ? placeholder : idx===0 ? "+ add more" : ""}
              style={{background:"transparent",border:"none",outline:"none",padding:0,flex:1,
                lineHeight:1.7,color:row.text?C.text:C.muted,fontFamily:serif,fontSize:16}}/>
            {showProtein && (
              <span style={proteinStyle}>
                {row.estimating ? "…" : row.protein ? `${row.protein}p` : ""}
              </span>
            )}
            <span style={kcalStyle}>
              {row.estimating ? "…" : row.kcal ? `${prefix}${row.kcal}` : ""}
            </span>
          </div>
        ))}
      </div>
      {(totalKcal > 0 || totalProtein > 0) && (
        <div style={{flexShrink:0,paddingTop:6,display:"flex",alignItems:"center",gap:12,borderTop:`1px solid ${C.border}`}}>
          <div style={{flex:1}}/>
          {showProtein && totalProtein > 0 && (
            <span style={{fontFamily:mono,fontSize:11,color:C.blue,opacity:0.9}}>{totalProtein}g protein</span>
          )}
          {totalKcal > 0 && (
            <span style={{fontFamily:mono,fontSize:11,color,opacity:0.9}}>{prefix}{totalKcal} kcal</span>
          )}
        </div>
      )}
    </div>
  );
}

function Meals({date,token,userId}){return <RowList date={date} type="meals" token={token} userId={userId} placeholder="What did you eat?" promptFn={t=>`Estimate for: "${t}". Return JSON: {"kcal":420,"protein":30}`} prefix="" color={C.accent} showProtein/>;}
function SourceBadge({source}) {
  const isStrava = source === "strava";
  return (
    <span style={{
      fontFamily:mono, fontSize:6, letterSpacing:"0.12em", textTransform:"uppercase",
      color: isStrava ? "#FC4C02" : "#B8A882",
      border: `1px solid ${isStrava ? "#FC4C02" : "#B8A882"}`,
      borderRadius:3, padding:"1px 4px", flexShrink:0, opacity:0.8,
    }}>{isStrava ? "Strava" : "Oura"}</span>
  );
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
      avgHr:act.avgHr, startTime:act.startTime, id:act.id });
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

function Activity({date,token,userId}) {
  const [syncedRows, setSyncedRows] = useState([]);

  useEffect(()=>{
    if(!token||!userId)return;
    setSyncedRows([]);
    // Use cached Oura response if HealthStrip already fetched it; Strava fetched fresh
    Promise.all([
      cachedOuraFetch(date, token, userId),
      fetch(`/api/strava?date=${date}`,{headers:{Authorization:`Bearer ${token}`}}).then(r=>r.json()).catch(()=>({})),
    ]).then(([ouraData, stravaData])=>{
      const merged = mergeWorkouts(ouraData.workouts||[], stravaData.activities||[]);
      setSyncedRows(merged.map(w=>({
        id: String(w.id || `${w.source}-${w.sport}-${w.durationMins}`),
        source: w.source,
        kcal: w.calories||null,
        text: w.name,
        details: [
          w.durationMins ? fmtMins(w.durationMins) : null,
          w.distance ? `${(w.distance * 0.621371).toFixed(1)}mi` : null,
          w.avgHr ? `${w.avgHr}bpm` : null,
        ].filter(Boolean),
      })));
    });
  },[date,token,userId]); // eslint-disable-line

  return (
    <RowList date={date} type="activity" token={token} userId={userId}
      syncedRows={syncedRows}
      placeholder="What did you do?"
      promptFn={t=>`Calories burned for activity: "${t}" for a typical adult. Include duration and distance hints if present in the text. Return JSON: {"kcal":300}`}
      prefix="−" color={C.green}/>
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
            queryParams:{access_type:"offline",prompt:"consent"},
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
const WIDGETS = [
  {id:"notes",    label:"Notes",    color:()=>C.accent, Comp:Notes},
  {id:"tasks",    label:"Tasks",    color:()=>C.blue,   Comp:Tasks},
  {id:"meals",    label:"Meals",    color:()=>C.red,    Comp:Meals},
  {id:"activity", label:"Activity", color:()=>C.green,  Comp:Activity},
];
const FULL_IDS = ["cal","health"];

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
  const [googleToken,setGoogleToken] = useState(null);

  const [fullOrder, setFullOrder] = useState(FULL_IDS);

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
  const sessionRefreshToken=session?.provider_refresh_token; // only present right after login
  const startSync=useCallback(k=>setSyncing(s=>new Set([...s,k])),[]);
  const endSync=useCallback(k=>{
    setSyncing(s=>{const n=new Set(s);n.delete(k);return n;});
    setLastSync(new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}));
  },[]);

  // sessionGoogleToken/refreshToken only used by calendar fetch now

  // Fetch calendar events — server handles token refresh automatically
  const calRefreshRef = useRef(null);
  useEffect(()=>{
    if(!token)return;
    startSync("cal");
    const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
    const start=toKey(shift(new Date(),-30));
    const end=toKey(shift(new Date(),60));

    const fetchCal=()=>fetch("/api/calendar",{method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
      body:JSON.stringify({start,end,tz})})
      .then(r=>r.ok?r.json():null)
      .then(d=>{
        if(d?.events) setEvents(prev=>({...prev,...d.events}));
        if(d?.googleToken) setGoogleToken(d.googleToken);
      })
      .catch(()=>{})
      .finally(()=>endSync("cal"));

    // On fresh login, save the provider token first, then fetch
    if(sessionGoogleToken){
      fetch("/api/google-token",{method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
        body:JSON.stringify({googleToken:sessionGoogleToken,refreshToken:sessionRefreshToken})})
        .then(()=>fetchCal()).catch(()=>fetchCal());
    } else {
      fetchCal();
    }

    // Re-fetch every 45 min to keep events fresh
    calRefreshRef.current = setInterval(fetchCal, 45*60*1000);
    return ()=>{ if(calRefreshRef.current) clearInterval(calRefreshRef.current); };
  },[token]); // eslint-disable-line

  const onHealthChange=useCallback((date,data)=>{
    setHealthDots(prev=>({...prev,[date]:{sleep:+data.sleepScore||0,readiness:+data.readinessScore||0,activity:+data.activityScore||0,recovery:+data.resilienceScore||0}}));
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
              recovery:+data.resilienceScore||0,
            }}));
          }).catch(()=>{});
      }, i*150); // stagger 150ms apart to avoid hammering
    });
  },[token,userId]); // eslint-disable-line

  const mobile = useIsMobile();
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
  const [leftWidget,...rightWidgets] = WIDGETS;

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
                              events={events} setEvents={setEvents} healthDots={healthDots}
                              token={token} googleToken={googleToken} dragProps={dragProps}/>
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
              <Widget label={w.label} color={w.color()} dragProps={{}}>
                <w.Comp date={selected} token={token} userId={userId}/>
              </Widget>
            </div>
          ))}
        </div>
      ) : (
        /* ── DESKTOP: stacked layout — cal, health, then 2-col widgets ─── */
        <div style={{flex:1,overflowY:"auto",padding:10,display:"flex",flexDirection:"column",gap:8}}>

          {/* Calendar — full width, auto-height based on view mode */}
          <div style={{flexShrink:0}}>
            <CalStrip selected={selected} onSelect={setSelected}
              events={events} setEvents={setEvents} healthDots={healthDots}
              token={token} googleToken={googleToken} dragProps={{}}/>
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
              <Widget label={leftWidget.label} color={leftWidget.color()} dragProps={{}}>
                <leftWidget.Comp date={selected} token={token} userId={userId}/>
              </Widget>
            </div>
            {/* Tasks, Meals, Activity stacked on right */}
            <div style={{flex:"1 1 0",minWidth:0,display:"flex",flexDirection:"column",gap:8}}>
              {rightWidgets.map(w=>(
                <div key={w.id} style={{flex:"1 1 0",minHeight:140}}>
                  <Widget label={w.label} color={w.color()} dragProps={{}}>
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
