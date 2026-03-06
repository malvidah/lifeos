"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "../lib/supabase.js";


const THEMES = {
  dark: {
    // 3 depth levels: bg (page) < surface/card (bars+cards) < well (inset inputs)
    // Direction: bg is medium-dark, surface is lighter, well is darkest
    bg:"#141412",      surface:"#232220",   card:"#232220",
    well:"#1A1918",    border:"#2C2A28",    border2:"#383532",
    text:"#D8CEC2",    muted:"#9A9088",     dim:"#6A6258",
    accent:"#D08828",
    green:"#4A9A68",   blue:"#4878A8",
    purple:"#8860B8",  red:"#B04840",       orange:"#D08828",
    yellow:"#B88828",
    shadow:"0 1px 3px rgba(0,0,0,0.5),0 4px 16px rgba(0,0,0,0.3)",
    shadowSm:"0 1px 3px rgba(0,0,0,0.35)",
  },
  light: {
    // 3 depth levels: bg (page) < surface/card (bars+cards) < well (inset inputs)
    // Direction: bg slightly darker taupe, surface is the main cream, well is darkest
    bg:"#D4CCB8",      surface:"#EAE3D6",   card:"#EAE3D6",
    well:"#CBBFB0",    border:"#D4CCBE",    border2:"#BEB6A8",
    text:"#4A3C2E",    muted:"#887870",     dim:"#ACA49A",
    accent:"#B87018",
    green:"#38684A",   blue:"#386088",
    purple:"#604888",  red:"#843830",       orange:"#B87018",
    yellow:"#806818",
    shadow:"0 1px 2px rgba(36,24,12,0.08),0 3px 10px rgba(36,24,12,0.05)",
    shadowSm:"0 1px 2px rgba(36,24,12,0.06)",
  },
};
// C is set at render time via setTheme — default dark
let C = THEMES.dark;
const serif = "Georgia, 'Times New Roman', serif";
const mono  = "'SF Mono', 'Fira Code', ui-monospace, monospace";
const F     = { lg:18, md:15, sm:12 }; // 3 sizes only

// ─── Responsive hook ──────────────────────────────────────────────────────────
function useIsMobile() {
  const [mobile, setMobile] = useState(false); // always false on SSR
  useEffect(() => {
    let t;
    const fn = () => { clearTimeout(t); t = setTimeout(() => setMobile(window.innerWidth < 768), 150); };
    setMobile(window.innerWidth < 768); // immediate on mount, no debounce
    window.addEventListener("resize", fn);
    return () => { window.removeEventListener("resize", fn); clearTimeout(t); };
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

// ─── Global undo/redo history ────────────────────────────────────────────────
// Each entry: { label, undo: fn, redo: fn }
const HISTORY = { stack: [], cursor: -1 };
function pushHistory(entry) {
  // Drop any redo tail
  HISTORY.stack = HISTORY.stack.slice(0, HISTORY.cursor + 1);
  HISTORY.stack.push(entry);
  if (HISTORY.stack.length > 60) HISTORY.stack.shift();
  HISTORY.cursor = HISTORY.stack.length - 1;
}
function canUndo() { return HISTORY.cursor >= 0; }
function canRedo() { return HISTORY.cursor < HISTORY.stack.length - 1; }
async function doUndo() { if (canUndo()) { await HISTORY.stack[HISTORY.cursor].undo(); HISTORY.cursor--; } }
async function doRedo() { if (canRedo()) { HISTORY.cursor++; await HISTORY.stack[HISTORY.cursor].redo(); } }

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
    // Restore snapshot (from undo of AI entry)
    const restoreHandler = (e) => {
      if (e.detail?.keys?.includes(cacheKey)) {
        const restored = MEM[cacheKey];
        if (restored !== undefined) { live.current = restored; _set(restored); }
      }
    };
    window.addEventListener('lifeos:snapshot-restore', restoreHandler);
    return () => { window.removeEventListener('lifeos:refresh', handler); window.removeEventListener('lifeos:snapshot-restore', restoreHandler); };
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
    // Poll every 5min passively — only if no local dirty changes
    // (single-user app; visibility flush + beforeunload cover real-time needs)
    const poll = setInterval(() => {
      if (!DIRTY[cacheKey]) setRev(r => r + 1);
    }, 5 * 60 * 1000);
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

  const setValue = useCallback((u, {undoLabel, skipHistory} = {}) => {
    const prev = live.current;
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
    // Push undo entry for meaningful edits (not AI calorie estimates, not loading)
    if (!skipHistory && undoLabel) {
      pushHistory({
        label: undoLabel,
        undo: () => {
          live.current = prev; MEM[cacheKey] = prev; DIRTY[cacheKey] = true; _set(prev);
          clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => { dbSave(dateRef.current, type, prev, token); DIRTY[cacheKey] = false; }, 200);
        },
        redo: () => {
          live.current = next; MEM[cacheKey] = next; DIRTY[cacheKey] = true; _set(next);
          clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => { dbSave(dateRef.current, type, next, token); DIRTY[cacheKey] = false; }, 200);
        },
      });
    }
  }, [type, token, cacheKey]); // eslint-disable-line

  return { value, setValue, loaded };
}

// ─── useCollapse — localStorage-backed collapse state ────────────────────────
function useCollapse(key, defaultCollapsed=false) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return defaultCollapsed;
    const stored = localStorage.getItem(`collapse:${key}`);
    return stored !== null ? stored === "1" : defaultCollapsed;
  });
  const toggle = () => setCollapsed(v => {
    const next = !v;
    localStorage.setItem(`collapse:${key}`, next ? "1" : "0");
    return next;
  });
  return [collapsed, toggle];
}

// ─── ChevronBtn — small collapse toggle ──────────────────────────────────────
function ChevronBtn({collapsed, onToggle, style={}}) {
  return (
    <button onClick={onToggle} style={{
      background:"none",border:"none",cursor:"pointer",padding:"2px 4px",
      color:C.dim,display:"flex",alignItems:"center",justifyContent:"center",
      flexShrink:0,transition:"color 0.15s",...style,
    }}
      onMouseEnter={e=>e.currentTarget.style.color=C.muted}
      onMouseLeave={e=>e.currentTarget.style.color=C.dim}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        {collapsed
          ? <polyline points="6 9 12 15 18 9"/>
          : <polyline points="18 15 12 9 6 15"/>}
      </svg>
    </button>
  );
}

// ─── Ring ─────────────────────────────────────────────────────────────────────
function Ring({score,color,size=48}) {
  const r=(size-7)/2, circ=2*Math.PI*r;
  const val=parseFloat(score)||0;
  const pct=Math.min(val/100,1);
  // Bubble grows from r×0.5 at score 0 → r×1 at score 85, then stays full
  const bubbleR = score ? r * Math.min(0.5 + 0.5*(val/85), 1.0) : 0;
  return (
    <svg width={size} height={size} style={{flexShrink:0}}>
      {/* Pastel fill bubble — scales with score */}
      <circle cx={size/2} cy={size/2} r={bubbleR}
        fill={color+"28"}
        style={{transition:"r 0.5s cubic-bezier(.4,0,.2,1)"}}/>
      {/* Track ring */}
      <circle cx={size/2} cy={size/2} r={r} fill="none"
        stroke={color+"30"} strokeWidth={2.5}
        style={{transform:"rotate(-90deg)",transformOrigin:"50% 50%"}}/>
      {/* Progress arc */}
      <circle cx={size/2} cy={size/2} r={r} fill="none"
        stroke={color} strokeWidth={2.5} strokeLinecap="round"
        strokeDasharray={`${pct*circ} ${circ}`}
        style={{transform:"rotate(-90deg)",transformOrigin:"50% 50%",
          transition:"stroke-dasharray 0.5s cubic-bezier(.4,0,.2,1)"}}/>
      {/* Score label — color-tinted, not plain text */}
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central"
        style={{fill:score?color:C.dim,fontSize:F.sm,fontFamily:mono,
          letterSpacing:"-0.02em"}}>
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
function Widget({label,color,children,slim,collapsed,onToggle,headerRight}) {
  return (
    <div style={slim ? {} : {height:collapsed?"auto":"100%",display:"flex",flexDirection:"column"}}>
      <Card style={collapsed ? {height:"auto"} : {}}>
        <div style={{
          display:"flex",alignItems:"center",gap:8,padding:"11px 14px",
          borderBottom:collapsed?"none":`1px solid ${C.border}`,flexShrink:0,
          cursor:onToggle?"pointer":"default",
        }} onClick={onToggle}>
          {onToggle&&<ChevronBtn collapsed={collapsed} onToggle={e=>{e.stopPropagation();onToggle();}}/>}
          <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",
            textTransform:"uppercase",color:C.muted,flex:1}}>{label}</span>
          {!collapsed && headerRight}
        </div>
        {!collapsed&&(
          <div style={slim ? {padding:"14px 16px"} : {flex:1,overflow:"auto",padding:16,minHeight:0}}>{children}</div>
        )}
      </Card>
    </div>
  );
}

// ─── UserMenu ─────────────────────────────────────────────────────────────────
function InfoTip({text}) {
  const [show,setShow]=useState(false);
  const [above,setAbove]=useState(false);
  const btnRef=useRef(null);
  function handleShow(){
    if(btnRef.current){
      const rect=btnRef.current.getBoundingClientRect();
      setAbove(rect.top>160);
    }
    setShow(true);
  }
  return (
    <span style={{position:"relative",display:"inline-flex",alignItems:"center"}}>
      <button
        ref={btnRef}
        onMouseEnter={handleShow} onMouseLeave={()=>setShow(false)}
        onFocus={handleShow} onBlur={()=>setShow(false)}
        style={{
          width:14,height:14,borderRadius:"50%",border:`1px solid ${C.border2}`,
          background:"none",cursor:"pointer",padding:0,
          display:"flex",alignItems:"center",justifyContent:"center",
          color:C.dim,fontFamily:mono,fontSize:F.sm,lineHeight:1,flexShrink:0,
        }}
        aria-label="More info"
      >i</button>
      {show&&(
        <div style={{
          position:"absolute",
          ...(above
            ? {bottom:"calc(100% + 6px)"}
            : {top:"calc(100% + 6px)"}),
          right:"-4px",
          background:C.card,border:`1px solid ${C.border2}`,borderRadius:6,
          padding:"8px 10px",width:190,
          fontFamily:mono,fontSize:F.sm,color:C.muted,lineHeight:1.5,
          zIndex:500,boxShadow:C.shadow,pointerEvents:"none",
          whiteSpace:"normal",
        }}>
          {text}
        </div>
      )}
    </span>
  );
}

function IntegrationToggle({on, onOn, onOff, pending}) {
  const bg = on
    ? `rgba(196,168,130,0.15)`
    : pending
      ? `rgba(208,136,40,0.18)`
      : `rgba(155,107,58,0.08)`;
  const dot = on ? C.accent : pending ? C.accent : C.dim;
  const borderColor = pending ? `${C.accent}70` : C.border2;
  return (
    <button
      onClick={on ? onOff : onOn}
      style={{
        background: bg,
        border: `1px solid ${borderColor}`, borderRadius: 20, cursor: "pointer",
        padding: 3, display: "flex", alignItems: "center", width: 40, height: 22,
        justifyContent: on ? "flex-end" : "flex-start", flexShrink: 0,
        transition: "all 0.2s",
      }}>
      <div style={{width:14,height:14,borderRadius:"50%",background:dot,transition:"all 0.2s"}}/>
    </button>
  );
}

function IntegrationRow({label, subtitle, connected, onToggleOn, onToggleOff, children, pendingToggle}) {
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:8,paddingTop:1}}>
        <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",textTransform:"uppercase",color:C.muted,flexShrink:0}}>
          {label}
        </span>
        {children}
        <div style={{marginLeft:"auto",flexShrink:0}}>
          <IntegrationToggle on={connected} onOn={onToggleOn} onOff={onToggleOff} pending={pendingToggle}/>
        </div>
      </div>
      {subtitle && (
        <div style={{fontFamily:mono,fontSize:9,color:C.dim,letterSpacing:"0.03em",marginTop:3}}>
          — {subtitle}
        </div>
      )}
    </div>
  );
}

