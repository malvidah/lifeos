"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "../lib/supabase.js";


const THEMES = {
  dark: {
    bg:"#0A0A0A", surface:"#16171A", card:"#1C1D21",
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
  const prevCacheKey = useRef(cacheKey);
  const [value, _set] = useState(() => MEM[cacheKey] ?? empty);
  const [loaded, setLoaded] = useState(cacheKey in MEM);
  const [rev, setRev] = useState(0);
  const live = useRef(value);
  const dateRef = useRef(date);
  const timerRef = useRef(null);
  live.current = value;

  // When date changes the cacheKey changes — immediately show empty/cached value
  // so the previous date's data is never visible on the new date
  if (prevCacheKey.current !== cacheKey) {
    prevCacheKey.current = cacheKey;
    const next = MEM[cacheKey] ?? empty;
    live.current = next;
    _set(next);
    setLoaded(cacheKey in MEM);
  }

  // Listen for external refresh events (e.g. from voice input)
  useEffect(() => {
    const handler = (e) => {
      if (!e.detail?.types || e.detail.types.includes(type)) {
        // Clear cache so we get fresh DB data
        delete MEM[cacheKey];
        delete DIRTY[cacheKey];
        setRev(r => r + 1);
      }
    };
    window.addEventListener('lifeos:refresh', handler);
    return () => window.removeEventListener('lifeos:refresh', handler);
  }, [type, cacheKey]);

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
        style={{fill:score?C.text:C.muted,fontSize:13,fontFamily:serif,
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



// ─── Widget card ─────────────────────────────────────────────────────────────
function Widget({label,color,children,slim}) {
  return (
    <div style={slim ? {} : {height:"100%",display:"flex",flexDirection:"column"}}>
      <Card>
        <div style={{
          display:"flex",alignItems:"center",gap:10,padding:"12px 16px",
          borderBottom:`1px solid ${C.border}`,flexShrink:0,
        }}>
          <div style={{width:3,height:14,borderRadius:2,background:color,flexShrink:0}}/>
          <span style={{fontFamily:mono,fontSize:12,letterSpacing:"0.18em",
            textTransform:"uppercase",color:C.muted}}>{label}</span>
        </div>
        <div style={slim ? {padding:"14px 16px"} : {flex:1,overflow:"auto",padding:16,minHeight:0}}>{children}</div>
      </Card>
    </div>
  );
}

// ─── UserMenu ─────────────────────────────────────────────────────────────────
function UserMenu({session,token,userId,theme,onThemeChange}) {
  const [open,setOpen]=useState(false);
  const [ouraKey,setOuraKey]=useState("");
  const [ouraConnected,setOuraConnected]=useState(false);
  const [stravaConnected,setStravaConnected]=useState(false);
  const [saving,setSaving]=useState(false);
  const [saved,setSaved]=useState(false);
  const ref=useRef(null);
  const user=session?.user;
  const initials=user?.user_metadata?.name?.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()||user?.email?.[0]?.toUpperCase()||"?";
  const avatar=user?.user_metadata?.avatar_url;

  useEffect(()=>{
    if(!token||!open)return;
    dbLoad("global","settings",token).then(d=>{
      if(d?.ouraToken){setOuraKey(d.ouraToken);setOuraConnected(true);}
    }).catch(()=>{});
    fetch("/api/entries?date=0000-00-00&type=strava_token",{headers:{Authorization:`Bearer ${token}`}})
      .then(r=>r.json()).then(d=>{if(d?.data?.access_token)setStravaConnected(true);}).catch(()=>{});
  },[token,open]); // eslint-disable-line
  useEffect(()=>{
    if(!open)return;
    const fn=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};
    document.addEventListener("mousedown",fn);
    return ()=>document.removeEventListener("mousedown",fn);
  },[open]);

  async function saveOura(){
    if(!ouraKey.trim())return;
    setSaving(true);
    try {
      await fetch("/api/entries",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
        body:JSON.stringify({date:"global",type:"settings",data:{ouraToken:ouraKey.trim()}}),
      });
      setOuraConnected(true);setSaved(true);setTimeout(()=>setSaved(false),2000);
    } catch(e){alert("Save failed: "+e.message);}
    setSaving(false);
  }

  return (
    <div ref={ref} style={{position:"relative"}}>
      <button onClick={()=>setOpen(o=>!o)} style={{
        width:32,height:32,borderRadius:"50%",padding:0,cursor:"pointer",
        border:`1.5px solid ${C.border2}`,background:avatar?"transparent":C.surface,
        overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center"}}>
        {avatar?<img src={avatar} width={32} height={32} style={{objectFit:"cover"}} alt=""/>
          :<span style={{fontFamily:mono,fontSize:12,color:C.muted}}>{initials}</span>}
      </button>
      {open&&(
        <div style={{position:"absolute",top:40,right:0,width:280,zIndex:300,
          background:C.card,border:`1px solid ${C.border2}`,borderRadius:R,
          padding:16,display:"flex",flexDirection:"column",gap:12,
          boxShadow:C.shadow}}>
          <div>
            <div style={{fontFamily:serif,fontSize:14,color:C.text}}>{user?.user_metadata?.name||"—"}</div>
            <div style={{fontFamily:mono,fontSize:13,color:C.muted,marginTop:3}}>{user?.email}</div>
          </div>
          <div style={{height:1,background:C.border}}/>

          {/* Oura */}
          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
              <span style={{fontFamily:mono,fontSize:12,letterSpacing:"0.15em",textTransform:"uppercase",color:C.muted}}>Oura Ring</span>
              {ouraConnected&&<span style={{fontFamily:mono,fontSize:12,color:C.green,letterSpacing:"0.08em"}}>✓ connected</span>}
            </div>
            <input
              type="password" value={ouraKey}
              onChange={e=>{setOuraKey(e.target.value);setOuraConnected(false);setSaved(false);}}
              placeholder="Paste personal access token…"
              style={{width:"100%",background:C.surface,border:`1px solid ${ouraConnected?C.green:C.border2}`,
                borderRadius:6,outline:"none",color:C.text,fontFamily:mono,fontSize:12,
                padding:"7px 10px",boxSizing:"border-box"}}/>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:6}}>
              <a href="https://cloud.ouraring.com/personal-access-tokens" target="_blank" rel="noreferrer"
                style={{fontFamily:mono,fontSize:12,color:C.accent,letterSpacing:"0.06em",textDecoration:"none"}}>
                Get your token →
              </a>
              <button onClick={saveOura} disabled={saving||!ouraKey.trim()} style={{
                background:saved?C.green+"22":"none",border:`1px solid ${saved?C.green:C.border2}`,
                borderRadius:5,color:saved?C.green:C.text,fontFamily:mono,fontSize:12,
                letterSpacing:"0.1em",textTransform:"uppercase",padding:"4px 10px",cursor:"pointer"}}>
                {saved?"saved ✓":saving?"saving…":"save"}
              </button>
            </div>
          </div>

          <div style={{height:1,background:C.border}}/>

          {/* Strava */}
          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <span style={{fontFamily:mono,fontSize:12,letterSpacing:"0.15em",textTransform:"uppercase",color:C.muted}}>Strava</span>
              {stravaConnected&&<span style={{fontFamily:mono,fontSize:12,color:C.green,letterSpacing:"0.08em"}}>✓ connected</span>}
            </div>
            <button
              onClick={()=>window.location.href="/api/strava-connect"}
              style={{
                width:"100%",background:stravaConnected?"transparent":"#FC4C0211",
                border:`1px solid ${stravaConnected?C.green:"#FC4C02"}`,
                borderRadius:6,color:stravaConnected?C.green:"#FC4C02",
                fontFamily:mono,fontSize:13,letterSpacing:"0.12em",textTransform:"uppercase",
                padding:"8px",cursor:"pointer",transition:"all 0.2s"}}>
              {stravaConnected?"✓ strava connected":"connect strava"}
            </button>
          </div>
          <div style={{height:1,background:C.border}}/>
          {/* Light / Dark toggle */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span style={{fontFamily:mono,fontSize:12,letterSpacing:"0.12em",textTransform:"uppercase",color:C.muted}}>
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

          {/* Desktop app */}
          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <span style={{fontFamily:mono,fontSize:12,letterSpacing:"0.15em",textTransform:"uppercase",color:C.muted}}>Mac App</span>
              <span style={{fontFamily:mono,fontSize:11,color:C.dim}}>v1.0.0</span>
            </div>
            <a
              href="/download/mac"
              style={{
                display:"flex",alignItems:"center",justifyContent:"center",gap:8,
                width:"100%",padding:"8px",boxSizing:"border-box",
                background:C.surface,border:`1px solid ${C.border2}`,
                borderRadius:6,cursor:"pointer",textDecoration:"none",
                color:C.text,fontFamily:mono,fontSize:12,
                letterSpacing:"0.12em",textTransform:"uppercase",
                transition:"border-color 0.15s",
              }}
              onMouseEnter={e=>e.currentTarget.style.borderColor=C.accent}
              onMouseLeave={e=>e.currentTarget.style.borderColor=C.border2}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Download for Mac
            </a>
          </div>

          {/* iOS app */}
          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <span style={{fontFamily:mono,fontSize:12,letterSpacing:"0.15em",textTransform:"uppercase",color:C.muted}}>iPhone App</span>
              <span style={{fontFamily:mono,fontSize:11,color:C.dim}}>TestFlight</span>
            </div>
            <a
              href="/download/ios"
              style={{
                display:"flex",alignItems:"center",justifyContent:"center",gap:8,
                width:"100%",padding:"8px",boxSizing:"border-box",
                background:C.surface,border:`1px solid ${C.border2}`,
                borderRadius:6,cursor:"pointer",textDecoration:"none",
                color:C.text,fontFamily:mono,fontSize:12,
                letterSpacing:"0.12em",textTransform:"uppercase",
                transition:"border-color 0.15s",
              }}
              onMouseEnter={e=>e.currentTarget.style.borderColor=C.accent}
              onMouseLeave={e=>e.currentTarget.style.borderColor=C.border2}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
                <line x1="12" y1="18" x2="12" y2="18"/>
              </svg>
              Join iOS Beta
            </a>
          </div>

          <div style={{height:1,background:C.border}}/>
          <button onClick={async()=>{const s=createClient();await s.auth.signOut();}}
            style={{background:"none",border:"none",padding:0,textAlign:"left",cursor:"pointer",
              color:C.muted,fontFamily:mono,fontSize:13,letterSpacing:"0.12em",textTransform:"uppercase"}}>
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
  const isElectron = typeof window !== "undefined" && !!window.dayloopNative;
  return (
    <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,
      padding:"0 16px",
      height:48,display:"flex",alignItems:"center",gap:12,flexShrink:0,
      position:"sticky",top:0,zIndex:100,
      WebkitAppRegion:"drag",userSelect:"none"}}>
      {/* Left spacer on desktop so date centers properly */}
      <div style={{flex:1,display:"flex",alignItems:"baseline",gap:7,
        justifyContent:"flex-start",visibility:"hidden",pointerEvents:"none",
        "@media(maxWidth:768px)":{display:"none"}}}>
        <span style={{fontFamily:mono,fontSize:13}}>●</span>
        <div style={{width:70}}/>
      </div>
      {/* Day Loop — centered */}
      <div style={{position:"absolute",left:"50%",transform:"translateX(-50%)"}}>
        <span style={{fontFamily:serif,fontSize:17,color:C.text,letterSpacing:"-0.02em"}}>Day Loop</span>
      </div>
      <div style={{flex:1}}/>
      <div style={{WebkitAppRegion:"no-drag"}}>
        <UserMenu session={session} token={token} userId={userId} theme={theme} onThemeChange={onThemeChange}/>
      </div>
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
function NavBtn({onClick,title,children}) {
  return (
    <button onClick={onClick} title={title} style={{
      background:'none',border:'none',cursor:'pointer',
      color:C.muted,fontFamily:mono,fontSize:15,lineHeight:1,
      padding:'3px 5px',borderRadius:4,transition:'color 0.1s',
    }}
    onMouseEnter={e=>e.currentTarget.style.color=C.text}
    onMouseLeave={e=>e.currentTarget.style.color=C.muted}>
      {children}
    </button>
  );
}
function MobileCalPicker({selected, onSelect, events, healthDots={}, desktop=false, onEventClick, onAddClick}) {
  const today = todayKey();
  const DAY_W = 175;

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
    const DURATION = 280;
    const tick = (now) => {
      const t = Math.min((now - startTime) / DURATION, 1);
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

  function snap() { animateTo(Math.round(liveOff.current)); }

  function runMomentum() {
    cancelRaf();
    const FRICTION = 0.86;
    const tick = () => {
      vel.current *= FRICTION;
      liveOff.current -= vel.current / DAY_W;
      repaint();
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
  const selInt   = Math.round(off);
  const fracSlot = off - selInt;
  const selDate  = offsetToDate(selInt);
  const selMonth = MONTHS_FULL[selDate.getMonth()];
  const selYear  = selDate.getFullYear();

  // Build day items: enough to fill screen
  const N = 6;
  const dayItems = [];
  for (let i = -N; i <= N; i++) {
    dayItems.push({ d: offsetToDate(selInt + i), i });
  }

  const DAY_NAMES = ["Su","Mo","Tu","We","Th","Fr","Sa"];

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

  const tapDay = (targetOffset) => {
    if (totalDrag.current > 8) return;
    animateTo(targetOffset);
  };

  const MAX_EVENTS = 5;

  return (
    <div style={{userSelect:"none", display:"flex", flexDirection:"column"}}>

      {/* ── Static month + year header ────────────────────────────────────── */}
      <div style={{
        display:"flex", alignItems:"center",
        padding:"10px 16px 8px",
        borderBottom:`1px solid ${C.border}`,
        flexShrink:0, position:'relative',
      }}>
        {/* CALENDAR label — left */}
        <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
          <div style={{width:3,height:14,borderRadius:2,background:C.blue,flexShrink:0}}/>
          <span style={{fontFamily:mono,fontSize:12,letterSpacing:'0.18em',textTransform:'uppercase',color:C.muted}}>Calendar</span>
        </div>

        {/* Date — absolutely centered, no arrows */}
        <div style={{position:'absolute',left:'50%',transform:'translateX(-50%)',
          pointerEvents:'none',userSelect:'none',whiteSpace:'nowrap'}}>
          <span style={{fontFamily:serif,fontSize:17,letterSpacing:'-0.02em',color:C.text}}>
            {selMonth} {selDate.getDate()}, {selYear}
          </span>
        </div>

        {/* RIGHT: LAST YEAR + TODAY */}
        <div style={{marginLeft:'auto',flexShrink:0,display:'flex',gap:6}}>
          <button onClick={()=>{const d=new Date(selDate);d.setFullYear(d.getFullYear()-1);onSelect(toKey(d));}} style={{
            background:'none',border:`1px solid ${C.border2}`,borderRadius:5,cursor:'pointer',
            color:C.muted,fontFamily:mono,fontSize:11,letterSpacing:'0.1em',
            textTransform:'uppercase',padding:'4px 9px',transition:'all 0.15s'}}
            onMouseEnter={e=>{e.currentTarget.style.color=C.text;e.currentTarget.style.borderColor=C.text;}}
            onMouseLeave={e=>{e.currentTarget.style.color=C.muted;e.currentTarget.style.borderColor=C.border2;}}>
            Last year
          </button>
          <button onClick={()=>onSelect(todayKey())} style={{
            background:'none',border:`1px solid ${C.border2}`,borderRadius:5,cursor:'pointer',
            color:C.muted,fontFamily:mono,fontSize:11,letterSpacing:'0.1em',
            textTransform:'uppercase',padding:'4px 9px',transition:'all 0.15s'}}
            onMouseEnter={e=>{e.currentTarget.style.color=C.text;e.currentTarget.style.borderColor=C.text;}}
            onMouseLeave={e=>{e.currentTarget.style.color=C.muted;e.currentTarget.style.borderColor=C.border2;}}>
            Today
          </button>
        </div>
      {/* ── Day columns with events ──────────────────────────────────────── */}
      <div style={{
        overflow:"hidden", position:"relative",
        touchAction:"none", cursor:"grab",
        padding:"8px 0 12px",
        height: 292,
        flexShrink: 0,
      }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onMouseDown={e => { onTouchStart({touches:[{clientX:e.clientX}]}); }}
        onMouseMove={e => { if(e.buttons!==1)return; onTouchMove({preventDefault:()=>{},touches:[{clientX:e.clientX}]}); }}
        onMouseUp={() => { onTouchEnd(); }}
        onMouseLeave={e => { if(e.buttons===1) onTouchEnd(); }}
      >
        {/* Scrolling row */}
        <div style={{
          display:"flex", alignItems:"flex-start",
          marginLeft:`calc(50% - ${(N + 0.5) * DAY_W}px)`,
          transform:`translateX(${-fracSlot * DAY_W}px)`,
          willChange:"transform",
        }}>
          {dayItems.map(({d, i}) => {
            const k      = toKey(d);
            const isCtr  = i === 0;
            const isTdy  = k === today;
            const dayEvents = (events[k] || []).slice().sort((a,b) => timeToMins(a.time) - timeToMins(b.time));
            const dist = Math.abs(i);
            const opacity = isCtr ? 1 : Math.max(0.2, 1 - dist * 0.15);

            return (
              <div key={k}
                onClick={() => tapDay(selInt + i)}
                style={{
                  width:DAY_W, flexShrink:0,
                  padding:"4px 3px",
                  cursor: isCtr ? "default" : "pointer",
                  opacity,
                  transition: "opacity 0.15s",
                  borderLeft: isCtr ? `1px solid ${C.accent}20` : "1px solid transparent",
                  borderRight: isCtr ? `1px solid ${C.accent}20` : "1px solid transparent",
                  background: isCtr ? `${C.accent}08` : "transparent",
                  borderRadius: 6,
                  height: 272,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                }}>
                {/* Date header */}
                <div style={{textAlign:"center", marginBottom:6, paddingTop:2, flexShrink:0}}>
                  <div style={{
                    fontFamily:mono, fontSize:12, letterSpacing:"0.07em",
                    color: isCtr ? C.accent : C.muted,
                    marginBottom:3,
                  }}>{DAY_NAMES[d.getDay()]}</div>
                  <div style={{
                    fontFamily:serif,
                    fontSize: isCtr ? 26 : 18,
                    fontWeight: isCtr ? "600" : "normal",
                    lineHeight:1,
                    color: isTdy ? C.accent : isCtr ? C.text : C.muted,
                  }}>{d.getDate()}</div>
                  {/* Health dots */}
                  <div style={{display:"flex",gap:2,justifyContent:"center",marginTop:4,height:4}}>
                    {(healthDots[k]?.sleep >= 85) && <div style={{width:3,height:3,borderRadius:"50%",background:C.blue}}/>}
                    {(healthDots[k]?.readiness >= 85) && <div style={{width:3,height:3,borderRadius:"50%",background:C.green}}/>}
                    {(healthDots[k]?.activity >= 85) && <div style={{width:3,height:3,borderRadius:"50%",background:C.accent}}/>}
                    {(healthDots[k]?.recovery >= 85) && <div style={{width:3,height:3,borderRadius:"50%",background:"#8B6BB5"}}/>}
                  </div>
                </div>

                {/* Event cards — scrollable, no truncation */}
                <div style={{display:"flex",flexDirection:"column",gap:2,
                  overflowY:isCtr?"auto":"hidden",flex:1,minHeight:0,
                  scrollbarWidth:"none",msOverflowStyle:"none"}}>
                  {dayEvents.map((ev,j) => (
                    <div key={j}
                      onClick={isCtr && onEventClick ? (e)=>{e.stopPropagation();onEventClick(ev);} : undefined}
                      style={{
                        padding:"2px 4px", borderRadius:3, flexShrink:0,
                        borderLeft:`2px solid ${ev.color||C.accent}`,
                        background:`${ev.color||C.accent}10`,
                        cursor: isCtr && onEventClick ? 'pointer' : 'default',
                        transition:'background 0.1s',
                      }}
                      onMouseEnter={isCtr&&onEventClick?e=>{e.currentTarget.style.background=`${ev.color||C.accent}25`;}:undefined}
                      onMouseLeave={isCtr&&onEventClick?e=>{e.currentTarget.style.background=`${ev.color||C.accent}10`;}:undefined}
                    >
                      <div style={{fontFamily:mono, fontSize:11, color:C.muted, lineHeight:1.3}}>
                        {ev.time !== "all day" ? ev.time : ""}
                      </div>
                      <div style={{fontFamily:serif, fontSize:12, color: isCtr ? C.text : C.muted,
                        lineHeight:1.3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
                        {ev.title}
                      </div>
                    </div>
                  ))}

                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Fixed + ADD bar ── */}
      {onAddClick && (
        <div style={{borderTop:`1px solid ${C.border}`,padding:'8px 16px',flexShrink:0}}>
          <button onClick={onAddClick} style={{
            width:'100%',background:'none',
            border:`1px solid ${C.border2}`,
            borderRadius:5,cursor:'pointer',
            color:C.muted,fontFamily:mono,fontSize:11,
            letterSpacing:'0.12em',textTransform:'uppercase',
            padding:'7px 0',textAlign:'center',
            transition:'all 0.15s',
          }}
          onMouseEnter={e=>{e.currentTarget.style.color=C.text;e.currentTarget.style.borderColor=C.text;}}
          onMouseLeave={e=>{e.currentTarget.style.color=C.muted;e.currentTarget.style.borderColor=C.border2;}}>
            + Add Event
          </button>
        </div>
      )}
    </div>
  );
}
function CalStrip({selected, onSelect, events, setEvents, healthDots, token}) {
  const mobile = useIsMobile();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [active,   setActive]  = useState(null);
  const [form,     setForm]    = useState({title:'',startTime:'',endTime:'',allDay:false});
  const [saving,   setSaving]  = useState(false);
  const [deleting, setDeleting]= useState(false);
  const [saveErr,  setSaveErr] = useState('');
  const [dirty,    setDirty]   = useState(false);

  const isNew = active !== null && !active.id;
  const color = active?.color || C.accent;

  const toHHMM = t => {
    if (!t || t === 'all day') return '';
    try { return new Date('2000-01-01 ' + t).toTimeString().slice(0,5); } catch { return ''; }
  };

  function openAdd() {
    setActive({});
    setForm({title:'', startTime:'09:00', endTime:'10:00', allDay:false});
    setSaveErr(''); setDirty(false);
  }

  function openEvent(ev) {
    if (active?.id === ev.id) { closePanel(); return; }
    setActive(ev);
    setForm({
      title: ev.title || '',
      startTime: ev.allDay ? '' : toHHMM(ev.time),
      endTime:   ev.allDay ? '' : toHHMM(ev.endTime),
      allDay:    ev.allDay || ev.time === 'all day',
    });
    setSaveErr(''); setDirty(false);
  }

  function closePanel() { setActive(null); setSaveErr(''); setDirty(false); }
  function updateForm(patch) { setForm(f => ({...f,...patch})); setDirty(true); }

  async function save() {
    if (!form.title.trim() || saving) return;
    setSaving(true); setSaveErr('');
    try {
      if (isNew) {
        const res = await fetch('/api/calendar-create', {
          method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
          body: JSON.stringify({title:form.title.trim(),date:selected,
            startTime:form.allDay?'':form.startTime,endTime:form.allDay?'':form.endTime,
            allDay:form.allDay,tz}),
        });
        const data = await res.json();
        if (!res.ok||data.error){ setSaveErr(data.error||'Failed'); setSaving(false); return; }
        setEvents(prev=>({...prev,[selected]:[...(prev[selected]||[]),
          {id:data.eventId,title:form.title.trim(),
           time:form.allDay?'all day':(form.startTime||'all day'),
           endTime:form.allDay?null:form.endTime,allDay:form.allDay,color:'#B8A882'}]}));
        closePanel();
      } else {
        const res = await fetch('/api/calendar-update', {
          method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
          body: JSON.stringify({eventId:active.id,title:form.title.trim(),date:selected,
            startTime:form.allDay?'':form.startTime,endTime:form.allDay?'':form.endTime,
            allDay:form.allDay,tz}),
        });
        const data = await res.json();
        if (!res.ok||data.error){ setSaveErr(data.error||'Failed'); setSaving(false); return; }
        const updated = {...active,title:form.title.trim(),
          time:form.allDay?'all day':(form.startTime||'all day'),
          endTime:form.allDay?null:form.endTime,allDay:form.allDay};
        setEvents(prev=>({...prev,[selected]:(prev[selected]||[]).map(e=>e.id===active.id?updated:e)}));
        setActive(updated); setDirty(false);
      }
    } catch(err){ setSaveErr(err.message); }
    setSaving(false);
  }

  async function deleteEvent() {
    if (!active?.id||deleting) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/calendar-delete', {
        method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
        body: JSON.stringify({eventId:active.id}),
      });
      if (res.ok) {
        setEvents(prev=>({...prev,[selected]:(prev[selected]||[]).filter(e=>e.id!==active.id)}));
        closePanel();
      }
    } catch{} finally{ setDeleting(false); }
  }

  const prevSelected = useRef(selected);
  useEffect(()=>{
    if(prevSelected.current!==selected){ prevSelected.current=selected; closePanel(); }
  },[selected]); // eslint-disable-line

  const inputBase = {
    background:'transparent', border:'none', outline:'none',
    padding:0, margin:0, color:C.text,
  };

  return (
    <Card>
      <MobileCalPicker
        selected={selected} onSelect={onSelect}
        events={events} healthDots={healthDots} desktop={!mobile}
        onEventClick={openEvent} onAddClick={openAdd}
      />

      {/* ── Event panel ── */}
      {active !== null && (
        <div style={{borderTop:`1px solid ${C.border}`,padding:'12px 16px'}}>

          {/* Main row: color bar | info | delete | × */}
          <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>

            {/* Color bar */}
            <div style={{width:3,borderRadius:2,background:color,
              flexShrink:0,alignSelf:'stretch',minHeight:34,marginTop:2}}/>

            {/* Info: title + time row */}
            <div style={{flex:1,minWidth:0}}>
              {/* Title */}
              <input
                autoFocus
                value={form.title}
                onChange={e=>updateForm({title:e.target.value})}
                onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();save();}if(e.key==='Escape')closePanel();}}
                onBlur={()=>{if(!isNew&&dirty&&form.title.trim())save();}}
                placeholder='Event title'
                style={{...inputBase,fontFamily:serif,fontSize:16,width:'100%',
                  display:'block',marginBottom:5}}
              />

              {/* Time row: times + All Day inline */}
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                {/* Time inputs — hidden when allDay */}
                <div style={{
                  display:'flex',alignItems:'center',gap:5,
                  maxWidth:form.allDay?0:200,
                  overflow:'hidden',
                  opacity:form.allDay?0:1,
                  transition:'max-width 0.25s ease, opacity 0.2s ease',
                }}>
                  <input type='time' value={form.startTime}
                    onChange={e=>updateForm({startTime:e.target.value})}
                    onBlur={()=>{if(!isNew&&dirty)save();}}
                    style={{...inputBase,fontFamily:mono,fontSize:12,color:C.muted,
                      width:70,cursor:'text'}}
                  />
                  <span style={{fontFamily:mono,fontSize:11,color:C.muted,opacity:0.4}}>–</span>
                  <input type='time' value={form.endTime}
                    onChange={e=>updateForm({endTime:e.target.value})}
                    onBlur={()=>{if(!isNew&&dirty)save();}}
                    style={{...inputBase,fontFamily:mono,fontSize:12,color:C.muted,
                      width:70,cursor:'text'}}
                  />
                </div>

                {/* All Day toggle */}
                <button onClick={()=>updateForm({allDay:!form.allDay})} style={{
                  background:'none',border:'none',cursor:'pointer',padding:0,
                  fontFamily:mono,fontSize:11,letterSpacing:'0.08em',textTransform:'uppercase',
                  color:form.allDay?C.accent:C.muted,
                  transition:'color 0.2s',
                }}
                onMouseEnter={e=>{if(!form.allDay)e.currentTarget.style.color=C.text;}}
                onMouseLeave={e=>{if(!form.allDay)e.currentTarget.style.color=C.muted;}}>
                  all day
                </button>

                {saving && <span style={{fontFamily:mono,fontSize:10,color:C.muted,opacity:0.5}}>saving…</span>}
              </div>

              {/* Save button for new events */}
              {isNew && form.title.trim() && (
                <button onClick={save} disabled={saving} style={{
                  marginTop:8,background:C.blue,border:'none',borderRadius:5,
                  padding:'5px 14px',color:'#fff',fontFamily:mono,fontSize:11,
                  letterSpacing:'0.1em',textTransform:'uppercase',
                  cursor:saving?'not-allowed':'pointer',opacity:saving?0.5:1,
                  transition:'opacity 0.15s',
                }}>
                  {saving?'saving…':'save'}
                </button>
              )}

              {active.zoomUrl && (
                <a href={active.zoomUrl} target='_blank' rel='noopener noreferrer'
                  style={{display:'inline-block',marginTop:6,fontFamily:mono,fontSize:11,
                    letterSpacing:'0.1em',textTransform:'uppercase',color:C.blue,textDecoration:'none'}}>
                  Join ↗
                </a>
              )}
            </div>

            {/* Right side: delete (existing only) + × close */}
            <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:8,flexShrink:0}}>
              {/* × close — no border */}
              <button onClick={closePanel} style={{
                background:'none',border:'none',cursor:'pointer',
                color:C.muted,fontSize:16,lineHeight:1,padding:'0 2px',
                transition:'color 0.1s',
              }}
              onMouseEnter={e=>e.currentTarget.style.color=C.text}
              onMouseLeave={e=>e.currentTarget.style.color=C.muted}>
                ×
              </button>

              {/* Trash — existing events only */}
              {!isNew && active.id && (
                <button onClick={deleteEvent} disabled={deleting} style={{
                  background:'none',border:'none',cursor:'pointer',
                  color:deleting?C.muted:'#A05050',fontSize:13,lineHeight:1,padding:'0 2px',
                  opacity:deleting?0.4:1,transition:'color 0.1s, opacity 0.1s',
                }}
                onMouseEnter={e=>{if(!deleting)e.currentTarget.style.opacity='0.7';}}
                onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
                  🗑
                </button>
              )}
            </div>

          </div>

          {saveErr && <div style={{fontFamily:mono,fontSize:11,color:'#A05050',marginTop:8}}>{saveErr}</div>}
        </div>
      )}
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


function HealthStrip({date,token,userId,onHealthChange,onSyncStart,onSyncEnd}) {
  const {value:h,setValue:setH,loaded}=useDbSave(date,"health",H_EMPTY,token,userId);

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
    onSyncStart("oura");
    cachedOuraFetch(date, token, userId).then(data=>{
        if(data.error){ onSyncEnd("oura"); return; }
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
        borderBottom:`1px solid ${C.border}`,flexShrink:0}}>        <div style={{width:3,height:13,borderRadius:2,background:C.green,flexShrink:0}}/>
        <span style={{fontFamily:mono,fontSize:13,letterSpacing:"0.2em",
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
                <div style={{fontFamily:mono,fontSize:13,letterSpacing:"0.15em",textTransform:"uppercase",color:m.color,marginBottom:6}}>{m.label}</div>
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                  {m.fields.map(f=>(
                    <div key={f.label}>
                      <div style={{fontFamily:mono,fontSize:12,textTransform:"uppercase",color:C.muted,marginBottom:2,letterSpacing:"0.08em"}}>{f.label}</div>
                      <div style={{display:"flex",alignItems:"baseline",gap:2}}>
                        <span style={{fontFamily:serif,fontSize:17,color:f.value&&f.value!=="—"?C.text:C.dim}}>{f.value||"—"}</span>
                        {f.unit&&<span style={{fontFamily:mono,fontSize:13,color:C.muted}}>{f.unit}</span>}
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

  // Auto-fill missing protein for rows that already have kcal but no protein
  useEffect(() => {
    if (!showProtein || !token || !loaded) return;
    safe
      .filter(r => r.text?.trim() && r.kcal && !r.protein && !estimating.current.has(r.id))
      .forEach(row => {
        estimating.current.add(row.id);
        setTick(t => t+1);
        estimateNutrition(promptFn(row.text), token).then(result => {
          estimating.current.delete(row.id);
          if (result?.protein) {
            setRows(prev => (Array.isArray(prev)?prev:safe).map(r =>
              r.id===row.id ? {...r, protein:result.protein, kcal:result.kcal||r.kcal} : r));
          } else setTick(t => t+1);
        });
      });
  }, [loaded, token, showProtein]); // eslint-disable-line

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
  const kcalStyle = {fontFamily:mono, fontSize:12, color, flexShrink:0, minWidth:38, textAlign:"right", opacity:0.85};
  const proteinStyle = {fontFamily:mono, fontSize:12, color:C.blue, flexShrink:0, minWidth:30, textAlign:"right", opacity:0.85};

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
                      <span style={{fontFamily:mono,fontSize:13,color:C.text,opacity:0.7}}>{val}</span>
                      {unit && <span style={{fontFamily:mono,fontSize:12,color:C.muted,marginLeft:1}}>{unit}</span>}
                    </span>
                  );
                })}
              </span>
            )}
            <SourceBadge source={row.source}/>
            <span style={{flex:1}}/>
            {showProtein && (
              <span style={proteinStyle}>
                {estimating.current.has(row.id) ? "…" : row.protein ? `${row.protein}g protein` : ""}
              </span>
            )}
            <span style={kcalStyle}>
              {estimating.current.has(row.id) ? "…" : row.kcal ? `${prefix}${row.kcal} kcal` : ""}
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
                {row.estimating ? "…" : row.protein ? `${row.protein}g protein` : ""}
              </span>
            )}
            <span style={kcalStyle}>
              {row.estimating ? "…" : row.kcal ? `${prefix}${row.kcal} kcal` : ""}
            </span>
          </div>
        ))}
      </div>
      {(totalKcal > 0 || totalProtein > 0) && (
        <div style={{flexShrink:0,paddingTop:6,display:"flex",alignItems:"center",gap:12,borderTop:`1px solid ${C.border}`}}>
          <div style={{flex:1}}/>
          {showProtein && totalProtein > 0 && (
            <span style={{fontFamily:mono,fontSize:13,color:C.blue,opacity:0.9}}>{totalProtein}g protein</span>
          )}
          {totalKcal > 0 && (
            <span style={{fontFamily:mono,fontSize:13,color,opacity:0.9}}>{prefix}{totalKcal} kcal</span>
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
    Promise.all([
      cachedOuraFetch(date, token, userId),
      fetch(`/api/strava?date=${date}`,{headers:{Authorization:`Bearer ${token}`}}).then(r=>r.json()).catch(()=>({})),
    ]).then(([ouraData, stravaData])=>{
      const merged = mergeWorkouts(ouraData.workouts||[], stravaData.activities||[]);
      const rows = merged.map(w=>({
        id: String(w.id || `${w.source}-${w.sport}-${w.durationMins}`),
        source: w.source,
        kcal: w.calories||null,
        text: w.name,
        details: [
          w.durationMins ? fmtMins(w.durationMins) : null,
          w.distance ? `${(w.distance * 0.621371).toFixed(1)}mi` : null,
          w.avgHr ? `${w.avgHr}bpm` : null,
        ].filter(Boolean),
      }));
      setSyncedRows(rows);
      // Persist to DB so insights API can read workout history across days
      if (rows.length && token) {
        const summary = merged.map(w => ({
          name: w.name, sport: w.sport, source: w.source,
          durationMins: w.durationMins||null, distance: w.distance||null,
          calories: w.calories||null, avgHr: w.avgHr||null,
        }));
        fetch('/api/entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ date, type: 'workouts', data: summary }),
        }).catch(()=>{});
      }
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
            {row.done&&<span style={{fontSize:12,color:C.bg,lineHeight:1}}>✓</span>}
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
    <div style={{background:C.bg,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",position:"relative"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontFamily:serif,fontSize:32,color:C.text,marginBottom:6,letterSpacing:"-0.02em"}}>Day Loop</div>
        <div style={{fontFamily:mono,fontSize:13,color:C.muted,letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:48}}>your ai dashboard</div>
        <button disabled={loading} onClick={async()=>{
          setLoading(true);
          const supabase=createClient();
          await supabase.auth.signInWithOAuth({provider:"google",options:{
            scopes:"https://www.googleapis.com/auth/calendar",
            redirectTo:`${window.location.origin}/auth/callback`,
            queryParams:{access_type:"offline",prompt:"consent"},
          }});
        }} style={{background:"none",border:`1px solid ${C.border2}`,borderRadius:8,
          color:loading?C.muted:C.text,fontFamily:mono,fontSize:12,letterSpacing:"0.15em",
          textTransform:"uppercase",padding:"13px 32px",cursor:loading?"not-allowed":"pointer"}}>
          {loading?"redirecting…":"sign in with google"}
        </button>
        <div style={{position:'absolute',bottom:24,left:0,right:0,display:'flex',justifyContent:'center',gap:24}}>
  <a href='/privacy' style={{fontFamily:mono,fontSize:10,letterSpacing:'0.12em',textTransform:'uppercase',color:C.muted,textDecoration:'none',opacity:0.6}}>Privacy</a>
  <a href='/terms' style={{fontFamily:mono,fontSize:10,letterSpacing:'0.12em',textTransform:'uppercase',color:C.muted,textDecoration:'none',opacity:0.6}}>Terms</a>
</div>
      </div>
      <div style={{position:"absolute",bottom:24,left:0,right:0,display:"flex",justifyContent:"center",gap:24}}>
        <a href="/privacy" style={{fontFamily:mono,fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",color:C.muted,textDecoration:"none",opacity:0.6}}>Privacy</a>
        <a href="/terms" style={{fontFamily:mono,fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",color:C.muted,textDecoration:"none",opacity:0.6}}>Terms</a>
      </div>
    </div>
  );
}

// ─── InsightsCard ─────────────────────────────────────────────────────────────
function InsightsCard({date, token, userId, healthKey}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [isFree, setIsFree] = useState(false);
  const prevDate = useRef(date);
  const generatedWithKey = useRef(null); // healthKey used for last generation, null = not yet
  const waitTimer = useRef(null);

  const BAD_VALUES = ["No data available", "No insights generated", "AI error"];

  function cleanInsight(t) {
    return t
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/^#{1,3}\s+/gm, '')
      .replace(/^[A-Za-z]+,\s+\w+ \d+\n+/, '')
      .trim();
  }

  function isBadCache(t, cached, currentHealthKey) {
    if (!t) return true;
    if (BAD_VALUES.some(b => t.includes(b))) return true;
    if (cached?.isWelcome && currentHealthKey) return true;
    if (cached?.v !== 7) return true;
    // If the insight was generated with different health data than what we have now, it's stale.
    // e.g. generated with yesterday's bleeding data, or generated before Oura loaded.
    if (cached?.healthKey !== undefined && cached.healthKey !== currentHealthKey) return true;
    return false;
  }

  async function generate(currentHealthKey) {
    if (!token || !userId) return;
    if (generatedWithKey.current === currentHealthKey) return; // already generated for this exact state
    generatedWithKey.current = currentHealthKey;
    clearTimeout(waitTimer.current);
    setBusy(true); setError(""); setIsFree(false);
    try {
      const cached = await dbLoad(date, "insights", token);
      const age = cached?.generatedAt ? Date.now() - new Date(cached.generatedAt).getTime() : Infinity;
      if (cached?.text && !isBadCache(cached.text, cached, currentHealthKey) && age < 4 * 60 * 60 * 1000) {
        setText(cleanInsight(cached.text)); setBusy(false); return;
      }
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ date, healthKey: currentHealthKey }),
      });
      const data = await res.json();
      if (data.tier === "free") { setIsFree(true); }
      else if (data.insight) setText(cleanInsight(data.insight));
      else if (data.error) setError(data.error);
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  // Reset on date change
  useEffect(() => {
    if (prevDate.current === date) return;
    prevDate.current = date;
    generatedWithKey.current = null;
    clearTimeout(waitTimer.current);
    setText(""); setError(""); setIsFree(false);
  }, [date]); // eslint-disable-line

  // Trigger generation:
  // - If real health data is present: generate immediately with that key
  // - If no health data after 3s: generate with the empty key (no-ring day / future date)
  // - If health arrives AFTER the empty-key fallback fired: regenerate with real data
  useEffect(() => {
    if (!token || !userId) return;
    const [, sleep, readiness] = (healthKey || "::").split(":");
    const hasRealData = (+sleep > 0) || (+readiness > 0);
    if (hasRealData) {
      clearTimeout(waitTimer.current);
      generate(healthKey);
    } else {
      // Only start the timer if we haven't generated yet
      if (generatedWithKey.current !== null) return;
      clearTimeout(waitTimer.current);
      waitTimer.current = setTimeout(() => generate(healthKey), 3000);
    }
    return () => clearTimeout(waitTimer.current);
  }, [date, token, userId, healthKey]); // eslint-disable-line

  return (
    <Widget label="Insights" color={C.muted} slim>
      {/* Fixed responsive height — content scrolls inside, no scrollbar visible */}
      <div style={{ height: "clamp(80px, 10vh, 120px)", overflowY: "auto", scrollbarWidth: "none" }}>
        <div style={{ opacity: busy && !text ? 0 : 1, transition: "opacity 0.3s ease" }}>
          {error && (
            <div style={{ fontFamily: mono, fontSize:13, color: C.red, lineHeight: 1.6 }}>{error}</div>
          )}
          {isFree ? (
            <div>
              {text && <div style={{ fontFamily: mono, fontSize:13, color: C.muted, lineHeight: 1.75, whiteSpace: "pre-line", marginBottom: 10 }}>{text}</div>}
              {!text && busy && (
                <div>
                  <Shimmer width="90%" height={13} />
                  <div style={{ height: 10 }} />
                  <Shimmer width="65%" height={13} />
                </div>
              )}
              {text && <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                <div style={{ width: 3, height: 3, borderRadius: "50%", background: C.accent, flexShrink: 0 }}/>
                <span style={{ fontFamily: mono, fontSize:11, color: C.dim, letterSpacing: "0.06em" }}>
                  Chat with your data —
                </span>
                <button onClick={() => window.location.href = "/upgrade"} style={{
                  background: "none", border: "none", padding: 0, cursor: "pointer",
                  fontFamily: mono, fontSize:11, color: C.accent, letterSpacing: "0.06em",
                  textDecoration: "underline", textUnderlineOffset: 3,
                }}>upgrade to Premium</button>
              </div>}
            </div>
          ) : text ? (
            <div style={{ fontFamily: mono, fontSize:13, color: C.muted, lineHeight: 1.75, whiteSpace: "pre-line" }}>
              {text}
            </div>
          ) : busy ? (
            <div>
              <Shimmer width="90%" height={13} />
              <div style={{ height: 10 }} />
              <Shimmer width="72%" height={13} />
              <div style={{ height: 10 }} />
              <Shimmer width="50%" height={13} />
            </div>
          ) : null}
        </div>
      </div>
    </Widget>
  );
}

// ─── QuickAdd ─────────────────────────────────────────────────────────────────
// Floating entry bar. Type a command, hit enter. Shows a brief status
// notification (green = success, red = fail) that fades out automatically.
// No conversation history — pure data entry.
function ChatFloat({date, token, userId}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // {text, ok} | null
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const inputRef = useRef(null);
  const statusTimer = useRef(null);

  // Speech recognition
  useEffect(() => {
    const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (SR) {
      const r = new SR();
      r.continuous = false; r.interimResults = true; r.lang = "en-US";
      r.onresult = (e) => setInput(Array.from(e.results).map(r => r[0].transcript).join(""));
      r.onend = () => setListening(false);
      r.onerror = () => setListening(false);
      recognitionRef.current = r;
    }
    return () => recognitionRef.current?.abort();
  }, []);

  function showStatus(text, ok) {
    clearTimeout(statusTimer.current);
    setStatus({ text, ok });
    statusTimer.current = setTimeout(() => setStatus(null), ok ? 3000 : 5000);
  }

  function toggleMic() {
    if (listening) { recognitionRef.current?.stop(); setListening(false); }
    else { recognitionRef.current?.start(); setListening(true); }
  }

  async function send() {
    if (!input.trim() || busy) return;
    const userText = input.trim();
    setInput("");
    setBusy(true);
    setStatus(null);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch("/api/voice-action", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: userText, date, tz }),
      });
      const data = await res.json();
      if (data.ok && data.results?.length > 0) {
        window.dispatchEvent(new CustomEvent("lifeos:refresh", { detail: { types: data.results.map(r => r.type) } }));
        showStatus(data.summary || "Done", true);
      } else if (data.message) {
        // Declined gracefully — couldn't parse or unsupported
        showStatus(data.message, false);
      } else if (data.error) {
        showStatus(data.error, false);
      } else {
        showStatus("Not sure what to add — try being more specific", false);
      }
    } catch (e) {
      showStatus("Something went wrong", false);
    }
    setBusy(false);
  }

  const hasMic = !!recognitionRef.current;
  const glassBg = C.bg === "#0A0A0A"
    ? "rgba(22, 23, 26, 0.82)"
    : "rgba(239, 235, 228, 0.82)";

  return (
    <div style={{
      position: "fixed",
      bottom: "max(16px, env(safe-area-inset-bottom, 16px))",
      left: "50%",
      transform: "translateX(-50%)",
      width: "min(calc(100vw - 32px), 560px)",
      zIndex: 98,
      display: "flex",
      flexDirection: "column",
      gap: 6,
      pointerEvents: "none",
    }}>

      {/* Status notification */}
      {status && (
        <div style={{
          padding: "9px 16px",
          borderRadius: 12,
          background: status.ok ? `${C.green}18` : `${C.red}15`,
          border: `1px solid ${status.ok ? C.green : C.red}40`,
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          pointerEvents: "none",
          animation: "fadeInUp 0.18s ease",
        }}>
          <span style={{
            fontFamily: mono, fontSize: 12,
            color: status.ok ? C.green : C.red,
            lineHeight: 1.5,
          }}>
            {status.ok ? "✓ " : ""}{status.text}
          </span>
        </div>
      )}

      {/* Pill */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        background: glassBg,
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        borderRadius: 26,
        border: `1px solid ${C.border}`,
        boxShadow: "0 4px 24px rgba(0,0,0,0.22), 0 1px 0 rgba(255,255,255,0.04) inset",
        padding: "10px 10px 10px 18px",
        pointerEvents: "auto",
      }}>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") send(); }}
          placeholder={busy ? "Adding…" : "Add a note, task, meal, or activity…"}
          disabled={busy}
          style={{
            flex: 1, background: "transparent", border: "none", outline: "none",
            fontFamily: serif, fontSize: 16, color: C.text,
            padding: "2px 0", opacity: busy ? 0.5 : 1, lineHeight: 1.4,
          }}
        />

        {input.trim() ? (
          <button onClick={send} disabled={busy} style={{
            background: C.accent, border: "none", borderRadius: "50%",
            width: 32, height: 32, cursor: busy ? "default" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, opacity: busy ? 0.4 : 1, transition: "opacity 0.15s",
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5"/>
              <polyline points="5 12 12 5 19 12"/>
            </svg>
          </button>
        ) : hasMic ? (
          <button onClick={toggleMic} style={{
            background: listening ? `${C.red}22` : `${C.text}10`,
            border: "none", borderRadius: "50%",
            width: 32, height: 32, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, transition: "background 0.2s",
          }}>
            {listening ? (
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: C.red, boxShadow: `0 0 0 3px ${C.red}30`, animation: "pulse 1.2s ease-in-out infinite" }}/>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill={C.muted}>
                <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4z"/>
                <path d="M19 10a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V19H9a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-2.08A7 7 0 0 0 19 10z"/>
              </svg>
            )}
          </button>
        ) : null}
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
  if(!authReady) return (
    <div style={{background:C.bg,height:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <span style={{fontFamily:mono,fontSize:13,color:C.muted,letterSpacing:"0.2em"}}>loading…</span>
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
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes fadeInUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
      `}</style>

      <TopBar session={session} token={token} userId={userId} syncStatus={syncStatus} theme={theme} onThemeChange={setTheme} selected={selected}/>

      {mobile ? (
        /* ── MOBILE: single scrollable column ──────────────────────────── */
        <div style={{flex:1,overflowY:"auto",padding:8,paddingBottom:88,display:"flex",flexDirection:"column",gap:8}}>
          {/* Cal + Health */}
          <div>
            <CalStrip selected={selected} onSelect={setSelected}
              events={events} setEvents={setEvents} healthDots={healthDots}
              token={token}/>
          </div>
          <HealthStrip date={selected} token={token} userId={userId}
            onHealthChange={onHealthChange} onSyncStart={startSync} onSyncEnd={endSync}/>
          {/* Insights card — below health strip */}
          <InsightsCard date={selected} token={token} userId={userId} healthKey={`${selected}:${healthDots[selected]?.sleep||0}:${healthDots[selected]?.readiness||0}`}/>
          {/* Widgets stacked */}
          {[leftWidget,...rightWidgets].map(w=>(
            <div key={w.id} style={{height:260,flexShrink:0}}>
              <Widget label={w.label} color={w.color()}>
                <w.Comp date={selected} token={token} userId={userId}/>
              </Widget>
            </div>
          ))}
        </div>
      ) : (
        /* ── DESKTOP: scrollable content, no sidebar ────────────────────── */
        <div style={{flex:1,overflowY:"auto",padding:10,paddingBottom:88,display:"flex",flexDirection:"column",gap:8}}>

          {/* Calendar — full width */}
          <div style={{flexShrink:0}}>
            <CalStrip selected={selected} onSelect={setSelected}
              events={events} setEvents={setEvents} healthDots={healthDots}
              token={token}/>
          </div>

          {/* Health strip — full width */}
          <div style={{flexShrink:0}}>
            <HealthStrip date={selected} token={token} userId={userId}
              onHealthChange={onHealthChange} onSyncStart={startSync} onSyncEnd={endSync}/>
          </div>

          {/* Insights card — below health */}
          <InsightsCard date={selected} token={token} userId={userId} healthKey={`${selected}:${healthDots[selected]?.sleep||0}:${healthDots[selected]?.readiness||0}`}/>

          {/* Widgets — notes on left (wider), tasks+meals+activity on right */}
          <div style={{display:"flex",gap:8,alignItems:"stretch",height:480,flexShrink:0}}>
            <div style={{flex:"2 1 0",minWidth:0}}>
              <Widget label={leftWidget.label} color={leftWidget.color()}>
                <leftWidget.Comp date={selected} token={token} userId={userId}/>
              </Widget>
            </div>
            <div style={{flex:"1 1 0",minWidth:0,display:"flex",flexDirection:"column",gap:8}}>
              {rightWidgets.map(w=>(
                <div key={w.id} style={{flex:"1 1 0",minHeight:0,overflow:"hidden"}}>
                  <Widget label={w.label} color={w.color()}>
                    <w.Comp date={selected} token={token} userId={userId}/>
                  </Widget>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Floating chat pill — always visible, both mobile + desktop */}
      <ChatFloat date={selected} token={token} userId={userId}/>
    </div>
  );
}