function UserMenu({session,token,userId,theme,onThemeChange}) {
  const [open,setOpen]=useState(false);
  const [ouraKey,setOuraKey]=useState("");
  const [ouraConnected,setOuraConnected]=useState(false);
  const [stravaConnected,setStravaConnected]=useState(false);
  const [appleHealthHasData,setAppleHealthHasData]=useState(false);
  const [claudeConnected,setClaudeConnected]=useState(false);
  const [syncing,setSyncing]=useState(null); // null | 'oura' | 'strava' | 'apple'
  const [resyncing, setResyncing]=useState(false); // local state for Score History resync
  const [urlCopied,setUrlCopied]=useState(false);
  const [planInfo,setPlanInfo]=useState(null); // null | { isPremium, insightCount }

  const ref=useRef(null);
  const user=session?.user;
  const initials=user?.user_metadata?.name?.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()||user?.email?.[0]?.toUpperCase()||"?";
  const avatar=user?.user_metadata?.avatar_url;
  const [isIOS, setIsIOS] = useState(false);
  useEffect(()=>{ setIsIOS(!!window.daylabNative); },[]);

  useEffect(()=>{
    if(!token||!open)return;
    dbLoad("global","settings",token).then(d=>{
      if(d?.ouraToken){setOuraKey(d.ouraToken);setOuraConnected(true);}
    }).catch(()=>{});
    // Fetch plan status
    const _sbPlan = createClient();
    Promise.all([
      _sbPlan.from('entries').select('data').eq('type','premium').eq('date','global').eq('user_id',userId).maybeSingle(),
      _sbPlan.from('entries').select('data').eq('type','insight_usage').eq('date','global').eq('user_id',userId).maybeSingle(),
    ]).then(([premRow, usageRow]) => {
      setPlanInfo({
        isPremium: premRow.data?.data?.active === true,
        insightCount: usageRow.data?.data?.count || 0,
        plan: premRow.data?.data?.plan || null,
      });
    }).catch(()=>{});
    fetch("/api/entries?date=0000-00-00&type=strava_token",{headers:{Authorization:`Bearer ${token}`}})
      .then(r=>r.json()).then(d=>{if(d?.data?.access_token)setStravaConnected(true);}).catch(()=>{});
    // Check Apple Health data + Claude MCP connection (use singleton — no new GoTrueClient)
    const _sb = createClient();
    _sb.from("entries").select("data").eq("type","health_apple").limit(5)
      .then(({data})=>{
        const hasReal = data?.some(r => r.data && Object.keys(r.data).some(k=>r.data[k]));
        if(hasReal) setAppleHealthHasData(true);
      }).catch(()=>{});
    Promise.all([
      _sb.from("entries").select("date").eq("type","oauth_token").limit(1),
      _sb.from("entries").select("date").eq("type","agent_token").eq("date","global").limit(1),
    ]).then(([oauth, agent])=>{
      if(oauth.data?.length || agent.data?.length) setClaudeConnected(true);
    }).catch(()=>{});
  },[token,open]); // eslint-disable-line
  useEffect(()=>{
    if(!open)return;
    const fn=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};
    document.addEventListener("mousedown",fn);
    return ()=>document.removeEventListener("mousedown",fn);
  },[open]);

  const row={padding:"0 16px"};
  const divider=<div style={{height:1,background:C.border,margin:"10px 0"}}/>;
  const FREE_LIMIT = 10;
  const planBadge = planInfo === null ? null : planInfo.isPremium ? (
    <div style={{margin:"0 12px 10px",borderRadius:6,border:`1px solid ${C.accent}30`,overflow:"hidden"}}>
      <div style={{padding:"10px 12px",textAlign:"center"}}>
        <div style={{fontFamily:mono,fontSize:F.sm,color:C.accent,letterSpacing:"0.06em",textTransform:"uppercase"}}>Premium ✦</div>
        <div style={{fontFamily:mono,fontSize:"10px",color:C.muted,marginTop:3}}>{planInfo.plan === 'yearly' ? 'Annual plan · $4/mo' : 'Monthly plan · $5/mo'}</div>
      </div>
      <button onClick={()=>window.location.href="/upgrade"} style={{width:"100%",padding:"7px 12px",background:"none",borderTop:`1px solid ${C.accent}20`,border:"none",cursor:"pointer",fontFamily:mono,fontSize:"10px",color:C.muted,letterSpacing:"0.08em",textTransform:"uppercase",textAlign:"center"}}>
        Manage Plan →
      </button>
    </div>
  ) : (
    <div style={{margin:"0 12px 10px",borderRadius:6,border:`1px solid ${C.border}`,overflow:"hidden"}}>
      <div style={{padding:"8px 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={{fontFamily:mono,fontSize:F.sm,color:C.muted,letterSpacing:"0.06em",textTransform:"uppercase"}}>Free plan</div>
          <div style={{fontFamily:mono,fontSize:"10px",color:C.dim,marginTop:2}}>{planInfo.insightCount}/{FREE_LIMIT} AI insights used</div>
        </div>
        <div style={{width:32,height:32,position:"relative"}}>
          <svg viewBox="0 0 32 32" style={{width:32,height:32,transform:"rotate(-90deg)"}}>
            <circle cx="16" cy="16" r="12" fill="none" stroke={C.border} strokeWidth="3"/>
            <circle cx="16" cy="16" r="12" fill="none" stroke={C.accent} strokeWidth="3"
              strokeDasharray={`${Math.min(planInfo.insightCount/FREE_LIMIT,1)*75.4} 75.4`}
              strokeLinecap="round"/>
          </svg>
        </div>
      </div>
      <button onClick={()=>window.location.href="/upgrade"} style={{width:"100%",padding:"8px 12px",background:C.accent,border:"none",cursor:"pointer",fontFamily:mono,fontSize:"10px",color:C.bg,letterSpacing:"0.1em",textTransform:"uppercase",textAlign:"center"}}>
        Upgrade to Premium →
      </button>
    </div>
  );
  const connBtn = (color=C.green) => ({width:"100%",padding:"7px",textAlign:"center",boxSizing:"border-box",background:"none",border:`1px solid ${color}`,borderRadius:5,color:color,fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",textTransform:"uppercase",cursor:"pointer"});
  // Use the module-level singleton — avoids spawning new GoTrueClient instances

  async function connectOura() {
    if(!ouraKey.trim()) return;
    setSyncing("oura");
    try {
      // Save token
      await fetch("/api/entries",{method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
        body:JSON.stringify({date:"global",type:"settings",data:{ouraToken:ouraKey.trim()}})});
      setOuraConnected(true);
      // Backfill history
      const res = await fetch("/api/oura-backfill",{method:"POST",
        headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({})});
      const d = await res.json();
      if(!d.ok) console.warn("Oura backfill error:", d.error);
      // Also recompute all scores from the fresh data
      fetch('/api/scores-backfill', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      }).catch(() => {});
    } catch(e) { console.warn("Oura connect failed:", e); }
    setSyncing(null);
  }

  async function disconnectOura() {
    if(!confirm("Disconnect Oura? Your synced health data will remain.")) return;
    const sb = createClient();
    const {data:s} = await sb.from("entries").select("data").eq("type","settings").eq("date","global").eq("user_id",userId).maybeSingle();
    const updated = {...(s?.data||{})}; delete updated.ouraToken;
    await sb.from("entries").upsert({user_id:userId,date:"global",type:"settings",data:updated,updated_at:new Date().toISOString()},{onConflict:"user_id,date,type"});
    setOuraConnected(false); setOuraKey("");
  }

  async function connectAppleHealth() {
    const tok = token||localStorage.getItem("daylab:token")||"";
    if(window.webkit?.messageHandlers?.daylabRequestHealthKit) {
      window.webkit.messageHandlers.daylabRequestHealthKit.postMessage({token:tok});
      // After HealthKit permission, poll for real data appearing
      setSyncing("apple");
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        const sb = createClient();
        const {data} = await sb.from("entries").select("data").eq("type","health_apple").limit(5);
        const hasReal = data?.some(r=>r.data&&Object.keys(r.data).some(k=>r.data[k]));
        if(hasReal || attempts > 20) {
          clearInterval(poll);
          if(hasReal) setAppleHealthHasData(true);
          setSyncing(null);
        }
      }, 3000);
    }
  }

  async function disconnectAppleHealth() {
    if(!confirm("Disconnect Apple Health? Your synced health data will remain.")) return;
    const sb = createClient();
    await sb.from("entries").delete().eq("type","health_apple").eq("user_id",userId);
    setAppleHealthHasData(false);
  }

  async function connectStrava() {
    window.location.href="/api/strava-connect";
  }

  async function disconnectStrava() {
    if(!confirm("Disconnect Strava? Your synced activity data will remain.")) return;
    const sb = createClient();
    await sb.from("entries").delete().eq("type","strava_token").eq("user_id",userId);
    setStravaConnected(false);
  }

  return (
    <div ref={ref} style={{position:"relative"}}>
      <button onClick={()=>setOpen(o=>!o)} style={{
        width:32,height:32,borderRadius:"50%",padding:0,cursor:"pointer",
        border:`1.5px solid ${C.border2}`,background:avatar?"transparent":C.surface,
        overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center"}}>
        {avatar?<img src={avatar} width={32} height={32} style={{objectFit:"cover"}} alt=""/>
          :<span style={{fontFamily:mono,fontSize:F.sm,color:C.muted}}>{initials}</span>}
      </button>

      {open&&(
        <div style={{
          position:"absolute",top:40,right:0,width:272,zIndex:300,
          background:C.card,border:`1px solid ${C.border2}`,borderRadius:R,
          padding:"14px 0",display:"flex",flexDirection:"column",
          boxShadow:C.shadow,overflowY:"auto",maxHeight:"85vh",
        }}>

          {/* Identity */}
          <div style={{...row,paddingBottom:2}}>
            <div style={{fontFamily:serif,fontSize:F.md,color:C.text}}>{user?.user_metadata?.name||"—"}</div>
            <div style={{fontFamily:mono,fontSize:F.sm,color:C.dim,marginTop:2}}>{user?.email}</div>
          </div>
          {divider}
          {planBadge}

          {divider}

          {/* Apple Health */}
          <div style={row}>
            <IntegrationRow
              label="Apple Health"
              subtitle={!isIOS && !appleHealthHasData ? "iOS App Required" : syncing==="apple" ? "Syncing…" : null}
              connected={appleHealthHasData}
              onToggleOn={isIOS ? connectAppleHealth : ()=>{}}
              onToggleOff={disconnectAppleHealth}
            />
          </div>

          {divider}

          {/* Oura */}
          <div style={row}>
            <IntegrationRow
              label="Oura"
              subtitle={syncing==="oura" ? "Syncing history…" : null}
              connected={ouraConnected}
              onToggleOn={ouraKey.trim() ? connectOura : ()=>window.open("https://cloud.ouraring.com/personal-access-tokens","_blank")}
              onToggleOff={disconnectOura}
              pendingToggle={!ouraConnected && !!ouraKey.trim()}
            >
              {!ouraConnected && (
                <input type="password" value={ouraKey}
                  onChange={e=>setOuraKey(e.target.value)}
                  placeholder="Token"
                  className="oura-token-input"
                  style={{flex:1,minWidth:0,background:C.surface,border:`1px solid ${C.border2}`,
                    borderRadius:5,outline:"none",color:C.text,fontFamily:mono,fontSize:F.sm,
                    padding:"5px 7px",boxSizing:"border-box",width:0}}/>
              )}
            </IntegrationRow>
          </div>

          {divider}

          {/* Strava */}
          <div style={row}>
            <IntegrationRow
              label="Strava"
              subtitle={syncing==="strava" ? "Syncing history…" : null}
              connected={stravaConnected}
              onToggleOn={connectStrava}
              onToggleOff={disconnectStrava}
            />
          </div>

          {divider}

          {/* Claude */}          <div style={row}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
              <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",textTransform:"uppercase",color:C.muted}}>
                Claude MCP
              </span>
              {!claudeConnected && (
                <a href="https://claude.ai/settings/connectors?modal=add-custom-connector"
                  target="_blank" rel="noreferrer"
                  style={{fontFamily:mono,fontSize:F.sm,color:C.dim,textDecoration:"none",letterSpacing:"0.02em"}}>
                  add →
                </a>
              )}
              {claudeConnected && (
                <span style={{fontFamily:mono,fontSize:F.sm,color:C.green}}>✓</span>
              )}
            </div>
            <div style={{
              display:"flex",alignItems:"center",gap:6,
              background:C.surface,border:`1px solid ${C.border2}`,
              borderRadius:5,padding:"6px 8px",
            }}>
              <span style={{flex:1,fontFamily:mono,fontSize:F.sm,
                userSelect:"all",letterSpacing:"0.02em",overflow:"hidden",
                textOverflow:"ellipsis",whiteSpace:"nowrap",color:C.muted}}>
                {window.location.origin}/mcp
              </span>
              <button
                onClick={()=>{
                  navigator.clipboard.writeText(window.location.origin + "/mcp");
                  setUrlCopied(true);setTimeout(()=>setUrlCopied(false),2000);
                }}
                title="Copy URL"
                style={{background:"none",border:"none",cursor:"pointer",
                  color:urlCopied?C.green:C.dim,padding:0,flexShrink:0,
                  display:"flex",alignItems:"center",lineHeight:1}}>
                {urlCopied
                  ? <span style={{fontSize:11}}>✓</span>
                  : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                }
              </button>
            </div>
          </div>

          {divider}

          {/* Theme */}
          <div style={{...row,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:'0.04em',textTransform:'uppercase',color:C.muted}}>
              {theme==="dark"?"Dark":"Light"} Mode
            </span>
            <button onClick={()=>onThemeChange(t=>t==="dark"?"light":"dark")}
              style={{
                background:theme==="dark"?"rgba(196,168,130,0.15)":"rgba(155,107,58,0.12)",
                border:`1px solid ${C.border2}`,borderRadius:20,cursor:"pointer",
                padding:3,display:"flex",alignItems:"center",width:40,height:22,
                justifyContent:theme==="dark"?"flex-end":"flex-start"}}>
              <div style={{width:14,height:14,borderRadius:"50%",background:C.accent,transition:"all 0.2s"}}/>
            </button>
          </div>

          {divider}

          {/* Downloads — label + small buttons inline */}
          <div style={{...row,display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",textTransform:"uppercase",color:C.muted,flex:1}}>
              Downloads
            </span>
            <a href="/download/mac" style={{
              display:"flex",alignItems:"center",gap:4,
              padding:"4px 9px",background:C.surface,
              border:`1px solid ${C.border2}`,borderRadius:5,textDecoration:"none",
              color:C.muted,fontFamily:mono,fontSize:9,letterSpacing:"0.06em",textTransform:"uppercase",flexShrink:0}}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Mac
            </a>
            <a href="/download/ios" style={{
              display:"flex",alignItems:"center",gap:4,
              padding:"4px 9px",background:C.surface,
              border:`1px solid ${C.border2}`,borderRadius:5,textDecoration:"none",
              color:C.muted,fontFamily:mono,fontSize:9,letterSpacing:"0.06em",textTransform:"uppercase",flexShrink:0}}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12" y2="18"/>
              </svg>
              iOS
            </a>
          </div>

          {divider}

          <div style={{...row,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <a href="/about"
              style={{background:"none",border:"none",padding:0,cursor:"pointer",
                color:C.dim,fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",
                textTransform:"uppercase",textDecoration:"none"}}>
              Learn More
            </a>
            <button onClick={async()=>{const s=createClient();await s.auth.signOut();}}
              style={{background:"none",border:"none",padding:0,cursor:"pointer",
                color:C.dim,fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",textTransform:"uppercase"}}>
              Sign Out →
            </button>
          </div>

        </div>
      )}
    </div>
  );
}

// ─── TopBar ───────────────────────────────────────────────────────────────────
function TopBar({session,token,userId,syncStatus,theme,onThemeChange,selected,onGoToToday}) {
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
  const isElectron = typeof window !== "undefined" && (!!window.daylabNative || !!window.dayloopNative);
  return (
    <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,
      padding:"0 16px",
      paddingTop: "env(safe-area-inset-top, 0px)",
      height: "calc(44px + env(safe-area-inset-top, 0px))",
      display:"flex",alignItems:"flex-end",gap:12,flexShrink:0,
      paddingBottom: 6,
      position:"sticky",top:0,zIndex:100,
      WebkitAppRegion:"drag",userSelect:"none"}}>
      {/* Extend topbar color behind pull-down overscroll area */}
      <div style={{position:"fixed",top:"-100px",left:0,right:0,height:"100px",background:C.surface,zIndex:99}}/>
      {/* Left spacer on desktop so date centers properly */}
      <div style={{flex:1,display:"flex",alignItems:"baseline",gap:7,
        justifyContent:"flex-start",visibility:"hidden",pointerEvents:"none",
        "@media(maxWidth:768px)":{display:"none"}}}>
        <span style={{fontFamily:mono,fontSize:F.md}}>●</span>
        <div style={{width:70}}/>
      </div>
      {/* Day Loop — centered */}
      <div style={{position:"absolute",left:"50%",transform:"translateX(-50%)"}}>
        <span onClick={onGoToToday} style={{
          fontFamily:serif,fontSize:F.md,letterSpacing:"-0.02em",
          color:C.text, cursor:onGoToToday?"pointer":"default",
        }}>Day Lab</span>
      </div>
      <div style={{flex:1}}/>
      <div style={{WebkitAppRegion:"no-drag"}}>
        <UserMenu session={session} token={token} userId={userId} theme={theme} onThemeChange={onThemeChange}/>
      </div>
    </div>
  );
}

// ─── MonthView ────────────────────────────────────────────────────────────────
// Only truly special events belong on the month grid — not meals or daily tasks
const BIG_EVENT_KEYWORDS = /birthday|bday|anniversary|wedding|graduation|party|trip|camping|hike|concert|festival|game.?night|board.?game|vacation|holiday|travel|flight|conference|retreat|summit|christm|thanksgiv|new.?year|halloween|passover|hanukkah|diwali|eid|week.?off|day.?off|surgery|date.?night|show|performance|recital|marathon|race|gala|ceremony|opening.?night|potluck|picnic|reunion|sleepover|road.?trip/i;

function isBigEvent(ev) {
  if (!ev) return false;
  if (ev.allDay || ev.time === 'all day') return true;
  return BIG_EVENT_KEYWORDS.test(ev.title || '');
}

function MonthView({ initYear, initMonth, selected, onSelectDay, onMonthChange, healthDots, events, token }) {
  const [summaries,    setSummaries]    = useState({});
  const [summaryCache, setSummaryCache] = useState({});

  // ── Physics ────────────────────────────────────────────────────────────
  // liveOff = fractional month index (year*12 + month)
  const liveOff    = useRef(initYear * 12 + initMonth);
  const vel        = useRef(0);
  const rafId      = useRef(null);
  const dragBase   = useRef(0);
  const startY     = useRef(0);
  const lastY      = useRef(0);
  const touchVel   = useRef(0);
  const totalDrag  = useRef(0);
  const isDragging = useRef(false);
  const containerRef = useRef(null);
  const [displayOff, setDisplayOff] = useState(initYear * 12 + initMonth);

  // Responsive sizing — derive CELL_H from available height so months pack tight
  // SSR-safe: start at 1200 to avoid hydration mismatch; real value set after mount
  const [vw, setVw] = useState(1200);
  useEffect(()=>{
    setVw(window.innerWidth); // sync on first client render
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener('resize', onResize);
    return ()=>window.removeEventListener('resize', onResize);
  },[]);
  const DAY_HDR_H_C = 20;
  const LABEL_H   = 18;
  const MONTH_H   = vw < 600 ? 340 : 400;
  const SCROLL_H_C = MONTH_H - DAY_HDR_H_C;
  const CELL_H    = Math.floor((SCROLL_H_C - LABEL_H - 5 * 2) / 6); // 5 gaps of 2px between 6 rows

  // Use refs for callbacks so mount-only listeners always see fresh values
  const repaint    = useRef(null);
  const cancelRaf  = useRef(null);
  const snapTo     = useRef(null);
  const doMomentum = useRef(null);
  const animateTo  = useRef(null);

  repaint.current = () => setDisplayOff(liveOff.current);

  cancelRaf.current = () => {
    if (rafId.current) { cancelAnimationFrame(rafId.current); rafId.current = null; }
  };

  snapTo.current = (target) => {
    cancelRaf.current();
    liveOff.current = target;
    vel.current = 0;
    repaint.current();
    const yr = Math.floor(target / 12);
    const mo = ((target % 12) + 12) % 12;
    onMonthChange(yr, mo);
  };

  doMomentum.current = () => {
    cancelRaf.current();
    const step = () => {
      vel.current *= 0.88;          // gentle friction — long, smooth coast
      liveOff.current += vel.current;
      const target = Math.round(liveOff.current * 4) / 4; // snap to nearest week (~0.25 month)
      liveOff.current += (target - liveOff.current) * 0.08; // soft spring
      if (Math.abs(vel.current) < 0.0008 && Math.abs(liveOff.current - target) < 0.0008) {
        snapTo.current(target); return;
      }
      repaint.current();
      rafId.current = requestAnimationFrame(step);
    };
    rafId.current = requestAnimationFrame(step);
  };

  animateTo.current = (target) => {
    cancelRaf.current();
    const step = () => {
      const diff = target - liveOff.current;
      if (Math.abs(diff) < 0.001) { snapTo.current(target); return; }
      liveOff.current += diff * 0.12; // softer spring — feels like settling
      repaint.current();
      rafId.current = requestAnimationFrame(step);
    };
    rafId.current = requestAnimationFrame(step);
  };

  useEffect(() => () => cancelRaf.current(), []);

  // Sync when parent changes month (e.g. selecting a date)
  useEffect(() => {
    const target = initYear * 12 + initMonth;
    if (Math.abs(liveOff.current - target) > 0.5) animateTo.current(target);
  }, [initYear, initMonth]); // eslint-disable-line

  // ── Mount-only global listeners (refs keep them fresh) ─────────────────
  useEffect(() => {
    const onMouseMove = (e) => {
      if (!isDragging.current) return;
      const dy = e.clientY - startY.current;
      totalDrag.current = Math.abs(dy);
      // drag DOWN = past (lower liveOff), drag UP = future (higher liveOff)
      liveOff.current = dragBase.current - dy / MONTH_H;
      touchVel.current = -(e.clientY - lastY.current) / MONTH_H;
      lastY.current = e.clientY;
      repaint.current();
    };
    const onMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      vel.current = touchVel.current * 2.0;
      if (Math.abs(vel.current) > 0.008) doMomentum.current();
      else snapTo.current(Math.round(liveOff.current * 4) / 4);
    };
    let wheelTimer = null;
    const onWheel = (e) => {
      if (!containerRef.current?.contains(e.target)) return;
      e.preventDefault();
      cancelRaf.current();
      isDragging.current = false;
      // scroll DOWN = future (deltaY positive → increase liveOff)
      const delta = e.deltaY / (Math.abs(e.deltaY) > 50 ? 600 : 130);
      liveOff.current += delta;
      repaint.current();
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => snapTo.current(Math.round(liveOff.current * 4) / 4), 200);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',   onMouseUp);
    window.addEventListener('wheel',     onWheel, { passive: false });
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',   onMouseUp);
      window.removeEventListener('wheel',     onWheel);
      if (wheelTimer) clearTimeout(wheelTimer);
    };
  }, []); // mount only

  // Touch handlers via JSX
  const handleTouchStart = (e) => {
    cancelRaf.current();
    isDragging.current = true;
    totalDrag.current  = 0;
    startY.current     = e.touches[0].clientY;
    lastY.current      = e.touches[0].clientY;
    dragBase.current   = liveOff.current;
    touchVel.current   = 0;
  };
  const handleTouchMove = (e) => {
    if (!isDragging.current) return;
    e.preventDefault();
    const y  = e.touches[0].clientY;
    const dy = y - startY.current;
    totalDrag.current  = Math.abs(dy);
    liveOff.current    = dragBase.current - dy / MONTH_H; // up=future, down=past
    touchVel.current   = -(y - lastY.current) / MONTH_H;
    lastY.current      = y;
    repaint.current();
  };
  const handleTouchEnd = () => {
    if (!isDragging.current) return;
    isDragging.current = false;
    vel.current = touchVel.current * 2.0;
    if (Math.abs(vel.current) > 0.008) doMomentum.current();
    else snapTo.current(Math.round(liveOff.current * 4) / 4);
  };
  const handleMouseDown = (e) => {
    e.preventDefault();
    cancelRaf.current();
    isDragging.current = true;
    totalDrag.current  = 0;
    startY.current     = e.clientY;
    lastY.current      = e.clientY;
    dragBase.current   = liveOff.current;
    touchVel.current   = 0;
  };

  // ── Load AI summaries ──────────────────────────────────────────────────
  const snappedIdx = Math.round(displayOff);

  useEffect(() => {
    if (!token) return;
    [-1, 0, 1].forEach(offset => {
      const idx = snappedIdx + offset;
      const yr  = Math.floor(idx / 12);
      const mo  = ((idx % 12) + 12) % 12;
      const key = `${yr}-${mo}`;
      if (summaryCache[key] !== undefined) return;
      setSummaryCache(prev => ({ ...prev, [key]: null }));
      fetch('/api/month-summaries', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: yr, month: mo }),
      }).then(r => r.json()).then(d => {
        if (d.summaries) setSummaries(prev => ({ ...prev, ...d.summaries }));
        setSummaryCache(prev => ({ ...prev, [key]: true }));
      }).catch(() => {});
    });
  }, [snappedIdx, token]); // eslint-disable-line

  // ── Helpers ────────────────────────────────────────────────────────────
  const today = todayKey();
  const DAY_NAMES   = ['S','M','T','W','R','F','S']; // R=Thu to distinguish from T=Tue
  const MONTH_NAMES = ["January","February","March","April","May","June",
                       "July","August","September","October","November","December"];
  const fracOff = displayOff - snappedIdx;
  const N = 2;

  // Build a 42-cell (6-row) continuous grid for a given year/month.
  // Cells before day 1 come from the previous month; cells after the last day
  // come from the next month. Each cell: { day, dateKey, isOverflow }.
  function buildGrid(yr, mo) {
    const firstDow   = new Date(yr, mo, 1).getDay();
    const daysInMonth = new Date(yr, mo + 1, 0).getDate();

    // prev month overflow
    const prevDate   = new Date(yr, mo, 0); // last day of prev month
    const prevDays   = prevDate.getDate();
    const prevMo     = prevDate.getMonth();
    const prevYr     = prevDate.getFullYear();

    // next month
    const nextDate   = new Date(yr, mo + 1, 1);
    const nextMo     = nextDate.getMonth();
    const nextYr     = nextDate.getFullYear();

    const cells = [];
    // leading overflow from previous month
    for (let i = firstDow - 1; i >= 0; i--) {
      const d   = prevDays - i;
      const key = `${prevYr}-${String(prevMo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      cells.push({ day: d, dateKey: key, isOverflow: true });
    }
    // current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${yr}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      cells.push({ day: d, dateKey: key, isOverflow: false });
    }
    // trailing overflow to next month — fill to 42 cells (6 rows)
    let nextDay = 1;
    while (cells.length < 42) {
      const key = `${nextYr}-${String(nextMo+1).padStart(2,'0')}-${String(nextDay).padStart(2,'0')}`;
      cells.push({ day: nextDay, dateKey: key, isOverflow: true });
      nextDay++;
    }
    return cells;
  }

  // ── Year scrubber state ───────────────────────────────────────────────
  const SCRUB_MIN_YR = 2020;
  const SCRUB_MAX_YR = 2030;
  const SCRUB_RANGE  = SCRUB_MAX_YR - SCRUB_MIN_YR; // 10 years
  const [scrubHover, setScrubHover] = useState(false);
  const [scrubDragging, setScrubDragging] = useState(false);
  const scrubRef = useRef(null);

  const currentYr = Math.floor(snappedIdx / 12);
  const currentMo = ((snappedIdx % 12) + 12) % 12;
  const thumbPct  = Math.max(0, Math.min(1, (currentYr - SCRUB_MIN_YR) / SCRUB_RANGE));

  const scrubJumpToY = (clientY) => {
    if (!scrubRef.current) return;
    const rect = scrubRef.current.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const yr   = Math.round(SCRUB_MIN_YR + pct * SCRUB_RANGE);
    animateTo.current(yr * 12 + currentMo);
  };

  useEffect(() => {
    if (!scrubDragging) return;
    const onMove = (e) => scrubJumpToY(e.touches ? e.touches[0].clientY : e.clientY);
    const onUp   = () => setScrubDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend',  onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend',  onUp);
    };
  }, [scrubDragging]); // eslint-disable-line

  const SCRUB_W    = vw < 600 ? 12 : 18; // narrower on mobile
  const DAY_HDR_H  = DAY_HDR_H_C;
  const SCROLL_H   = SCROLL_H_C;

  return (
    <div style={{ userSelect: 'none', touchAction: 'none' }}>

      {/* ── Fixed top row: scrubber gap + S M T W R F S ── */}
      <div style={{ display: 'flex', alignItems: 'center', height: DAY_HDR_H }}>
        {/* spacer matching scrubber width */}
        <div style={{ width: SCRUB_W, flexShrink: 0 }} />
        {/* day-of-week labels — never scroll */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
                      paddingRight: 4 }}>
          {DAY_NAMES.map((n, i) => (
            <div key={i} style={{
              textAlign: 'center', fontFamily: mono, fontSize: '10px',
              fontWeight: '500', letterSpacing: '0.08em', color: C.muted,
            }}>{n}</div>
          ))}
        </div>
      </div>

      {/* ── Scrollable area: scrubber + calendar pane side by side ── */}
      <div style={{ display: 'flex', height: SCROLL_H, overflow: 'hidden', position: 'relative' }}>

        {/* Year scrubber */}
        <div
          ref={scrubRef}
          onMouseEnter={() => setScrubHover(true)}
          onMouseLeave={() => setScrubHover(false)}
          onMouseDown={e => { e.stopPropagation(); setScrubDragging(true); scrubJumpToY(e.clientY); }}
          onTouchStart={e => { e.stopPropagation(); setScrubDragging(true); scrubJumpToY(e.touches[0].clientY); }}
          style={{
            width: SCRUB_W, flexShrink: 0, position: 'relative',
            cursor: 'ns-resize', display: 'flex', justifyContent: 'center',
            paddingTop: 4, paddingBottom: 4, boxSizing: 'border-box',
          }}
        >
          <div style={{
            width: 1, height: '100%',
            background: scrubHover || scrubDragging ? C.border2 : C.border,
            borderRadius: 1, transition: 'background 0.2s', position: 'relative',
          }}>
            <div style={{
              position: 'absolute', left: '50%', transform: 'translate(-50%, -50%)',
              top: `${thumbPct * 100}%`,
              width: scrubHover || scrubDragging ? 5 : 3,
              height: scrubHover || scrubDragging ? 20 : 14,
              borderRadius: 3,
              background: scrubHover || scrubDragging ? C.accent : C.muted,
              transition: 'width 0.15s, height 0.15s, background 0.15s',
            }} />
          </div>
          {(scrubHover || scrubDragging) && (
            <div style={{
              position: 'absolute', left: 20, top: `calc(${thumbPct * 100}% - 8px)`,
              fontFamily: mono, fontSize: '8px', letterSpacing: '0.08em',
              color: C.accent, whiteSpace: 'nowrap', pointerEvents: 'none',
              background: C.bg, padding: '1px 3px', borderRadius: 2,
            }}>{currentYr}</div>
          )}
        </div>

        {/* Main scrollable calendar pane */}
        <div
          ref={containerRef}
          style={{ flex: 1, overflow: 'hidden', position: 'relative',
                   cursor: isDragging.current ? 'grabbing' : 'grab' }}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {Array.from({ length: N * 2 + 1 }, (_, i) => i - N).map(relOffset => {
            const mIdx = snappedIdx + relOffset;
            const yr   = Math.floor(mIdx / 12);
            const mo   = ((mIdx % 12) + 12) % 12;
            const translateY = (relOffset - fracOff) * SCROLL_H;
            const cells = buildGrid(yr, mo);

            return (
              <div key={mIdx} style={{
                position: 'absolute', top: 0, left: 0, right: 0,
                transform: `translateY(${translateY}px)`,
                willChange: 'transform', height: SCROLL_H,
                padding: '0 4px 4px 4px', boxSizing: 'border-box',
                display: 'flex', flexDirection: 'column',
              }}>
                {/* Month name */}
                <div style={{
                  fontFamily: mono, fontSize: F.sm, fontWeight: 'normal',
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                  color: C.muted, marginTop: 2, marginBottom: 4, flexShrink: 0,
                  paddingLeft: 2, overflow: 'hidden', whiteSpace: 'nowrap',
                }}>{MONTH_NAMES[mo]}</div>

                {/* 6-row grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridTemplateRows: `repeat(6, ${CELL_H}px)`, gap: 2, flex: 1 }}>
                  {cells.map(({ day, dateKey, isOverflow }, idx) => {
                    // Overflow cells are invisible spacers — no content, no border
                    if (isOverflow) return <div key={`sp-${idx}`} style={{ height: CELL_H }} />;

                    const isToday    = dateKey === today;
                    const isSelected = dateKey === selected;
                    const dots       = dateKey <= today ? (healthDots[dateKey] || {}) : {};
                    const summary    = summaries[dateKey];
                    const bigEvents  = (events[dateKey] || []).filter(isBigEvent).slice(0, 2);
                    const hasDots    = dots.sleep >= 85 || dots.readiness >= 85 ||
                                       dots.activity >= 85 || dots.recovery >= 85;

                    return (
                      <div key={dateKey}
                        onClick={e => { e.stopPropagation(); if (totalDrag.current < 6) onSelectDay(dateKey); }}
                        style={{
                          height: CELL_H, overflow: 'hidden', borderRadius: 5, padding: '4px 4px 3px',
                          cursor: 'pointer', boxSizing: 'border-box',
                          background: isSelected ? C.accent+'1A' : isToday ? C.accent+'0D' : 'transparent',
                          border: `1px solid ${isSelected ? C.accent+'66' : isToday ? C.accent+'33' : C.border+'25'}`,
                          display: 'flex', flexDirection: 'column', gap: 2,
                        }}
                      >
                        {/* Day number */}
                        <div style={{
                          fontFamily: serif, fontSize: '13px', lineHeight: 1,
                          fontWeight: isToday || isSelected ? '700' : 'normal',
                          color: isToday ? C.text : isSelected ? C.accent : C.muted,
                          flexShrink: 0,
                        }}>{day}</div>

                        {/* Health dots */}
                        {hasDots && (
                          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                            {dots.sleep     >= 85 && <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.blue,    flexShrink: 0 }} />}
                            {dots.readiness >= 85 && <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.green,   flexShrink: 0 }} />}
                            {dots.activity  >= 85 && <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.accent,  flexShrink: 0 }} />}
                            {dots.recovery  >= 85 && <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#8B6BB5', flexShrink: 0 }} />}
                          </div>
                        )}

                        {/* Big events:
                             mobile → fixed-height 3px color bars (no text, no height expansion)
                             desktop → text pill as before */}
                        {vw < 600 ? (
                          bigEvents.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0, marginTop: 1 }}>
                              {bigEvents.map((ev, j) => (
                                <div key={j} style={{
                                  height: 3, borderRadius: 2,
                                  background: ev.color || C.accent,
                                  flexShrink: 0,
                                }} title={ev.title} />
                              ))}
                            </div>
                          )
                        ) : (
                          bigEvents.map((ev, j) => (
                            <div key={j} style={{
                              fontFamily: mono, fontSize: '9px', lineHeight: 1.2,
                              color: ev.color || C.accent,
                              background: (ev.color || C.accent) + '28',
                              borderRadius: 3, padding: '2px 3px',
                              overflow: 'hidden', whiteSpace: 'nowrap',
                              textOverflow: 'ellipsis', flexShrink: 0,
                            }}>{ev.title}</div>
                          ))
                        )}

                        {/* AI summary — desktop only, too small to read on mobile */}
                        {vw >= 600 && summary && (
                          <div style={{
                            fontFamily: mono, fontSize: '7.5px', color: C.dim,
                            lineHeight: 1.25, overflow: 'hidden',
                            display: '-webkit-box', WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical', flex: 1, minHeight: 0,
                          }}>{summary}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
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
      color:C.muted,fontFamily:mono,fontSize:F.md,lineHeight:1,
      padding:'3px 5px',borderRadius:4,transition:'color 0.1s',
    }}
    onMouseEnter={e=>e.currentTarget.style.color=C.text}
    onMouseLeave={e=>e.currentTarget.style.color=C.muted}>
      {children}
    </button>
  );
}
function MobileCalPicker({selected, onSelect, events, healthDots={}, desktop=false, onEventClick, onAddClick, collapsed, onToggle, calView='day', onCalViewChange}) {
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

  const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

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

      {/* ── Header bar — collapses/expands calendar ─────────────────────── */}
      <div style={{
        display:"flex", alignItems:"center",
        padding:"10px 16px 8px",
        borderBottom:`1px solid ${C.border}`,
        flexShrink:0, position:'relative',
        cursor: onToggle ? 'pointer' : 'default',
      }} onClick={onToggle}>
        {/* CALENDAR label — left */}
        <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
          {onToggle&&<ChevronBtn collapsed={collapsed} onToggle={e=>{e.stopPropagation();onToggle();}}/>}
          <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:'0.06em',textTransform:'uppercase',color:C.muted}}>Calendar</span>
        </div>

        {collapsed ? (
          /* ── Collapsed: prev ← date → next centered ── */
          <div style={{position:'absolute',left:'50%',transform:'translateX(-50%)',
            display:'flex',alignItems:'center',gap:10,userSelect:'none',whiteSpace:'nowrap'}}>
            <button onClick={e=>{e.stopPropagation();const d=new Date(selDate+'T12:00:00');d.setDate(d.getDate()-1);onSelect(toKey(d));}} style={{
              background:'none',border:'none',cursor:'pointer',color:C.muted,padding:'2px 6px',
              fontFamily:mono,fontSize:F.md,lineHeight:1,transition:'color 0.15s'}}
              onMouseEnter={e=>e.currentTarget.style.color=C.text}
              onMouseLeave={e=>e.currentTarget.style.color=C.muted}>‹</button>
            <span style={{
              fontFamily:mono,fontSize:F.sm,letterSpacing:"0.1em",textTransform:"uppercase",
              color:toKey(selDate)===today?C.text:C.accent,
              background:(toKey(selDate)===today?C.text:C.accent)+"1A",
              borderRadius:6,padding:"4px 10px",
            }}>
              {selMonth} {selDate.getDate()}, {selYear}
            </span>
            <button onClick={e=>{e.stopPropagation();const d=new Date(selDate+'T12:00:00');d.setDate(d.getDate()+1);onSelect(toKey(d));}} style={{
              background:'none',border:'none',cursor:'pointer',color:C.muted,padding:'2px 6px',
              fontFamily:mono,fontSize:F.md,lineHeight:1,transition:'color 0.15s'}}
              onMouseEnter={e=>e.currentTarget.style.color=C.text}
              onMouseLeave={e=>e.currentTarget.style.color=C.muted}>›</button>
          </div>
        ) : (
          /* ── Expanded: date centered, no arrows ── */
          <div style={{position:'absolute',left:'50%',transform:'translateX(-50%)',
            pointerEvents:'none',userSelect:'none',whiteSpace:'nowrap'}}>
            <span style={{
              fontFamily:mono,fontSize:F.sm,letterSpacing:"0.1em",textTransform:"uppercase",
              color:toKey(selDate)===today?C.text:C.accent,
              background:(toKey(selDate)===today?C.text:C.accent)+"1A",
              borderRadius:6,padding:"4px 10px",
            }}>
              {selMonth} {selDate.getDate()}, {selYear}
            </span>
          </div>
        )}

        {/* RIGHT: M/D toggle only */}
        <div style={{marginLeft:'auto',flexShrink:0,display:'flex',gap:4,alignItems:'center'}} onClick={e=>e.stopPropagation()}>
          {onCalViewChange&&<>
            <button onClick={()=>onCalViewChange('month')}
              style={{fontFamily:mono,fontSize:'9px',letterSpacing:'0.06em',
                padding:'3px 7px',borderRadius:4,cursor:'pointer',
                background:'none',border:`1px solid ${C.border2}`,color:C.muted}}>M</button>
            <button onClick={()=>onCalViewChange('day')}
              style={{fontFamily:mono,fontSize:'9px',letterSpacing:'0.06em',
                padding:'3px 7px',borderRadius:4,cursor:'pointer',
                background:C.accent+'22',border:`1px solid ${C.accent}`,color:C.accent}}>D</button>
          </>}
        </div>
      </div>

      {/* ── Day columns with events ──────────────────────────────────────── */}
      {!collapsed&&<div style={{
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
            const opacity = isCtr ? 1 : Math.max(0.12, 1 - Math.pow(dist / 6, 2) * 0.88);

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
                    fontFamily:mono, fontSize:F.sm, letterSpacing:"0.04em",
                    color: (isCtr || isTdy) ? C.accent : C.muted,
                    marginBottom:3,
                  }}>{DAY_NAMES[d.getDay()]}</div>
                  <div style={{
                    fontFamily:serif,
                    fontSize: isCtr ? F.md : F.sm,
                    fontWeight: isCtr ? "600" : "normal",
                    lineHeight:1,
                    color: isCtr ? C.text : isTdy ? C.accent : C.muted,
                  }}>{d.getDate()}</div>
                  {/* Health dots */}
                  <div style={{display:"flex",gap:2,justifyContent:"center",marginTop:4,height:4}}>
                    {k<=today && (healthDots[k]?.sleep >= 85) && <div style={{width:3,height:3,borderRadius:"50%",background:C.blue}}/>}
                    {k<=today && (healthDots[k]?.readiness >= 85) && <div style={{width:3,height:3,borderRadius:"50%",background:C.green}}/>}
                    {k<=today && (healthDots[k]?.activity >= 85) && <div style={{width:3,height:3,borderRadius:"50%",background:C.accent}}/>}
                    {k<=today && (healthDots[k]?.recovery >= 85) && <div style={{width:3,height:3,borderRadius:"50%",background:"#8B6BB5"}}/>}
                  </div>
                </div>

                {/* Event cards — scrollable, fixed + button below */}
                <div style={{display:"flex",flexDirection:"column",flex:1,minHeight:0}}>
                <div style={{display:"flex",flexDirection:"column",gap:2,
                  overflowY:isCtr?"auto":"hidden",flex:1,minHeight:0,
                  scrollbarWidth:"none",msOverflowStyle:"none"}}>
                  {dayEvents.map((ev,j) => (
                    <div key={j}
                      onClick={isCtr && onEventClick ? (e)=>{e.stopPropagation();onEventClick(ev);} : undefined}
                      style={{
                        padding:"2px 5px", borderRadius:4, flexShrink:0,
                        background:`${ev.color||C.accent}22`,
                        cursor: isCtr && onEventClick ? 'pointer' : 'default',
                        transition:'background 0.1s',
                        opacity: isCtr ? 1 : 0.85,
                      }}
                      onMouseEnter={isCtr&&onEventClick?e=>{e.currentTarget.style.background=`${ev.color||C.accent}38`;}:undefined}
                      onMouseLeave={isCtr&&onEventClick?e=>{e.currentTarget.style.background=`${ev.color||C.accent}22`;}:undefined}
                    >
                      <div style={{fontFamily:mono, fontSize:F.sm, color:`${ev.color||C.accent}`, lineHeight:1.3, opacity: isCtr ? 0.7 : 0.85}}>
                        {ev.time !== "all day" ? ev.time : ""}
                      </div>
                      <div style={{fontFamily:mono, fontSize:F.sm, color:`${ev.color||C.accent}`,
                        lineHeight:1.3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", opacity: isCtr ? 1 : 0.85}}>
                        {ev.title}
                      </div>
                    </div>
                  ))}

                </div>
                {/* + add button — fixed below scroll, only on selected day */}
                {isCtr && onAddClick && (
                  <button
                    onClick={e=>{e.stopPropagation();onAddClick();}}
                    style={{
                      flexShrink:0,marginTop:4,
                      background:'none',
                      border:`1px solid ${C.border2}`,
                      borderRadius:5,cursor:'pointer',
                      color:C.muted,fontFamily:mono,fontSize:F.sm,
                      letterSpacing:'0.04em',textTransform:'uppercase',
                      padding:'5px 0',width:'100%',textAlign:'center',
                      transition:'all 0.15s',
                    }}
                    onMouseEnter={e=>{e.currentTarget.style.color=C.text;e.currentTarget.style.borderColor=C.text;}}
                    onMouseLeave={e=>{e.currentTarget.style.color=C.muted;e.currentTarget.style.borderColor=C.border2;}}
                  >+ add</button>
                )}
                </div>
              </div>
            );
          })}
        </div>
      </div>}


    </div>
  );
}
function CalStrip({selected, onSelect, events, setEvents, healthDots, token, collapsed, onToggle, calView, onCalViewChange}) {
  const mobile = useIsMobile();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [active,   setActive]  = useState(null);
  const [form,     setForm]    = useState({title:'',startTime:'',endTime:'',allDay:false});
  const [saving,   setSaving]  = useState(false);
  const [deleting, setDeleting]= useState(false);
  const [saveErr,  setSaveErr] = useState('');
  const [dirty,    setDirty]   = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);

  const isNew = active !== null && !active.id;
  const color = active?.color || C.accent;

  const to12h = t => {
    if (!t || t === 'all day') return 'all day';
    try {
      const [h, m] = t.split(':').map(Number);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
    } catch { return t; }
  };

  const toHHMM = t => {
    if (!t || t === 'all day') return '';
    try {
      // Handle "HH:MM" already
      if (/^\d{1,2}:\d{2}$/.test(t.trim())) {
        const [h,m] = t.trim().split(':').map(Number);
        return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
      }
      // Handle "H:MM AM/PM"
      const pm = /pm/i.test(t), am = /am/i.test(t);
      const match = t.match(/(\d{1,2}):(\d{2})/);
      if (match) {
        let h = parseInt(match[1]), m = parseInt(match[2]);
        if (pm && h < 12) h += 12;
        if (am && h === 12) h = 0;
        return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
      }
      return '';
    } catch { return ''; }
  };

  function openAdd() {
    setActive({});
    setForm({title:'', startTime:'09:00', endTime:'10:00', allDay:false});
    setSaveErr(''); setDirty(false); setEditingTitle(true);
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
    setSaveErr(''); setDirty(false); setEditingTitle(false);
  }

  function closePanel() { setActive(null); setSaveErr(''); setDirty(false); }
  function updateForm(patch) {
    setForm(f => {
      const next = {...f, ...patch};
      // When start time changes, adjust end time
      if (patch.startTime && !patch.endTime) {
        const [sh, sm] = patch.startTime.split(':').map(Number);
        const [eh, em] = f.endTime.split(':').map(Number);
        const startMins = sh * 60 + sm;
        const endMins   = eh * 60 + em;
        if (endMins <= startMins) {
          // End is before or equal to start — default to 1 hour later (Google Calendar behavior)
          const newEnd = startMins + 60;
          const nh = Math.floor(newEnd / 60) % 24;
          const nm = newEnd % 60;
          next.endTime = `${String(nh).padStart(2,'0')}:${String(nm).padStart(2,'0')}`;
        }
      }
      // When end time is manually set before start, bump end to 1h after start (like Google)
      if (patch.endTime && !patch.startTime) {
        const [sh, sm] = f.startTime.split(':').map(Number);
        const [eh, em] = patch.endTime.split(':').map(Number);
        if (!isNaN(sh) && (eh * 60 + em) <= (sh * 60 + sm)) {
          const newEnd = sh * 60 + sm + 60;
          const nh = Math.floor(newEnd / 60) % 24;
          const nm = newEnd % 60;
          next.endTime = `${String(nh).padStart(2,'0')}:${String(nm).padStart(2,'0')}`;
        }
      }
      return next;
    });
    setDirty(true);
  }

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
           time:form.allDay?'all day':to12h(form.startTime),
           endTime:form.allDay?null:to12h(form.endTime),allDay:form.allDay,color:'#B8A882'}]}));
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
          time:form.allDay?'all day':to12h(form.startTime),
          endTime:form.allDay?null:to12h(form.endTime),allDay:form.allDay};
        setEvents(prev=>({...prev,[selected]:(prev[selected]||[]).map(e=>e.id===active.id?updated:e)}));
        setActive(updated); setDirty(false);
      }
    } catch(err){ setSaveErr(err.message); }
    setSaving(false);
  }

  async function deleteEvent() {
    if (!active?.id||deleting) return;
    setDeleting(true);
    const snapshot = {...active}; // capture before deletion
    const dateSnap = selected;
    try {
      const res = await fetch('/api/calendar-delete', {
        method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
        body: JSON.stringify({eventId:active.id}),
      });
      if (res.ok) {
        setEvents(prev=>({...prev,[selected]:(prev[selected]||[]).filter(e=>e.id!==active.id)}));
        closePanel();
        // Push undo entry — re-create the event
        pushHistory({
          label: `Delete "${snapshot.title}"`,
          undo: async () => {
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const r = await fetch('/api/calendar-create', {
              method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
              body: JSON.stringify({title:snapshot.title, date:dateSnap,
                startTime: snapshot.allDay?'':toHHMM(snapshot.time),
                endTime: snapshot.allDay?'':toHHMM(snapshot.endTime),
                allDay:snapshot.allDay||snapshot.time==='all day', tz}),
            });
            const d = await r.json();
            if (r.ok && d.eventId) {
              const restored = {...snapshot, id:d.eventId};
              setEvents(prev=>({...prev,[dateSnap]:[...(prev[dateSnap]||[]).filter(e=>e.id!==snapshot.id&&e.id!==d.eventId), restored]}));
            }
          },
          redo: async () => {
            await fetch('/api/calendar-delete', {
              method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
              body: JSON.stringify({eventId:snapshot.id}),
            });
            setEvents(prev=>({...prev,[dateSnap]:(prev[dateSnap]||[]).filter(e=>e.id!==snapshot.id)}));
          },
        });
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

  // Derive selected date info for header pill
  const selDateObj = selected ? new Date(selected + 'T12:00:00') : new Date();
  const isSelToday = selected === todayKey();
  const pillColor = isSelToday ? C.text : C.accent;
  const SEL_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const selPillLabel = `${SEL_MONTHS[selDateObj.getMonth()]} ${selDateObj.getDate()}, ${selDateObj.getFullYear()}`;

  return (
    <Card>
      {calView === 'month' ? (
        <div style={{userSelect:'none',display:'flex',flexDirection:'column'}}>
          {/* Month header — same layout as day view */}
          <div style={{display:'flex',alignItems:'center',padding:'10px 16px 8px',
            borderBottom:`1px solid ${C.border}`,flexShrink:0,position:'relative',
            cursor:onToggle?'pointer':'default'}} onClick={onToggle}>
            <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
              {onToggle&&<ChevronBtn collapsed={collapsed} onToggle={e=>{e.stopPropagation();onToggle();}}/>}
              <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:'0.06em',textTransform:'uppercase',color:C.muted}}>Calendar</span>
            </div>
            {/* Selected date pill — centered, matches day view */}
            <div style={{position:'absolute',left:'50%',transform:'translateX(-50%)',pointerEvents:'none',userSelect:'none',whiteSpace:'nowrap'}}>
              <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:'0.1em',textTransform:'uppercase',
                color:pillColor,background:pillColor+'1A',borderRadius:6,padding:'4px 10px'}}>
                {selPillLabel}
              </span>
            </div>
            {/* M/D toggle — right */}
            <div style={{marginLeft:'auto',display:'flex',gap:4}} onClick={e=>e.stopPropagation()}>
              <button onClick={()=>onCalViewChange('month')}
                style={{fontFamily:mono,fontSize:'9px',letterSpacing:'0.06em',
                  padding:'3px 7px',borderRadius:4,cursor:'pointer',
                  background:C.accent+'22',border:`1px solid ${C.accent}`,color:C.accent}}>M</button>
              <button onClick={()=>onCalViewChange('day')}
                style={{fontFamily:mono,fontSize:'9px',letterSpacing:'0.06em',
                  padding:'3px 7px',borderRadius:4,cursor:'pointer',
                  background:'none',border:`1px solid ${C.border2}`,color:C.muted}}>D</button>
            </div>
          </div>
          {!collapsed&&<MonthView
            initYear={selDateObj.getFullYear()} initMonth={selDateObj.getMonth()}
            selected={selected}
            onSelectDay={d=>onSelect(d)}
            onMonthChange={()=>{}}
            healthDots={healthDots}
            events={events}
            token={token}
          />}
        </div>
      ) : (
        <MobileCalPicker
          selected={selected} onSelect={onSelect}
          events={events} healthDots={healthDots} desktop={!mobile}
          onEventClick={openEvent} onAddClick={openAdd}
          collapsed={collapsed} onToggle={onToggle}
          calView={calView} onCalViewChange={onCalViewChange}
        />
      )}

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
              {editingTitle ? (
                <input
                  autoFocus
                  value={form.title}
                  onChange={e=>updateForm({title:e.target.value})}
                  onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();save();setEditingTitle(false);}if(e.key==='Escape')closePanel();}}
                  onBlur={()=>setEditingTitle(false)}
                  placeholder='Event title'
                  style={{...inputBase,fontFamily:serif,fontSize:F.md,width:'100%',
                    display:'block',marginBottom:5}}
                />
              ) : (
                <div
                  onClick={()=>setEditingTitle(true)}
                  style={{fontFamily:serif,fontSize:F.md,color:form.title?C.text:C.muted,
                    marginBottom:5,cursor:'text',minHeight:'1.4em'}}
                >
                  {form.title || 'Event title'}
                </div>
              )}

              {/* Time row: times + All Day inline */}
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                {/* Time inputs — hidden when allDay */}
                <div style={{
                  display:'flex',alignItems:'center',gap:5,
                  maxWidth:form.allDay?0:240,
                  overflow:'hidden',
                  opacity:form.allDay?0:1,
                  transition:'max-width 0.25s ease, opacity 0.2s ease',
                }}>
                  <input type='time' value={form.startTime}
                    onChange={e=>updateForm({startTime:e.target.value})}
                    style={{...inputBase,fontFamily:mono,fontSize:F.sm,color:C.muted,
                      width:96,cursor:'text'}}
                  />
                  <span style={{fontFamily:mono,fontSize:F.sm,color:C.muted,opacity:0.4}}>–</span>
                  <input type='time' value={form.endTime}
                    onChange={e=>updateForm({endTime:e.target.value})}
                    style={{...inputBase,fontFamily:mono,fontSize:F.sm,color:C.muted,
                      width:96,cursor:'text'}}
                  />
                </div>

                {/* All Day toggle */}
                <button onClick={()=>updateForm({allDay:!form.allDay})} style={{
                  background:'none',border:'none',cursor:'pointer',padding:0,
                  fontFamily:mono,fontSize:F.sm,letterSpacing:'0.04em',textTransform:'uppercase',
                  color:form.allDay?C.accent:C.muted,
                  transition:'color 0.2s',
                }}
                onMouseEnter={e=>{if(!form.allDay)e.currentTarget.style.color=C.text;}}
                onMouseLeave={e=>{if(!form.allDay)e.currentTarget.style.color=C.muted;}}>
                  all day
                </button>

                {saving && <span style={{fontFamily:mono,fontSize:F.sm,color:C.muted,opacity:0.5}}>saving…</span>}
              </div>



              {active.zoomUrl && (
                <a href={active.zoomUrl} target='_blank' rel='noopener noreferrer'
                  style={{display:'inline-block',marginTop:6,fontFamily:mono,fontSize:F.sm,
                    letterSpacing:'0.1em',textTransform:'uppercase',color:C.blue,textDecoration:'none'}}>
                  Join ↗
                </a>
              )}
            </div>

            {/* Right side: trash | cancel | save — horizontal row */}
            <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0,alignSelf:'center'}}>
              {/* Trash — existing events only */}
              {!isNew && active.id && (
                <button onClick={deleteEvent} disabled={deleting} title="Delete" style={{
                  background:'none',border:'none',cursor:deleting?'default':'pointer',
                  color:C.red,padding:6,lineHeight:0,display:'flex',alignItems:'center',justifyContent:'center',
                  opacity:deleting?0.3:0.6,transition:'color 0.15s, opacity 0.15s',
                }}
                onMouseEnter={e=>{if(!deleting){e.currentTarget.style.opacity='1';e.currentTarget.style.color=C.red;}}}
                onMouseLeave={e=>{e.currentTarget.style.opacity='0.6';e.currentTarget.style.color=C.red;}}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                </button>
              )}
              {/* Cancel × */}
              <button onClick={closePanel} title="Cancel" style={{
                background:'none',border:'none',cursor:'pointer',
                color:C.muted,padding:6,lineHeight:0,display:'flex',alignItems:'center',justifyContent:'center',
                opacity:0.6,transition:'color 0.15s, opacity 0.15s',
              }}
              onMouseEnter={e=>{e.currentTarget.style.opacity='1';e.currentTarget.style.color=C.text;}}
              onMouseLeave={e=>{e.currentTarget.style.opacity='0.6';e.currentTarget.style.color=C.muted;}}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
              {/* Save ✓ */}
              <button onClick={async()=>{if(form.title.trim()){await save();closePanel();}}} disabled={saving||!form.title.trim()} title="Save" style={{
                background:'none',border:'none',cursor:(saving||!form.title.trim())?'default':'pointer',
                color:C.muted,padding:6,lineHeight:0,display:'flex',alignItems:'center',justifyContent:'center',
                opacity:(saving||!form.title.trim())?0.3:0.6,transition:'color 0.15s, opacity 0.15s',
              }}
              onMouseEnter={e=>{if(!saving&&form.title.trim()){e.currentTarget.style.opacity='1';e.currentTarget.style.color=C.green;}}}
              onMouseLeave={e=>{e.currentTarget.style.opacity=(saving||!form.title.trim())?'0.3':'0.6';e.currentTarget.style.color=C.muted;}}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </button>
            </div>

          </div>

          {saveErr && <div style={{fontFamily:mono,fontSize:F.sm,color:'#A05050',marginTop:8}}>{saveErr}</div>}
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


function HealthStrip({date,token,userId,onHealthChange,onScoresReady,onSyncStart,onSyncEnd,collapsed,onToggle}) {
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
    onSyncStart("oura");
    cachedOuraFetch(date, token, userId).then(async data=>{
        if(data.error==="no_token") {
          // No Oura — fall back to Apple Health data synced from iOS app
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
        const sb2 = sb; // reuse same singleton client
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
    const p = new URLSearchParams({ date });
    if(h.sleepHrs)       p.set('sleepHrs',      h.sleepHrs);
    if(h.sleepEff)       p.set('sleepEff',       h.sleepEff);
    if(h.hrv)            p.set('hrv',            h.hrv);
    if(h.rhr)            p.set('rhr',            h.rhr);
    if(h.steps)          p.set('steps',          h.steps);
    if(h.activeMinutes)  p.set('activeMinutes',  h.activeMinutes);
    fetch(`/api/scores?${p}`,{signal:ctrl.signal,headers:{Authorization:`Bearer ${token}`}})
      .then(r=>r.json()).then(d=>{
        if(!d.error){
          setScores(d);
          if(d.sleep?.score != null || d.readiness?.score != null || d.activity?.score != null || d.recovery?.score != null){
            onScoresReady(date, d);
          }
        }
      }).catch(e=>{ if(e.name!=='AbortError') console.warn('scores fetch',e); });
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
    {key:"sleep",    label:"Sleep",    color:C.blue,  score:scores?.sleep?.score,
      fields:[{label:"Hours",value:h.sleepHrs,unit:"h"},{label:"Effic.",value:h.sleepEff,unit:"%"}],
      sparkline:scores?.sleep?.sparkline},
    {key:"readiness",label:"Readiness",color:C.green, score:scores?.readiness?.score,
      fields:[{label:"HRV",value:h.hrv,unit:"ms"},{label:"RHR",value:h.rhr,unit:"bpm"}],
      sparkline:scores?.readiness?.sparkline},
    {key:"activity", label:"Activity", color:C.accent,score:scores?.activity?.score,
      fields:[{label:"Steps",value:h.steps?Number(h.steps).toLocaleString():""},{label:"Active",value:h.activeMinutes,unit:"min"}],
      sparkline:scores?.activity?.sparkline},
    {key:"recovery", label:"Recovery", color:purple,  score:scores?.recovery?.score,
      fields: [
        {label:"CALM",  value: h.recoveryMins || "",  unit: h.recoveryMins ? "min" : ""},
        {label:"STRESS",value: h.stressMins   || "",  unit: h.stressMins   ? "min" : ""},
      ],
      sparkline:scores?.recovery?.sparkline},
  ];

  // ── Trend panel state ──────────────────────────────────────────────────────
  const [expandedMetric, setExpandedMetric] = useState(null);
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
          <span style={{ fontFamily: mono, fontSize: F.sm, color: C.dim }}>{trendLoading ? 'loading…' : '—'}</span>
        </div>
      );
    }
    const span = trendRange === "12m" ? 364 : 29;
    const anchorDate = new Date(date + 'T12:00:00');
    const days = [];
    for (let i = -span; i <= 0; i++) days.push(toKey(shift(anchorDate, i)));
    const vals = days.map(d => data[d]?.[metricKey] ?? null);
    const pts = vals.map((v, i) => v != null ? { v, i } : null).filter(Boolean);
    if (pts.length < 2) return <div style={{ height: 94, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ fontFamily: mono, fontSize: F.sm, color: C.dim }}>not enough data</span></div>;

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
                fontFamily: mono, fontSize: '9px', color: C.dim,
                letterSpacing: '0.04em', lineHeight: 1,
              }}>{t.label}</div>
            );
          })}

        </div>
      </div>
    );
  }

  return (
    <Card style={collapsed?{height:"auto"}:{}}>
      {/* Card header */}
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"11px 14px",
        borderBottom:collapsed?"none":`1px solid ${C.border}`,flexShrink:0,
        cursor:onToggle?"pointer":"default"}} onClick={onToggle}>
        {onToggle&&<ChevronBtn collapsed={collapsed} onToggle={e=>{e.stopPropagation();onToggle();}}/>}
        <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",
          textTransform:"uppercase",color:C.muted,flex:1}}>Health</span>
        {dataSource&&(
          <span style={{fontFamily:mono,fontSize:"10px",color:C.dim,
            border:`1px solid ${C.border}`,borderRadius:4,padding:"1px 5px"}}>
            {dataSource==="both"?"Oura + Apple Health":dataSource==="apple"?"Apple Health":"Oura"}
          </span>
        )}
        {showBadge&&(
          <span title={`Scores calibrating — ${calibDays}/14 days of data. Currently using health guidelines as reference.`}
            style={{fontFamily:mono,fontSize:"10px",color:C.muted,background:"rgba(255,255,255,0.06)",
              borderRadius:4,padding:"1px 6px",cursor:"default"}}>
            Calibrating…
          </span>
        )}
      </div>
      {/* Apple Health connect prompt — iOS only, shown when not yet authorized */}
      {hkStatus==="not_determined"&&!collapsed&&(
        <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`}}>
          <button onClick={connectAppleHealth}
            style={{fontFamily:mono,fontSize:F.sm,color:C.blue,background:"none",border:`1px solid ${C.blue}`,
              borderRadius:6,cursor:"pointer",padding:"5px 12px",letterSpacing:"0.03em",opacity:0.9}}>
            Connect
          </button>
        </div>
      )}
      {/* Metrics row */}
      {!collapsed&&<div style={{display:"flex",alignItems:"stretch",overflow:"auto",
        borderBottom:expandedMetric?`1px solid ${C.border}`:"none"}}>
        {metrics.map((m,mi)=>{
          const isExpanded = expandedMetric === m.key;
          const isDimmed   = expandedMetric && !isExpanded;
          return (
            <div key={m.key}
              onClick={()=>setExpandedMetric(isExpanded ? null : m.key)}
              style={{flex:"1 0 auto",minWidth:120,display:"flex",alignItems:"center",gap:12,
                padding:"12px 14px",cursor:"pointer",transition:"opacity 0.2s, background 0.2s",
                opacity: isDimmed ? 0.4 : 1,
                background: isExpanded ? m.color + "0D" : "transparent",
                borderRight:mi<metrics.length-1?`1px solid ${C.border}`:"none",
                borderBottom: isExpanded ? `2px solid ${m.color}` : "2px solid transparent",
                boxSizing:"border-box",
              }}>
              <div style={{flexShrink:0}}>
                <Ring score={m.score} color={m.color} size={48}/>
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                  <div style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:m.color}}>{m.label}</div>
                  {m.sparkline && <Sparkline data={m.sparkline} color={m.color}/>}
                </div>
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                  {m.fields.map(f=>(
                    <div key={f.label}>
                      <div style={{fontFamily:mono,fontSize:F.sm,textTransform:"uppercase",color:C.muted,marginBottom:1,letterSpacing:"0.04em"}}>{f.label}</div>
                      <div style={{display:"flex",alignItems:"baseline",gap:2}}>
                        <span style={{fontFamily:serif,fontSize:F.md,color:f.value&&f.value!=="—"?C.text:C.dim}}>{f.value||"—"}</span>
                        {f.unit&&<span style={{fontFamily:mono,fontSize:F.sm,color:C.muted}}>{f.unit}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
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
            borderTop: expandedMetric ? `1px solid ${C.border}` : 'none',
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
                    <span style={{fontFamily:mono,fontSize:"9px",color:C.dim}}>
                      to {new Date(date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}
                    </span>
                  )}
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  {avgVal != null && (
                    <span style={{fontFamily:mono,fontSize:"10px",color:C.dim}}>avg {avgVal}</span>
                  )}
                  {["12m","30d"].map(r => (
                    <button key={r} onClick={e=>{e.stopPropagation();setTrendRange(r);}}
                      style={{fontFamily:mono,fontSize:"9px",letterSpacing:"0.05em",
                        padding:"2px 6px",borderRadius:4,cursor:"pointer",border:"none",
                        background: trendRange===r ? m.color+"33" : "transparent",
                        color: trendRange===r ? m.color : C.dim,
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
        return <div key={i} style={{color:C.accent,fontFamily:serif,fontSize:F.md,lineHeight:"1.7"}}>{renderInline(line.slice(2))}</div>;
      }
      // Empty line
      if (!line.trim()) {
        return <div key={i} style={{height:"1.7em"}}>&nbsp;</div>;
      }
      // Normal
      return <div key={i} style={{color:C.text,fontFamily:serif,fontSize:F.md,lineHeight:"1.7"}}>{renderInline(line)}</div>;
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
    fontFamily:serif, fontSize:F.md, lineHeight:"1.7",
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
        onChange={e => setValue(e.target.value, {skipHistory:true})}
        onBlur={() => { setValue(v => v, {undoLabel:'Edit notes'}); setEditing(false); }}
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
        : <div style={{color:C.muted,fontFamily:serif,fontSize:F.md,lineHeight:"1.7"}}>
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

  const safe = (Array.isArray(rows) && rows.length ? rows : [mkRow()]).map(r => r.estimating ? {...r, estimating:false} : r);
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
    try {
      const result = await estimateNutrition(promptFn(text), token);
      setRows(prev => (Array.isArray(prev)?prev:safe).map(r => r.id===id ? {...r, kcal:result?.kcal||null, protein:result?.protein||null, estimating:false} : r));
    } catch(_) {
      setRows(prev => (Array.isArray(prev)?prev:safe).map(r => r.id===id ? {...r, estimating:false} : r));
    }
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
    if (e.key==="ArrowUp" && idx > 0) { e.preventDefault(); refs.current[safe[idx-1].id]?.focus(); }
    if (e.key==="ArrowDown" && idx < safe.length-1) { e.preventDefault(); refs.current[safe[idx+1].id]?.focus(); }
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
  const colProtein = {fontFamily:mono, fontSize:F.sm, color:C.blue, flexShrink:0,
    width:PROT_W, textAlign:"center", whiteSpace:"nowrap"};
  const colKcal = {fontFamily:mono, fontSize:F.sm, color:C.orange, flexShrink:0,
    width:ENRG_W, textAlign:"center", whiteSpace:"nowrap"};
  const colMutedProt = {fontFamily:mono, fontSize:F.sm, color:C.muted, flexShrink:0,
    width:PROT_W, textAlign:"center", whiteSpace:"nowrap"};
  const colMutedEnrg = {fontFamily:mono, fontSize:F.sm, color:C.muted, flexShrink:0,
    width:ENRG_W, textAlign:"center", whiteSpace:"nowrap"};
  const rowStyle = {display:"flex", alignItems:"center", gap:0, padding:"3px 0", minHeight:28};
  const hdrColProt = {fontFamily:mono, fontSize:F.sm, letterSpacing:"0.06em", textTransform:"uppercase",
    color:C.muted, flexShrink:0, textAlign:"center", width:PROT_W};
  const hdrColEnrg = {fontFamily:mono, fontSize:F.sm, letterSpacing:"0.06em", textTransform:"uppercase",
    color:C.muted, flexShrink:0, textAlign:"center", width:ENRG_W};

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
      <div style={{flex:1,overflowY:"auto",minHeight:0}}>
        {merged.map(row => (
          <div key={row.id} style={rowStyle}>
            <span style={{lineHeight:1.7,color:C.text,fontFamily:serif,fontSize:F.md,
              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,minWidth:0}}>
              {row.text}
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
            <input ref={el=>refs.current[row.id]=el} value={row.text}
              onChange={e => setRows(safe.map(r => r.id===row.id ? {...r,text:e.target.value,kcal:null,protein:null} : r))}
              onBlur={e => { const r=safe.find(r=>r.id===row.id); if(e.target.value.trim()&&r?.kcal===null&&!r?.estimating) runEstimate(row.id,e.target.value); }}
              onKeyDown={e => onKey(e,row.id,idx)}
              placeholder={idx===0 && merged.length===0 ? placeholder : idx===0 ? "+" : ""}
              style={{background:"transparent",border:"none",outline:"none",padding:0,flex:1,
                lineHeight:1.7,color:row.text?C.text:C.muted,fontFamily:serif,fontSize:F.md}}/>
            {showProtein && (
              <span style={row.protein ? colProtein : colMutedProt}>
                {!row.text ? "" : row.estimating ? "…" : row.protein ? `${row.protein}g` : "—"}
              </span>
            )}
            <span style={row.kcal ? colKcal : colMutedEnrg}>
              {!row.text ? "" : row.estimating ? "…" : row.kcal ? `${row.kcal}kcal` : "—"}
            </span>
          </div>
        ))}
      </div>
      {(totalKcal > 0 || totalProtein > 0) && (
        <div style={{flexShrink:0,paddingTop:6,display:"flex",alignItems:"center",gap:0,borderTop:`1px solid ${C.border}`}}>
          <div style={{flex:1}}/>
          {showProtein && (
            <div style={{width:PROT_W,display:"flex",justifyContent:"center"}}>
              {totalProtein > 0 && <span style={{...chipBase,background:C.blue+"22",color:C.blue}}>{totalProtein}g</span>}
            </div>
          )}
          <div style={{width:ENRG_W,display:"flex",justifyContent:"center"}}>
            {totalKcal > 0 && <span style={{...chipBase,background:C.orange+"22",color:C.orange}}>{totalKcal}kcal</span>}
          </div>
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
      fontFamily:mono, fontSize:F.sm, letterSpacing:"0.04em", textTransform:"uppercase",
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
      avgHr:act.avgHr, avgSpeed:act.avgSpeed, startTime:act.startTime, id:act.id });
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

function calcPace(w) {
  const mps = w.avgSpeed || (w.durationMins && w.distance ? (w.distance*1000)/(w.durationMins*60) : null);
  if (!mps) return null;
  const secsPerMile = 1609.34 / mps;
  const m = Math.floor(secsPerMile/60);
  const s = Math.round(secsPerMile%60);
  return `${m}:${String(s).padStart(2,"0")}`;
}
function isRun(w) { return (w.sport||w.type||w.name||"").toLowerCase().match(/run|jog/); }

function Activity({date,token,userId}) {
  const [syncedRows, setSyncedRows] = useState([]);
  const mkRow = () => ({id:Date.now(), text:"", dist:null, pace:null, kcal:null});
  const {value:manualRows, setValue:setManualRows, loaded} = useDbSave(date, "activity", [mkRow()], token, userId);
  const {value:savedEstimates, setValue:setSavedEstimates, loaded:estLoaded} = useDbSave(date, "activity_kcal", {}, token, userId);
  const estimating = useRef(new Set());
  const [tick, setTick] = useState(0);
  const safe = (Array.isArray(manualRows)&&manualRows.length ? manualRows : [mkRow()]).map(r => r.estimating ? {...r, estimating:false} : r);
  const refs = useRef({});
  const estMap = (estLoaded && savedEstimates && typeof savedEstimates==="object") ? savedEstimates : {};

  // Merge saved kcal estimates into synced rows
  const mergedSynced = syncedRows.map(r => ({
    ...r,
    kcal: r.kcal || (typeof estMap[r.id]==="object" ? estMap[r.id]?.kcal : estMap[r.id]) || null,
  }));

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
        text: w.name,
        dist: w.distance ? `${(w.distance*0.621371).toFixed(2)}mi` : null,
        pace: isRun(w) ? calcPace(w) : null,
        kcal: w.calories||null,
      }));
      setSyncedRows(rows);
      if (rows.length && token) {
        const summary = merged.map(w=>({
          name:w.name, sport:w.sport, source:w.source,
          durationMins:w.durationMins||null, distance:w.distance||null,
          calories:w.calories||null, avgHr:w.avgHr||null,
        }));
        fetch('/api/entries',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
          body:JSON.stringify({date,type:'workouts',data:summary})}).catch(()=>{});
      }
    });
  },[date,token,userId]); // eslint-disable-line

  // AI kcal estimation for synced rows without native calories
  useEffect(()=>{
    if(!token||!loaded||!estLoaded)return;
    mergedSynced.filter(r=>!r.kcal&&r.text&&!estimating.current.has(r.id)).forEach(row=>{
      estimating.current.add(row.id);
      setTick(t=>t+1);
      estimateNutrition(`Calories burned for: "${row.text}"${row.dist?` (${row.dist})`:""} for a typical adult. Return JSON: {"kcal":300}`, token).then(result=>{
        estimating.current.delete(row.id);
        if(result?.kcal) setSavedEstimates(prev=>({...(typeof prev==="object"&&prev?prev:{}), [row.id]:result}));
        else setTick(t=>t+1);
      });
    });
  },[syncedRows,loaded,estLoaded,token]); // eslint-disable-line

  function parseActivityText(text) {
    const t = text.toLowerCase();
    // Distance: "5 mi", "5.2mi", "5 miles", "8 km", "8km"
    const distMi = t.match(/(\d+\.?\d*)\s*mi(?:les?)?/);
    const distKm  = t.match(/(\d+\.?\d*)\s*km/);
    let dist = null;
    if (distMi) dist = `${parseFloat(distMi[1]).toFixed(2)}mi`;
    else if (distKm) dist = `${(parseFloat(distKm[1])*0.621371).toFixed(2)}mi`;
    // Pace: "8 min pace", "8:30 pace", "8:30/mi", "7 min/mi"
    const paceColon = t.match(/(\d+):(\d{2})\s*(?:\/mi|pace|per)/);
    const paceMin   = t.match(/(\d+\.?\d*)\s*min(?:ute)?\s*(?:\/mi|pace|per)/);
    let pace = null;
    if (paceColon) pace = `${paceColon[1]}:${paceColon[2]}`;
    else if (paceMin) { const tot=parseFloat(paceMin[1])*60; pace=`${Math.floor(tot/60)}:${String(Math.round(tot%60)).padStart(2,'0')}`; }
    return { dist, pace };
  }
  function onKey(e,id,idx) {
    if(e.key==="Enter"){
      e.preventDefault();
      // Parse and save dist/pace for current row before moving on
      const cur=safe.find(r=>r.id===id);
      if(cur?.text){
        const {dist,pace}=parseActivityText(cur.text);
        const updated=safe.map(r=>r.id===id?{...r,dist:dist||r.dist,pace:pace||r.pace}:r);
        const newRow=mkRow();
        const i=updated.findIndex(r=>r.id===id);
        setManualRows([...updated.slice(0,i+1),newRow,...updated.slice(i+1)]);
        if(cur.kcal===null&&!cur.estimating) runEstimate(id,cur.text);
        setTimeout(()=>refs.current[newRow.id]?.focus(),30);
      } else {
        const row=mkRow();const i=safe.findIndex(r=>r.id===id);
        setManualRows([...safe.slice(0,i+1),row,...safe.slice(i+1)]);
        setTimeout(()=>refs.current[row.id]?.focus(),30);
      }
    }
    if(e.key==="Backspace"&&safe[idx]?.text===""&&safe.length>1){e.preventDefault();setManualRows(safe.filter(r=>r.id!==id));const t=safe[idx-1]?.id??safe[idx+1]?.id;setTimeout(()=>refs.current[t]?.focus(),30);}
    if(e.key==="ArrowUp"&&idx>0){e.preventDefault();refs.current[safe[idx-1].id]?.focus();}
    if(e.key==="ArrowDown"&&idx<safe.length-1){e.preventDefault();refs.current[safe[idx+1].id]?.focus();}
  }

  async function runEstimate(id, text) {
    setManualRows(safe.map(r=>r.id===id?{...r,estimating:true}:r));
    const result = await estimateNutrition(`Calories burned for: "${text}" for a typical adult. Return JSON: {"kcal":300}`, token);
    setManualRows(prev=>(Array.isArray(prev)?prev:safe).map(r=>r.id===id?{...r,kcal:result?.kcal||null,estimating:false}:r));
  }

  const KCOL=72, DCOL=60, PCOL=100;
  const colDist  = {fontFamily:mono, fontSize:F.sm, color:C.blue,   flexShrink:0, width:DCOL, textAlign:"center", whiteSpace:"nowrap"};
  const colPace  = {fontFamily:mono, fontSize:F.sm, color:C.green,  flexShrink:0, width:PCOL, textAlign:"center", whiteSpace:"nowrap"};
  const colKcal  = {fontFamily:mono, fontSize:F.sm, color:C.orange, flexShrink:0, width:KCOL, textAlign:"center", whiteSpace:"nowrap"};
  const colMuted = (w) => ({fontFamily:mono, fontSize:F.sm, color:C.muted, flexShrink:0, width:w, textAlign:"center", whiteSpace:"nowrap"});
  const editCol  = (w, clr) => ({fontFamily:mono, fontSize:F.sm, color:clr, flexShrink:0, width:w, textAlign:"center",
    background:"transparent", border:"none", outline:"none", padding:0});
  const rowS = {display:"flex", alignItems:"center", gap:0, padding:"3px 0", minHeight:28};
  const chipBase = {fontFamily:mono, fontSize:F.sm, letterSpacing:"0.04em", flexShrink:0, borderRadius:4, padding:"2px 8px", whiteSpace:"nowrap"};

  const allRows = [...mergedSynced, ...safe];
  const totalKcal = allRows.reduce((s,r)=>s+(r.kcal||0),0);

  // Parse distances like "3.50mi" → number
  function parseDist(d){ const m=String(d||"").match(/[\d.]+/); return m?+m[0]:null; }
  function parsePaceSecs(p){ const m=String(p||"").match(/^(\d+):(\d+)/); return m?+m[1]*60+ +m[2]:null; }
  const distVals = allRows.map(r=>parseDist(r.dist)).filter(Boolean);
  const paceVals = allRows.map(r=>parsePaceSecs(r.pace)).filter(Boolean);
  const totalDistMi = distVals.length ? distVals.reduce((a,b)=>a+b,0) : 0;
  const avgPaceSecs = paceVals.length ? paceVals.reduce((a,b)=>a+b,0)/paceVals.length : 0;
  const avgPaceFmt = avgPaceSecs ? `${Math.floor(avgPaceSecs/60)}:${String(Math.round(avgPaceSecs%60)).padStart(2,"0")}` : null;
  const showTotals = totalKcal>0||totalDistMi>0||avgPaceFmt;

  if(!loaded) return (<div style={{display:"flex",flexDirection:"column",gap:8,padding:"4px 0"}}>
    <Shimmer width="75%" height={13}/><Shimmer width="55%" height={13}/>
  </div>);

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
      <div style={{flex:1,overflowY:"auto",minHeight:0}}>
        {mergedSynced.map(row=>(
          <div key={row.id} style={rowS}>
            <span style={{display:"flex",alignItems:"center",gap:6,flex:1,minWidth:0,overflow:"hidden"}}>
              <span style={{lineHeight:1.7,color:C.text,fontFamily:serif,fontSize:F.md,
                overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {row.text}
              </span>
              <SourceBadge source={row.source}/>
            </span>
            <span style={row.dist ? colDist : colMuted(DCOL)}>{row.dist||""}</span>
            <span style={row.pace ? colPace : colMuted(PCOL)}>{row.pace?`${row.pace}/mi`:""}</span>
            <span style={row.kcal ? colKcal : colMuted(KCOL)}>
              {estimating.current.has(row.id)?"…":row.kcal?`-${row.kcal}kcal`:""}
            </span>
          </div>
        ))}
        {safe.map((row,idx)=>(
          <div key={row.id} style={rowS}>
            <input ref={el=>refs.current[row.id]=el} value={row.text}
              onChange={e=>setManualRows(safe.map(r=>r.id===row.id?{...r,text:e.target.value,kcal:null}:r))}
              onBlur={e=>{
                const r=safe.find(r=>r.id===row.id);
                const text=e.target.value.trim();
                if(text){
                  const {dist,pace}=parseActivityText(text);
                  setManualRows(prev=>(Array.isArray(prev)?prev:safe).map(x=>x.id===row.id?{...x,dist:dist||x.dist,pace:pace||x.pace}:x));
                  if(r?.kcal===null&&!r?.estimating) runEstimate(row.id,text);
                }
              }}
              onKeyDown={e=>onKey(e,row.id,idx)}
              placeholder={idx===0&&mergedSynced.length===0?"What did you do?":""}
              style={{background:"transparent",border:"none",outline:"none",padding:0,flex:1,
                lineHeight:1.7,color:row.text?C.text:C.muted,fontFamily:serif,fontSize:F.md}}/>
            <span style={row.dist ? colDist : colMuted(DCOL)}>{!row.text ? "" : row.dist||"—"}</span>
            <span style={row.pace ? colPace : colMuted(PCOL)}>{!row.text ? "" : row.pace?`${row.pace}/mi`:"—"}</span>
            <span style={row.kcal ? colKcal : colMuted(KCOL)}>
              {!row.text ? "" : row.estimating?"…":row.kcal?`-${row.kcal}kcal`:"—"}
            </span>
          </div>
        ))}
      </div>
      {showTotals && (
        <div style={{flexShrink:0,paddingTop:6,paddingBottom:2,display:"flex",alignItems:"center",borderTop:`1px solid ${C.border}`}}>
          <div style={{flex:1}}/>
          <div style={{width:DCOL,display:"flex",justifyContent:"center"}}>
            {totalDistMi>0&&<span style={{...chipBase,background:C.blue+"22",color:C.blue}}>{totalDistMi.toFixed(1)}mi</span>}
          </div>
          <div style={{width:PCOL,display:"flex",justifyContent:"center"}}>
            {avgPaceFmt&&<span style={{...chipBase,background:C.green+"22",color:C.green}}>{avgPaceFmt}/mi</span>}
          </div>
          <div style={{width:KCOL,display:"flex",justifyContent:"center"}}>
            {totalKcal>0&&<span style={{...chipBase,background:C.orange+"22",color:C.orange}}>-{totalKcal}kcal</span>}
          </div>
        </div>
      )}
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
          <button onClick={()=>{
              const wasDone = row.done;
              const newRows = safe.map(r=>r.id===row.id?{...r,done:!r.done}:r);
              setRows(newRows);
              pushHistory({
                label: wasDone ? `Uncomplete "${row.text}"` : `Complete "${row.text}"`,
                undo: ()=>setRows(safe.map(r=>r.id===row.id?{...r,done:wasDone}:r)),
                redo: ()=>setRows(safe.map(r=>r.id===row.id?{...r,done:!wasDone}:r)),
              });
            }}
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
              color:row.done?C.muted:C.text,fontFamily:serif,fontSize:F.md,textDecoration:row.done?"line-through":"none"}}/>
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
        <div style={{
          display:"inline-block",
          fontFamily:serif,fontSize:F.lg,letterSpacing:"-0.02em",
          color:C.text,marginBottom:24,
        }}>Day Lab</div>
        <div style={{fontFamily:mono,fontSize:F.sm,color:C.muted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:48}}>your ai dashboard</div>
        <button disabled={loading} onClick={async()=>{
          setLoading(true);
          const supabase=createClient();
          const isNative = !!(window.daylabNative);
          const redirectTo = isNative ? `daylab://auth/callback` : `${window.location.origin}/auth/callback`;
          await supabase.auth.signInWithOAuth({provider:"google",options:{
            scopes:"https://www.googleapis.com/auth/calendar",
            redirectTo,
            queryParams:{access_type:"offline",prompt:"consent"},
          }});
        }} style={{background:"none",border:`1px solid ${C.border2}`,borderRadius:8,
          color:loading?C.muted:C.text,fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",
          textTransform:"uppercase",padding:"13px 32px",cursor:loading?"not-allowed":"pointer"}}>
          {loading?"redirecting…":"sign in with google"}
        </button>

      </div>
      <div style={{position:"absolute",bottom:24,left:0,right:0,display:"flex",justifyContent:"center",gap:24}}>
        <a href="/privacy" style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",textTransform:"uppercase",color:C.muted,textDecoration:"none",opacity:0.6}}>Privacy</a>
        <a href="/terms" style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",textTransform:"uppercase",color:C.muted,textDecoration:"none",opacity:0.6}}>Terms</a>
      </div>
    </div>
  );
}

// ─── InsightsCard ─────────────────────────────────────────────────────────────
function InsightsCard({date, token, userId, healthKey, collapsed, onToggle}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [isFree, setIsFree] = useState(false);
  const [freeUsage, setFreeUsage] = useState(null); // { count, limit }
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
    if (cached?.v !== 8) return true;
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
      if (cached?.text && !isBadCache(cached.text, cached, currentHealthKey) && age < 12 * 60 * 60 * 1000) {
        setText(cleanInsight(cached.text)); setBusy(false); return;
      }
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ date, healthKey: currentHealthKey }),
      });
      const data = await res.json();
      if (data.tier === "free") { setIsFree(true); setFreeUsage({ count: data.usageCount, limit: data.limit }); }
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
    setText(""); setError(""); setIsFree(false); setFreeUsage(null);
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
    <Widget label="Insights" color={C.muted} slim collapsed={collapsed} onToggle={onToggle}>
      {/* Fixed responsive height — content scrolls inside, no scrollbar visible */}
      <div style={{ height: "clamp(80px, 10vh, 120px)", overflowY: "auto", scrollbarWidth: "none" }}>
        <div style={{ opacity: busy && !text ? 0 : 1, transition: "opacity 0.3s ease" }}>
          {error && (
            <div style={{ fontFamily: mono, fontSize:F.md, color: C.red, lineHeight: 1.6 }}>{error}</div>
          )}
          {isFree ? (
            <div>
              <div style={{ fontFamily: mono, fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 12 }}>
                You've used {freeUsage?.count ?? 10} of {freeUsage?.limit ?? 10} free AI insights.
              </div>
              <div style={{ fontFamily: mono, fontSize: 12, color: C.dim, lineHeight: 1.7, marginBottom: 14 }}>
                Upgrade to Premium for unlimited insights, voice entry, and chat with your health data.
              </div>
              <button onClick={() => window.location.href = "/upgrade"} style={{
                background: C.accent, border: "none", borderRadius: 6, padding: "8px 18px",
                cursor: "pointer", fontFamily: mono, fontSize: F.sm, color: C.bg,
                letterSpacing: "0.08em", textTransform: "uppercase",
              }}>Upgrade to Premium →</button>
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
  const [transcribing, setTranscribing] = useState(false);
  const mobile = typeof window !== "undefined" && window.innerWidth < 768;
  const recognizerRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const inputRef = useRef(null);
  const statusTimer = useRef(null);

  // Auto-resize textarea when input changes (e.g. via voice)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
    // Scroll to bottom so latest dictation is always visible
    el.scrollTop = el.scrollHeight;
  }, [input]);

  function showStatus(text, ok) {
    clearTimeout(statusTimer.current);
    setStatus({ text, ok });
    statusTimer.current = setTimeout(() => setStatus(null), ok ? 3000 : 5000);
  }

  async function recordAndTranscribe() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setListening(false);
        setTranscribing(true);
        try {
          const blob = new Blob(audioChunksRef.current, { type: mimeType });
          const base64 = await new Promise((res) => {
            const reader = new FileReader();
            reader.onload = () => res(reader.result.split(",")[1]);
            reader.readAsDataURL(blob);
          });
          const resp = await fetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ audio: base64, mimeType }),
          });
          const data = await resp.json();
          if (data.text) setInput(prev => prev ? prev + " " + data.text : data.text);
          else showStatus(data.error || "Could not transcribe", false);
        } catch (e) { showStatus("Transcription failed", false); }
        setTranscribing(false);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setListening(true);
    } catch (e) { showStatus("Microphone access denied", false); }
  }

  function toggleMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const hasMD = !!(navigator.mediaDevices?.getUserMedia);

    // If already recording via MediaRecorder, stop it
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      return;
    }
    // If already using SpeechRecognition, stop it
    if (recognizerRef.current && listening) {
      recognizerRef.current.stop();
      setListening(false);
      return;
    }

    if (!SR) {
      if (window.daylabNative) { showStatus("Voice not supported in this browser", false); return; }
      recordAndTranscribe();
      return;
    }

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    recognizerRef.current = rec;

    let finalTranscript = "";

    rec.onstart = () => { setListening(true); };
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          finalTranscript += e.results[i][0].transcript;
        } else {
          interim += e.results[i][0].transcript;
        }
      }
      // Show final + live interim in input
      setInput(finalTranscript + (interim ? interim : ""));
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed") { showStatus("Microphone access denied", false); setListening(false); }
      else if (e.error === "network") { setListening(false); if (!window.daylabNative) recordAndTranscribe(); }
      else if (e.error !== "no-speech" && e.error !== "aborted") { showStatus(`Mic error: ${e.error}`, false); setListening(false); }
      else { setListening(false); }
    };
    rec.onend = () => { setListening(false); };
    rec.start();
  }

  async function send() {
    if (!input.trim() || busy) return;
    const userText = input.trim();
    setInput("");
    if (inputRef.current) { inputRef.current.style.height = "auto"; }
    if (mediaRecorderRef.current?.state === "recording") {
      recordingCancelledRef.current = true;
      mediaRecorderRef.current.stop();
      setListening(false);
    }
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
        // Snapshot current state of affected types before refresh wipes cache
        const affectedTypes = data.results.map(r => r.type);
        const snapshots = {};
        affectedTypes.forEach(t => {
          const key = `${userId}:${date}:${t}`;
          if (MEM[key] !== undefined) snapshots[key] = JSON.parse(JSON.stringify(MEM[key]));
        });
        window.dispatchEvent(new CustomEvent("lifeos:refresh", { detail: { types: affectedTypes } }));
        showStatus(data.summary || "Done", true);
        // Register undo: restore snapshots directly into MEM + re-render
        if (Object.keys(snapshots).length > 0) {
          pushHistory({
            label: `AI: ${data.summary || 'entry'}`,
            undo: () => {
              Object.entries(snapshots).forEach(([k, v]) => {
                MEM[k] = v; DIRTY[k] = true;
              });
              window.dispatchEvent(new CustomEvent("lifeos:snapshot-restore", { detail: { keys: Object.keys(snapshots) } }));
            },
            redo: () => {
              Object.keys(snapshots).forEach(k => { delete MEM[k]; delete DIRTY[k]; });
              window.dispatchEvent(new CustomEvent("lifeos:refresh", { detail: { types: affectedTypes } }));
            },
          });
        }
      } else if (data.tier === 'free') {
        showStatus('Voice entry requires Premium — tap to upgrade', false, true);
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

  const hasMic = !!(window?.SpeechRecognition || window?.webkitSpeechRecognition);

  return (
    <div style={{
      position: "fixed",
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 98,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      background: C.surface,
      borderTop: `1px solid ${C.border}`,
      padding: "6px 12px",
      paddingBottom: "max(6px, env(safe-area-inset-bottom, 6px))",
      gap: 6,
    }}>

      {/* Status notification */}
      {status && (
        <div style={{
          padding: "7px 14px",
          borderRadius: 8,
          background: status.ok ? `${C.green}18` : `${C.red}15`,
          border: `1px solid ${status.ok ? C.green : C.red}40`,
          animation: "fadeInUp 0.18s ease",
          width: "100%", maxWidth: 560, boxSizing: "border-box",
        }}>
          <span style={{
            fontFamily: mono, fontSize: F.sm,
            color: status.ok ? C.green : C.red,
            lineHeight: 1.5,
          }}>
            {status.ok ? "✓ " : ""}{status.text}
          </span>
        </div>
      )}

      {/* Input row */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        width: "100%", maxWidth: 560,
        background: C.well,
        borderRadius: mobile ? 24 : 20,
        border: "none",
        padding: mobile ? "10px 10px 10px 18px" : "8px 8px 8px 14px",
      }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"; }}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={busy ? "Adding…" : "Add anything…"}
          disabled={busy}
          rows={1}
          style={{
            flex: 1, background: "transparent", border: "none", outline: "none",
            fontFamily: serif, fontSize: F.md, color: C.text,
            padding: "0", opacity: busy ? 0.5 : 1, lineHeight: 1.4,
            resize: "none", overflow: "auto", maxHeight: "120px",
          }}
        />

        {input.trim() ? (
          <button onClick={send} disabled={busy} style={{
            background: C.accent, border: "none", borderRadius: "50%",
            width: 36, height: 36, cursor: busy ? "default" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, opacity: busy ? 0.4 : 1, transition: "opacity 0.15s",
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5"/>
              <polyline points="5 12 12 5 19 12"/>
            </svg>
          </button>
        ) : hasMic ? (
          <button onClick={transcribing ? undefined : toggleMic} style={{
            background: transcribing ? `${C.accent}22` : listening ? `${C.red}22` : `${C.text}10`,
            border: "none", borderRadius: "50%",
            width: 36, height: 36, cursor: transcribing ? "default" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, transition: "background 0.2s",
          }}>
            {transcribing ? (
              <div style={{ width: 10, height: 10, borderRadius: "50%", border: `1.5px solid ${C.accent}`, borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }}/>
            ) : listening ? (
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
const MEALS_HDR = <span style={{display:"flex",gap:0}}><span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:C.muted,width:50,textAlign:"center"}}>prot</span><span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:C.muted,width:72,textAlign:"center"}}>energy</span></span>;
const ACT_HDR = <span style={{display:"flex",gap:0}}>
  <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:C.muted,width:60,textAlign:"center"}}>dist</span>
  <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:C.muted,width:100,textAlign:"center"}}>pace</span>
  <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:C.muted,width:72,textAlign:"center"}}>energy</span>
</span>;
const WIDGETS = [
  {id:"notes",    label:"Journal",  color:()=>C.accent, Comp:Notes},
  {id:"tasks",    label:"Tasks",    color:()=>C.blue,   Comp:Tasks},
  {id:"meals",    label:"Meals",    color:()=>C.red,    Comp:Meals,    headerRight:()=>MEALS_HDR},
  {id:"activity", label:"Activity", color:()=>C.green,  Comp:Activity, headerRight:()=>ACT_HDR},
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
  const [calView,   setCalView]   = useState(() => localStorage.getItem('calView') || 'day');
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

  // Expose token to native iOS layer (Swift reads this for HealthKit sync)
  // @supabase/ssr uses cookies not localStorage, so we bridge it manually
  useEffect(()=>{
    if(token) localStorage.setItem('daylab:token', token);
    else localStorage.removeItem('daylab:token');
  },[token]);

  useEffect(() => { localStorage.setItem('calView', calView); }, [calView]);

  // ── Silent background scores backfill — runs once per session ──────────
  // Finds any health/health_apple rows that don't have a computed scores entry
  // and fills them in. This is what populates historical trend data.
  useEffect(() => {
    if (!token || !userId) return;
    const key = `scores_backfill_done:${userId}`;
    if (sessionStorage.getItem(key)) return; // already ran this session
    sessionStorage.setItem(key, '1');
    fetch('/api/scores-backfill', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then(r => r.json())
      .then(d => { if (d.scored > 0) console.log(`[daylab] backfilled ${d.scored} score entries`); })
      .catch(() => {}); // silent — never block the UI
  }, [token, userId]); // eslint-disable-line

  // ── Pull-to-refresh from native iOS app ────────────────────────────────
  useEffect(() => {
    const handler = () => {
      setSelected(todayKey());
      window.dispatchEvent(new CustomEvent('lifeos:refresh', { detail: {} }));
    };
    window.addEventListener('daylabRefresh', handler);
    return () => window.removeEventListener('daylabRefresh', handler);
  }, []);

  // ── Collapse state ─────────────────────────────────────────────────────
  const [calCollapsed,    toggleCal]      = useCollapse("cal",     false);
  const [healthCollapsed, toggleHealth]   = useCollapse("health",  true);
  const [insightCollapsed,toggleInsight]  = useCollapse("insights",true);
  const [notesCollapsed,  toggleNotes]    = useCollapse("notes",   false);
  const [tasksCollapsed,  toggleTasks]    = useCollapse("tasks",   false);
  const [mealsCollapsed,  toggleMeals]    = useCollapse("meals",   false);
  const [actCollapsed,    toggleAct]      = useCollapse("activity",false);
  const collapseMap = {notes:notesCollapsed,tasks:tasksCollapsed,meals:mealsCollapsed,activity:actCollapsed};
  const toggleMap   = {notes:toggleNotes,  tasks:toggleTasks,  meals:toggleMeals,  activity:toggleAct};

  // ── Global undo/redo keyboard shortcut ──────────────────────────────────
  useEffect(() => {
    const handler = async (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key !== 'z') return;
      // Don't fire when typing inside an input/textarea
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      if (e.shiftKey) { await doRedo(); }
      else            { await doUndo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
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
  const fetchCalRef = useRef(null);

  // Re-fetch calendar when AI entry adds an event
  useEffect(()=>{
    const handler = (e) => {
      if (e.detail?.types?.includes('calendar') && fetchCalRef.current) {
        fetchCalRef.current();
      }
    };
    window.addEventListener('lifeos:refresh', handler);
    return ()=>window.removeEventListener('lifeos:refresh', handler);
  }, []);
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

    fetchCalRef.current = fetchCal;

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

  // onHealthChange: called when raw health data loads — kept as prop, used for InsightsCard healthKey.
  const onHealthChange=useCallback(()=>{},[]);

  // onScoresReady: called by HealthStrip when /api/scores returns fresh computed scores.
  // Updates the calendar dot for that specific date with correct values.
  const onScoresReady=useCallback((date, d)=>{
    setHealthDots(prev=>({...prev,[date]:{
      sleep:    d.sleep?.score    ?? prev[date]?.sleep    ?? 0,
      readiness:d.readiness?.score?? prev[date]?.readiness?? 0,
      activity: d.activity?.score ?? prev[date]?.activity ?? 0,
      recovery: d.recovery?.score ?? prev[date]?.recovery ?? 0,
    }}));
  },[]);

  // Load health dots from computed scores only (type='scores').
  // Backfill now computes our own scores for all historical dates,
  // so we never fall back to Oura's scoring system.
  useEffect(()=>{
    if(!token||!userId)return;
    const supabase=createClient();
    supabase.auth.setSession({access_token:token,refresh_token:''});
    const since=toKey(shift(new Date(),-180));
    const dotsToday = todayKey();
    supabase.from('entries').select('date,data')
      .eq('user_id',userId).eq('type','scores').gte('date',since).lte('date',dotsToday)
      .then(({data})=>{
        if(!data)return;
        const dots={};
        data.forEach(row=>{
          if(!row.date||!row.data)return;
          dots[row.date]={
            sleep:    +row.data.sleepScore    ||0,
            readiness:+row.data.readinessScore||0,
            activity: +row.data.activityScore ||0,
            recovery: +row.data.recoveryScore ||0,
          };
        });
        setHealthDots(dots);
      }).catch(()=>{});
  },[token,userId]); // eslint-disable-line

  const mobile = useIsMobile();
  if(!authReady) return (
    <div style={{background:C.bg,height:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <span style={{fontFamily:mono,fontSize:F.sm,color:C.muted,letterSpacing:"0.2em"}}>loading…</span>
    </div>
  );
  if(!session) return <LoginScreen/>;

  const syncStatus={syncing:syncing.size>0,lastSync};
  const [leftWidget,...rightWidgets] = WIDGETS;

  return (
    <div style={{background:C.bg,height:mobile?"auto":"100vh",minHeight:mobile?"100vh":undefined,color:C.text,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        html,body{height:100%;overflow:hidden;background:${C.bg} !important;}
        @media(max-width:768px){html,body{overflow:auto;height:auto;}}
        ::-webkit-scrollbar{display:none;}
        *{scrollbar-width:none;-ms-overflow-style:none;}
        button{border-radius:0;}
        input::placeholder,textarea::placeholder{color:${C.muted};opacity:1;}
        .oura-token-input::placeholder{color:${C.dim};opacity:1;}
        a{text-decoration:none;}
        @media(max-width:768px){input,textarea,select{font-size:16px;}}
        @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeInUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
      `}</style>

      <TopBar session={session} token={token} userId={userId} syncStatus={syncStatus} theme={theme} onThemeChange={setTheme} selected={selected} onGoToToday={()=>setSelected(todayKey())}/>

      {/* ── SINGLE layout path — stacks on narrow, 2-col on wide ─── */}
        <div style={{flex:1, minHeight:0, overflow:mobile?"auto":"hidden", padding:mobile?8:10,
          paddingBottom:mobile?140:0, display:"flex", flexDirection:"column", gap:8}}>

          {/* Calendar */}
          <div style={{flexShrink:0}}>
            <CalStrip selected={selected} onSelect={setSelected}
              events={events} setEvents={setEvents} healthDots={healthDots}
              token={token} collapsed={mobile?false:calCollapsed} onToggle={mobile?undefined:toggleCal}
              calView={calView} onCalViewChange={v=>{setCalView(v);}}/>
          </div>

          {/* Health */}
          <div style={{flexShrink:0}}>
            <HealthStrip date={selected} token={token} userId={userId}
              onHealthChange={onHealthChange} onScoresReady={onScoresReady} onSyncStart={startSync} onSyncEnd={endSync}
              collapsed={mobile?false:healthCollapsed} onToggle={mobile?undefined:toggleHealth}/>
          </div>

          {/* Widgets — row on wide, flat stack on narrow */}
          {mobile ? (
            <div style={{display:"flex", flexDirection:"column", gap:8, paddingBottom:8}}>
              <InsightsCard date={selected} token={token} userId={userId}
                healthKey={`${selected}:${healthDots[selected]?.sleep||0}:${healthDots[selected]?.readiness||0}`}
                collapsed={false} onToggle={undefined}/>
              <div style={{minHeight:260}}>
                <Widget label={leftWidget.label} color={leftWidget.color()}
                  collapsed={false} onToggle={undefined}
                  headerRight={leftWidget.headerRight?.()}>
                  <leftWidget.Comp date={selected} token={token} userId={userId}/>
                </Widget>
              </div>
              {rightWidgets.map(w=>(
                <div key={w.id} style={{minHeight:260}}>
                  <Widget label={w.label} color={w.color()}
                    collapsed={false} onToggle={undefined}
                    headerRight={w.headerRight?.()}>
                    <w.Comp date={selected} token={token} userId={userId}/>
                  </Widget>
                </div>
              ))}
            </div>
          ) : (
            <div style={{display:"flex", gap:8,
              flex:"1 1 0", minHeight:0,
              flexDirection:"row",
              alignItems:"stretch", overflow:"hidden",
              paddingBottom:80}}>

              {/* Left column: Insights + Notes */}
              <div style={{flex:"1 1 0", minWidth:0, minHeight:0,
                display:"flex", flexDirection:"column", gap:8,
                overflowY:"auto"}}>
                <div style={{flexShrink:0}}>
                  <InsightsCard date={selected} token={token} userId={userId}
                    healthKey={`${selected}:${healthDots[selected]?.sleep||0}:${healthDots[selected]?.readiness||0}`}
                    collapsed={insightCollapsed} onToggle={toggleInsight}/>
                </div>
                <div style={{flex:"1 1 0", minHeight:0, display:"flex", flexDirection:"column"}}>
                  <Widget label={leftWidget.label} color={leftWidget.color()}
                    collapsed={collapseMap[leftWidget.id]}
                    onToggle={toggleMap[leftWidget.id]}
                    headerRight={leftWidget.headerRight?.()}>
                    <leftWidget.Comp date={selected} token={token} userId={userId}/>
                  </Widget>
                </div>
              </div>

              {/* Right widgets — column always */}
              <div style={{flex:"1 1 0", minWidth:0, minHeight:0,
                display:"flex", flexDirection:"column", gap:8,
                overflowY:"auto"}}>
                {rightWidgets.map(w=>(
                  <div key={w.id} style={{
                    flex: collapseMap[w.id]?"0 0 auto":"1 1 0",
                    minHeight: collapseMap[w.id]?0:80,
                    overflow:"hidden"}}>
                    <Widget label={w.label} color={w.color()}
                      collapsed={collapseMap[w.id]}
                      onToggle={toggleMap[w.id]}
                      headerRight={w.headerRight?.()}>
                      <w.Comp date={selected} token={token} userId={userId}/>
                    </Widget>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

      {/* Floating chat pill — always visible, both mobile + desktop */}
      <ChatFloat date={selected} token={token} userId={userId}/>
    </div>
  );
}
