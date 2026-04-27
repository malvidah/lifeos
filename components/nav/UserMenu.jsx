"use client";
import { useState, useEffect, useRef } from "react";
import { mono, F, R, blurweb } from "@/lib/tokens";
import { createClient } from "@/lib/supabase";
import { ouraKey } from "@/lib/ouraCache";
import { IntegrationToggle, IntegrationRow, InfoTip, Card, DayLabLoader } from "../ui/primitives.jsx";

// ── Feature flags — set to true to re-enable ────────────────────────────────
const ENABLE_GARMIN = false;
const ENABLE_GOOGLE_TASKS = false;

export default function UserMenu({session,token,userId,theme,themePreference,onThemeChange,stravaConnected,onStravaChange}) {
  const [open,setOpen]=useState(false);
  const [ouraKey,setOuraKey]=useState("");
  const [ouraConnected,setOuraConnected]=useState(false);
  const [garminConnected,setGarminConnected]=useState(false);
  const [garminEmail,setGarminEmail]=useState("");
  const [garminPassword,setGarminPassword]=useState("");
  const [garminError,setGarminError]=useState("");
  const [garminLoading,setGarminLoading]=useState(false);
  const setStravaConnected = onStravaChange;
  const [appleHealthHasData,setAppleHealthHasData]=useState(false);
  const [claudeConnected,setClaudeConnected]=useState(false);
  const [syncing,setSyncing]=useState(null); // null | 'oura' | 'strava' | 'apple'
  const [resyncing, setResyncing]=useState(false); // local state for Score History resync
  const [urlCopied,setUrlCopied]=useState(false);
  const [planInfo,setPlanInfo]=useState(null); // null | { isPremium, insightCount }
  const [calendarsList,setCalendarsList]=useState(null); // null=loading, []|[...]=loaded
  const [extraCalendars,setExtraCalendars]=useState([]); // [{ id, summary, color }]
  const [calSaving,setCalSaving]=useState(false);
  const [calExpanded,setCalExpanded]=useState(false);

  const ref=useRef(null);
  const user=session?.user;
  const initials=user?.user_metadata?.name?.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()||user?.email?.[0]?.toUpperCase()||"?";
  const avatar=user?.user_metadata?.avatar_url;
  const [isIOS, setIsIOS] = useState(false);
  useEffect(()=>{ setIsIOS(!!window.daylabNative); },[]);

  useEffect(()=>{
    if(!token||!open)return;
    fetch("/api/settings",{headers:{Authorization:`Bearer ${token}`}})
      .then(r=>r.json()).then(d=>{
        const settings = d?.data ?? {};
        if(settings.ouraToken){setOuraKey(settings.ouraToken);setOuraConnected(true);}
        if(settings.garminTokens?.oauth1){setGarminConnected(true);}
        if(settings.stravaToken?.access_token){setStravaConnected(true);}
        if(settings.extraCalendars) setExtraCalendars(settings.extraCalendars);
        // Read premium status from user_settings (same source as server-side isPremium)
        setPlanInfo({
          isPremium: settings.premium?.active === true,
          insightCount: settings.insightUsage?.count || 0,
          plan: settings.premium?.plan || null,
        });
      }).catch(()=>{});
    // Load available Google calendars for the calendar picker
    setCalendarsList(null);
    fetch("/api/calendar/list",{headers:{Authorization:`Bearer ${token}`}})
      .then(r=>r.json()).then(d=>{ setCalendarsList(d?.calendars||[]); }).catch(()=>setCalendarsList([]));
    // Check Apple Health data + Claude MCP connection (use singleton — no new GoTrueClient)
    const _sb = createClient();
    _sb.from("health_metrics").select("id").eq("source","apple").limit(5)
      .then(({data})=>{
        if(data?.length) setAppleHealthHasData(true);
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
  const divider=<div style={{height:1,background:"var(--dl-border)",margin:"10px 0"}}/>;
  const FREE_LIMIT = 10;
  const planBadge = planInfo === null ? null : planInfo.isPremium ? (
    <div style={{margin:"0 12px 10px",borderRadius:6,border:`1px solid var(--dl-accent-19)`,overflow:"hidden"}}>
      <div style={{padding:"10px 12px",textAlign:"center"}}>
        <div style={{fontFamily:mono,fontSize:F.sm,color:"var(--dl-accent)",letterSpacing:"0.06em",textTransform:"uppercase"}}>Premium ✦</div>
        <div style={{fontFamily:mono,fontSize:"10px",color:"var(--dl-highlight)",marginTop:3}}>{planInfo.plan === 'yearly' ? 'Annual plan · $4/mo' : 'Monthly plan · $5/mo'}</div>
      </div>
      <button onClick={()=>window.location.href="/upgrade"} style={{width:"100%",padding:"7px 12px",background:"none",borderTop:`1px solid var(--dl-accent-13)`,border:"none",cursor:"pointer",fontFamily:mono,fontSize:"10px",color:"var(--dl-highlight)",letterSpacing:"0.08em",textTransform:"uppercase",textAlign:"center"}}>
        Manage Plan →
      </button>
    </div>
  ) : (
    <div style={{margin:"0 12px 10px",borderRadius:6,border:`1px solid var(--dl-border)`,overflow:"hidden"}}>
      <div style={{padding:"8px 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={{fontFamily:mono,fontSize:F.sm,color:"var(--dl-highlight)",letterSpacing:"0.06em",textTransform:"uppercase"}}>Free plan</div>
          <div style={{fontFamily:mono,fontSize:"10px",color:"var(--dl-middle)",marginTop:2}}>{planInfo.insightCount}/{FREE_LIMIT} AI insights used</div>
        </div>
        <div style={{width:32,height:32,position:"relative"}}>
          <svg viewBox="0 0 32 32" style={{width:32,height:32,transform:"rotate(-90deg)"}}>
            <circle cx="16" cy="16" r="12" fill="none" stroke={"var(--dl-border)"} strokeWidth="3"/>
            <circle cx="16" cy="16" r="12" fill="none" stroke={"var(--dl-accent)"} strokeWidth="3"
              strokeDasharray={`${Math.min(planInfo.insightCount/FREE_LIMIT,1)*75.4} 75.4`}
              strokeLinecap="round"/>
          </svg>
        </div>
      </div>
      <button onClick={()=>window.location.href="/upgrade"} style={{width:"100%",padding:"8px 12px",background:"var(--dl-accent)",border:"none",cursor:"pointer",fontFamily:mono,fontSize:"10px",color:"var(--dl-bg)",letterSpacing:"0.1em",textTransform:"uppercase",textAlign:"center"}}>
        Upgrade to Premium →
      </button>
    </div>
  );
  const connBtn = (color="var(--dl-green)") => ({width:"100%",padding:"7px",textAlign:"center",boxSizing:"border-box",background:"none",border:`1px solid ${color}`,borderRadius:5,color:color,fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",textTransform:"uppercase",cursor:"pointer"});
  // Use the module-level singleton — avoids spawning new GoTrueClient instances

  async function connectOura() {
    if(!ouraKey.trim()) return;
    setSyncing("oura");
    try {
      // Save token
      await fetch("/api/settings",{method:"PATCH",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
        body:JSON.stringify({ouraToken:ouraKey.trim()})});
      setOuraConnected(true);
      // Backfill history
      const res = await fetch("/api/oura-backfill",{method:"POST",
        headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({})});
      const d = await res.json();
      if(!d.ok) console.warn("Oura backfill error:", d.error);
      // Recompute all scores from the fresh data, then reload calendar dots
      await fetch('/api/scores-backfill', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      }).catch(() => {});
      window.dispatchEvent(new CustomEvent('daylab:reload-dots'));
    } catch(e) { console.warn("Oura connect failed:", e); }
    setSyncing(null);
  }

  async function disconnectOura() {
    // disconnect immediately — no prompt (confirm() is blocked in WKWebView)
    await fetch("/api/settings",{method:"PATCH",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
      body:JSON.stringify({ouraToken:null})});
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
        const {data} = await sb.from("health_metrics").select("id").eq("source","apple").limit(5);
        const hasReal = data?.length > 0;
        if(hasReal || attempts > 20) {
          clearInterval(poll);
          if(hasReal) setAppleHealthHasData(true);
          setSyncing(null);
        }
      }, 3000);
    }
  }

  async function disconnectAppleHealth() {
    // disconnect immediately
    const sb = createClient();
    await sb.from("health_metrics").delete().eq("source","apple").eq("user_id",userId);
    setAppleHealthHasData(false);
  }

  async function connectStrava() {
    window.location.href="/api/strava-connect";
  }

  async function connectGarmin() {
    if (!garminEmail.trim() || !garminPassword.trim()) return;
    setGarminLoading(true); setGarminError("");
    try {
      const r = await fetch("/api/garmin-auth", {
        method:"POST",
        headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
        body:JSON.stringify({email:garminEmail.trim(),password:garminPassword}),
      });
      const d = await r.json();
      if (!r.ok || d.error) {
        setGarminError(d.error === "invalid_credentials" ? "Wrong email or password" : "Connection failed. Try again.");
      } else {
        setGarminConnected(true); setGarminEmail(""); setGarminPassword("");
      }
    } catch { setGarminError("Connection failed. Try again."); }
    setGarminLoading(false);
  }

  async function disconnectGarmin() {
    await fetch("/api/garmin-auth", {method:"DELETE",headers:{Authorization:`Bearer ${token}`}});
    setGarminConnected(false); setGarminEmail(""); setGarminPassword(""); setGarminError("");
  }

  async function disconnectStrava() {
    // disconnect immediately
    const sb = createClient();
    await sb.from("entries").delete().eq("type","strava_token").eq("user_id",userId);
    setStravaConnected(false);
  }

  async function toggleCalendar(cal) {
    if (cal.primary) return;
    const isEnabled = extraCalendars.some(e => e.id === cal.id);
    const newList = isEnabled
      ? extraCalendars.filter(e => e.id !== cal.id)
      : [...extraCalendars, { id: cal.id, summary: cal.summary, color: cal.backgroundColor }];
    setExtraCalendars(newList);
    setCalSaving(true);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: {"Content-Type":"application/json","Authorization":`Bearer ${token}`},
        body: JSON.stringify({ extraCalendars: newList }),
      });
      window.dispatchEvent(new CustomEvent('daylab:refresh', { detail: { types: ['calendar'] } }));
    } catch(e) { console.warn("Calendar save failed:", e); }
    setCalSaving(false);
  }

  return (
    <div ref={ref} style={{position:"relative"}}>
      <button onClick={()=>setOpen(o=>!o)} style={{
        width:"100%",height:"100%",borderRadius:"50%",padding:0,cursor:"pointer",
        border:"none",background:avatar?"transparent":"var(--dl-surface)",
        overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center"}}>
        {avatar
          ? <img src={avatar} width="100%" height="100%" style={{objectFit:"cover",display:"block"}} alt=""
              onError={e => { e.currentTarget.style.display='none'; e.currentTarget.nextSibling.style.display='flex'; }}/>
          : null}
        <span style={{fontFamily:mono,fontSize:F.sm,color:"var(--dl-highlight)",display:avatar?'none':'flex'}}>{initials}</span>
      </button>

      {open&&(
        <div style={{
          position:"absolute",top:40,right:0,width:272,zIndex:300,
          background:"var(--dl-card)",border:`1px solid var(--dl-border2)`,borderRadius:R,
          padding:"14px 0",display:"flex",flexDirection:"column",
          boxShadow:"var(--dl-shadow)",overflowY:"auto",maxHeight:"85vh",
        }}>

          {/* Identity + refresh */}
          <div style={{...row,paddingBottom:2,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div>
              <div style={{fontFamily:blurweb,fontSize:F.md,color:"var(--dl-strong)",letterSpacing:"0.04em"}}>{user?.user_metadata?.name||"—"}</div>
              <div style={{fontFamily:mono,fontSize:F.sm,color:"var(--dl-middle)",marginTop:2}}>{user?.email}</div>
            </div>
            <button
              onClick={()=>window.location.reload()}
              title="Refresh"
              style={{background:"none",border:"none",cursor:"pointer",padding:6,borderRadius:6,
                display:"flex",alignItems:"center",justifyContent:"center",
                flexShrink:0,opacity:0.4,transition:"opacity 0.15s, background 0.15s"}}
              onMouseEnter={e=>{e.currentTarget.style.opacity="1";e.currentTarget.style.background="var(--dl-border2)";}}
              onMouseLeave={e=>{e.currentTarget.style.opacity="0.4";e.currentTarget.style.background="none";}}
            >
              <svg width="18" height="18" viewBox="0 0 1500 1500" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M841 518C841 551 842.5 578 845.5 599C849.5 619 856.5 635 866.5 647C877.5 659 892.5 667 911.5 671C930.5 675 955 677 985 677C1015 677 1039 679.5 1057 684.5C1076 689.5 1090.5 696 1100.5 704C1110.5 712 1117 721.5 1120 732.5C1124 742.5 1126 753 1126 764C1126 775 1124.5 786.5 1121.5 798.5C1119.5 809.5 1114 819.5 1105 828.5C1096 837.5 1082.5 845 1064.5 851C1046.5 857 1022 860 991 860C961 860 936 862 916 866C897 870 882 877.5 871 888.5C860 898.5 852 913 847 932C843 950 841 973 841 1001C841 1035 838.5 1061.5 833.5 1080.5C828.5 1099.5 821.5 1113.5 812.5 1122.5C804.5 1131.5 795 1137 784 1139C773 1141 762 1142 751 1142C721 1142 698.5 1133.5 683.5 1116.5C668.5 1098.5 661 1061 661 1004C661 951 651.5 914 632.5 893C614.5 871 580 860 529 860C481 860 443 854.5 415 843.5C387 831.5 373 806 373 767C373 737 383.5 714.5 404.5 699.5C426.5 684.5 466 677 523 677C551 677 574 675 592 671C610 666 624 658 634 647C645 635 652 619 655 599C659 579 661 553 661 521C661 493 663.5 470.5 668.5 453.5C673.5 436.5 680 423.5 688 414.5C696 405.5 705.5 399.5 716.5 396.5C727.5 393.5 739 392 751 392C784 392 807 403.5 820 426.5C834 448.5 841 479 841 518Z" fill="var(--dl-strong)"/>
                <path d="M1138 476C1138 488.667 1135.33 500.667 1130 512C1125.33 522.667 1118.67 532.333 1110 541C1102 549 1092.33 555.667 1081 561C1070.33 565.667 1059.33 568 1048 568C1036.67 568 1025.33 565.667 1014 561C1003.33 555.667 993.667 549 985 541C976.333 532.333 969.333 522.667 964 512C958.667 500.667 956 488.667 956 476C956 463.333 958.333 451.333 963 440C968.333 428.667 975 418.667 983 410C991.667 401.333 1001.33 394.667 1012 390C1023.33 384.667 1035.33 382 1048 382C1060.67 382 1072.33 384.667 1083 390C1094.33 394.667 1104 401.333 1112 410C1120 418.667 1126.33 428.667 1131 440C1135.67 451.333 1138 463.333 1138 476ZM1013 474C1013 484 1016.33 492.333 1023 499C1029.67 505.667 1038 509 1048 509C1058 509 1066.33 505.667 1073 499C1079.67 492.333 1083 484 1083 474C1083 464 1079.67 455.667 1073 449C1066.33 442.333 1058 439 1048 439C1038 439 1029.67 442.333 1023 449C1016.33 455.667 1013 464 1013 474Z" fill="var(--dl-strong)"/>
              </svg>
            </button>
          </div>
          {divider}
          {planBadge}

          {/* ── Calendar ────────────────────────────────────────────────── */}
          {divider}
          <div style={{padding:'2px 16px 6px',fontFamily:mono,fontSize:'9px',letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--dl-middle)'}}>Calendar</div>

          {/* Google Calendar — always connected; expandable calendar picker */}
          <div style={row}>
            <IntegrationRow
              label="Google"
              connected={true}
              onToggleOn={()=>{}}
              onToggleOff={()=>{}}
            />
            {/* "Select calendars" expander */}
            <button
              onClick={()=>{setCalExpanded(o=>!o);}}
              style={{
                display:'flex',alignItems:'center',gap:4,marginTop:5,
                background:'none',border:'none',cursor:'pointer',padding:0,
                fontFamily:mono,fontSize:'10px',letterSpacing:'0.04em',
                color:'var(--dl-middle)',textTransform:'uppercase',
              }}
              onMouseEnter={e=>e.currentTarget.style.color='var(--dl-highlight)'}
              onMouseLeave={e=>e.currentTarget.style.color='var(--dl-middle)'}
            >
              <span style={{transition:'transform 0.15s',display:'inline-block',transform:calExpanded?'rotate(90deg)':'rotate(0deg)'}}>›</span>
              {extraCalendars.length > 0
                ? `${extraCalendars.length + 1} calendar${extraCalendars.length > 0 ? 's' : ''} syncing`
                : 'Select calendars'}
              {calSaving && <span style={{opacity:0.5}}> · saving…</span>}
            </button>
            {/* Expanded calendar list */}
            {calExpanded && (
              <div style={{marginTop:6,display:'flex',flexDirection:'column',gap:1}}>
                {calendarsList === null ? (
                  <div style={{fontFamily:mono,fontSize:10,color:'var(--dl-middle)',padding:'4px 0'}}>Loading…</div>
                ) : calendarsList.map(cal => {
                  const isEnabled = cal.primary || extraCalendars.some(e => e.id === cal.id);
                  return (
                    <button key={cal.id} onClick={()=>toggleCalendar(cal)} disabled={cal.primary}
                      style={{
                        display:'flex',alignItems:'center',gap:8,
                        background:'none',border:'none',
                        cursor:cal.primary?'default':'pointer',
                        padding:'4px 0',width:'100%',textAlign:'left',
                        opacity:cal.primary?0.5:1,
                      }}>
                      <div style={{width:10,height:10,borderRadius:'50%',background:cal.backgroundColor,flexShrink:0}}/>
                      <span style={{
                        fontFamily:mono,fontSize:F.sm,
                        color:isEnabled?'var(--dl-highlight)':'var(--dl-middle)',
                        flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',
                      }}>{cal.summary}</span>
                      <div style={{
                        width:14,height:14,
                        border:`1.5px solid ${isEnabled?cal.backgroundColor:'var(--dl-border2)'}`,
                        borderRadius:3,
                        background:isEnabled?cal.backgroundColor:'transparent',
                        flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',
                        transition:'all 0.15s',
                      }}>
                        {isEnabled && (
                          <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                            <path d="M1.5 5.5L4 8L8.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Health ─────────────────────────────────────────────────── */}
          {divider}
          <div style={{padding:'2px 16px 6px',fontFamily:mono,fontSize:'9px',letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--dl-middle)'}}>Health</div>

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

          <div style={{height:8}}/>

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
                <form onSubmit={e=>{e.preventDefault();connectOura();}} style={{flex:1,minWidth:0,display:"flex"}}>
                  <input type="password" value={ouraKey}
                    onChange={e=>setOuraKey(e.target.value)}
                    placeholder="Token"
                    className="oura-token-input"
                    autoComplete="current-password"
                    style={{flex:1,minWidth:0,background:"var(--dl-surface)",border:`1px solid var(--dl-border2)`,
                      borderRadius:5,outline:"none",color:"var(--dl-strong)",fontFamily:mono,fontSize:F.sm,
                      padding:"5px 7px",boxSizing:"border-box",width:0}}/>
                </form>
              )}
            </IntegrationRow>
          </div>

          <div style={{height:8}}/>

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

          {/* Garmin — gated behind ENABLE_GARMIN feature flag */}
          {ENABLE_GARMIN && <>
          <div style={{height:8}}/>
          <div style={row}>
            <IntegrationRow
              label="Garmin"
              connected={garminConnected}
              onToggleOn={garminEmail.trim() && garminPassword.trim() && !garminLoading ? connectGarmin : ()=>{}}
              onToggleOff={disconnectGarmin}
              pendingToggle={!garminConnected && !!garminEmail.trim() && !!garminPassword.trim()}
            />
            {!garminConnected && (
              <form onSubmit={e=>{e.preventDefault();connectGarmin();}} style={{display:"flex",gap:4,marginTop:6}}>
                <input type="email" value={garminEmail}
                  onChange={e=>setGarminEmail(e.target.value)}
                  placeholder="Email"
                  autoComplete="username"
                  style={{flex:1,minWidth:0,background:"var(--dl-surface)",border:`1px solid var(--dl-border2)`,
                    borderRadius:5,outline:"none",color:"var(--dl-strong)",fontFamily:mono,fontSize:F.sm,
                    padding:"5px 7px",boxSizing:"border-box"}}/>
                <input type="password" value={garminPassword}
                  onChange={e=>setGarminPassword(e.target.value)}
                  placeholder="Password"
                  autoComplete="current-password"
                  style={{flex:1,minWidth:0,background:"var(--dl-surface)",border:`1px solid var(--dl-border2)`,
                    borderRadius:5,outline:"none",color:"var(--dl-strong)",fontFamily:mono,fontSize:F.sm,
                    padding:"5px 7px",boxSizing:"border-box"}}/>
              </form>
            )}
            {!garminConnected && garminLoading && <span style={{fontFamily:mono,fontSize:F.sm,color:"var(--dl-middle)",marginTop:4,display:"block"}}>Connecting…</span>}
            {!garminConnected && garminError && <span style={{fontFamily:mono,fontSize:F.sm,color:"var(--dl-red)",marginTop:4,display:"block"}}>{garminError}</span>}
          </div>
          </>}

          {/* ── Public profile entry — just the link / handle bootstrap.
                Editing happens on the profile page itself. ─────────────── */}
          {divider}
          <div style={row}>
            <ProfileLink token={token} />
          </div>

          {/* ── Trip auto-sync (Gmail) ───────────────────────────────────── */}
          {divider}
          <div style={{padding:'2px 16px 6px',fontFamily:mono,fontSize:'9px',letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--dl-middle)'}}>Trip auto-sync</div>
          <div style={row}>
            <TripSyncPanel token={token} />
          </div>

          {/* ── Integrations ────────────────────────────────────────────── */}
          {divider}
          <div style={{padding:'2px 16px 6px',fontFamily:mono,fontSize:'9px',letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--dl-middle)'}}>Integrations</div>

          {/* Claude MCP */}
          <div style={row}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
              <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",textTransform:"uppercase",color:"var(--dl-highlight)"}}>
                Claude MCP
              </span>
              {!claudeConnected && (
                <a href="https://claude.ai/settings/connectors?modal=add-custom-connector"
                  target="_blank" rel="noreferrer"
                  style={{fontFamily:mono,fontSize:F.sm,color:"var(--dl-middle)",textDecoration:"none",letterSpacing:"0.02em"}}>
                  add →
                </a>
              )}
              {claudeConnected && (
                <span style={{fontFamily:mono,fontSize:F.sm,color:"var(--dl-green)"}}>✓</span>
              )}
            </div>
            <div style={{
              display:"flex",alignItems:"center",gap:6,
              background:"var(--dl-surface)",border:`1px solid var(--dl-border2)`,
              borderRadius:5,padding:"6px 8px",
            }}>
              <span style={{flex:1,fontFamily:mono,fontSize:F.sm,
                userSelect:"all",letterSpacing:"0.02em",overflow:"hidden",
                textOverflow:"ellipsis",whiteSpace:"nowrap",color:"var(--dl-highlight)"}}>
                {window.location.origin}/mcp
              </span>
              <button
                onClick={()=>{
                  navigator.clipboard.writeText(window.location.origin + "/mcp");
                  setUrlCopied(true);setTimeout(()=>setUrlCopied(false),2000);
                }}
                title="Copy URL"
                style={{background:"none",border:"none",cursor:"pointer",
                  color:urlCopied?"var(--dl-green)":"var(--dl-middle)",padding:0,flexShrink:0,
                  display:"flex",alignItems:"center",lineHeight:1}}>
                {urlCopied
                  ? <span style={{fontSize:11}}>✓</span>
                  : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                }
              </button>
            </div>
          </div>

          {/* Google Tasks Import — gated behind ENABLE_GOOGLE_TASKS feature flag (doubles tasks bug) */}
          {ENABLE_GOOGLE_TASKS && <>
          <div style={{height:8}}/>
          <div style={row}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",textTransform:"uppercase",color:"var(--dl-highlight)"}}>
                Google Tasks
              </span>
              <button
                onClick={async () => {
                  setSyncing('gtasks');
                  try {
                    const res = await fetch('/api/google-tasks', { method: 'POST',
                      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ import: true }) });
                    const d = await res.json();
                    if (d.imported != null) {
                      alert(`Imported ${d.imported} tasks, skipped ${d.skipped} duplicates from ${d.lists} lists.`);
                      window.dispatchEvent(new CustomEvent('daylab:refresh', { detail: { types: ['tasks'] } }));
                    } else {
                      alert(d.error || 'Import failed — make sure Google is connected.');
                    }
                  } catch (e) { alert('Import failed'); }
                  setSyncing(null);
                }}
                disabled={syncing === 'gtasks'}
                style={{
                  fontFamily:mono, fontSize:10, letterSpacing:'0.04em', textTransform:'uppercase',
                  padding:'4px 10px', borderRadius:4, cursor:'pointer',
                  border:'1px solid var(--dl-border2)', background:'none', color:'var(--dl-highlight)',
                  opacity: syncing === 'gtasks' ? 0.5 : 1,
                }}
              >
                {syncing === 'gtasks' ? 'Importing…' : 'Import'}
              </button>
            </div>
            <div style={{fontFamily:mono,fontSize:10,color:"var(--dl-middle)",marginTop:4}}>
              Imports tasks from all Google Tasks lists as tagged Day Lab tasks.
            </div>
          </div>

          {divider}
          </>}

          {/* ── Theme ───────────────────────────────────────────────────── */}
          {divider}
          <div style={{padding:'2px 16px 6px',fontFamily:mono,fontSize:'9px',letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--dl-middle)'}}>Theme</div>

          <div style={{...row,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:'0.04em',textTransform:'uppercase',color:"var(--dl-highlight)"}}>
              Theme
            </span>
            <div style={{display:"flex",gap:2,background:"var(--dl-well)",borderRadius:6,padding:2}}>
              {[{key:"auto",label:"Auto"},{key:"light",label:"Light"},{key:"dark",label:"Dark"}].map(opt=>(
                <button key={opt.key} onClick={()=>onThemeChange(opt.key)}
                  style={{
                    fontFamily:mono,fontSize:10,letterSpacing:'0.04em',textTransform:'uppercase',
                    padding:'4px 8px',borderRadius:4,cursor:'pointer',border:'none',
                    background:(themePreference||'auto')===opt.key?"var(--dl-accent)":"transparent",
                    color:(themePreference||'auto')===opt.key?"var(--dl-bg)":"var(--dl-highlight)",
                    transition:'background 0.2s,color 0.2s',
                  }}>{opt.label}</button>
              ))}
            </div>
          </div>

          {divider}

          {/* Downloads — label + small buttons inline */}
          <div style={{...row,display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",textTransform:"uppercase",color:"var(--dl-highlight)",flex:1}}>
              Downloads
            </span>
            <a href="https://github.com/malvidah/lifeos/releases/download/v1.0.2/Day.Lab-1.0.2-arm64.dmg" style={{
              display:"flex",alignItems:"center",gap:4,
              padding:"4px 9px",background:"var(--dl-surface)",
              border:`1px solid var(--dl-border2)`,borderRadius:5,textDecoration:"none",
              color:"var(--dl-highlight)",fontFamily:mono,fontSize:9,letterSpacing:"0.06em",textTransform:"uppercase",flexShrink:0}}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Mac
            </a>
            <a href="/download/ios" style={{
              display:"flex",alignItems:"center",gap:4,
              padding:"4px 9px",background:"var(--dl-surface)",
              border:`1px solid var(--dl-border2)`,borderRadius:5,textDecoration:"none",
              color:"var(--dl-highlight)",fontFamily:mono,fontSize:9,letterSpacing:"0.06em",textTransform:"uppercase",flexShrink:0}}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12" y2="18"/>
              </svg>
              iOS
            </a>
          </div>

          {divider}

          {/* Export Data */}
          <div style={{...row,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",textTransform:"uppercase",color:"var(--dl-highlight)"}}>
              Export Data
            </span>
            <button
              onClick={async () => {
                try {
                  const res = await fetch("/api/export", {
                    headers: { Authorization: `Bearer ${token}` },
                  });
                  if (!res.ok) throw new Error("Export failed");
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  const today = new Date().toISOString().slice(0, 10);
                  a.href = url;
                  a.download = `daylab-export-${today}.zip`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  URL.revokeObjectURL(url);
                } catch (e) {
                  console.warn("Export failed:", e);
                  alert("Export failed. Please try again.");
                }
              }}
              style={{
                fontFamily:mono, fontSize:10, letterSpacing:"0.04em", textTransform:"uppercase",
                padding:"4px 10px", borderRadius:4, cursor:"pointer",
                border:"1px solid var(--dl-border2)", background:"none", color:"var(--dl-highlight)",
              }}
            >
              Download
            </button>
          </div>

          {divider}

          <div style={{...row,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <a href="/about"
              style={{background:"none",border:"none",padding:0,cursor:"pointer",
                color:"var(--dl-middle)",fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",
                textTransform:"uppercase",textDecoration:"none"}}>
              Learn More
            </a>
            <button onClick={async()=>{const s=createClient();await s.auth.signOut();}}
              style={{background:"none",border:"none",padding:0,cursor:"pointer",
                color:"var(--dl-middle)",fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",textTransform:"uppercase"}}>
              Sign Out →
            </button>
          </div>

        </div>
      )}
    </div>
  );
}

// ─── Trip auto-sync (Gmail) ──────────────────────────────────────────────────
// Pulls JSON-LD reservation data from booking emails and surfaces them as
// trip candidates the user accepts/rejects.
function TripSyncPanel({ token }) {
  const [scanning, setScanning] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [error, setError] = useState(null);
  const [scanMsg, setScanMsg] = useState(null);

  const loadPending = () => {
    if (!token) return;
    fetch('/api/trip-candidates?status=pending', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setCandidates(d?.candidates ?? []))
      .catch(() => {});
  };
  useEffect(loadPending, [token]); // eslint-disable-line

  const scan = async () => {
    if (scanning) return;
    setScanning(true); setError(null); setScanMsg(null);
    try {
      const r = await fetch('/api/auto-trips/gmail/scan?days=90', {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d?.needsReauth ? 'Need to reconnect Google with Gmail access. Sign out and back in.' : (d?.error || 'Scan failed'));
        return;
      }
      const found = d?.candidates?.length || 0;
      setScanMsg(found ? `Found ${found} new trip${found === 1 ? '' : 's'}` : 'No new trips found');
      loadPending();
    } catch (e) {
      setError('Scan failed');
    } finally {
      setScanning(false);
    }
  };

  const decide = async (id, action) => {
    setCandidates(prev => prev.filter(c => c.id !== id));
    try {
      await fetch('/api/trip-candidates', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      // Trip list might have changed — let other tabs know.
      if (action === 'accept' && typeof window !== 'undefined') {
        window.dispatchEvent(new Event('daylab:trips-changed'));
      }
    } catch {
      loadPending(); // restore on failure
    }
  };

  return (
    <div>
      <button onClick={scan} disabled={!token || scanning}
        style={{
          width: '100%', padding: '7px 10px',
          background: scanning ? 'var(--dl-surface)' : 'var(--dl-accent-15)',
          border: `1px solid var(--dl-accent-30, var(--dl-border2))`,
          borderRadius: 6, cursor: scanning ? 'default' : 'pointer',
          fontFamily: mono, fontSize: F.sm, letterSpacing: '0.04em', textTransform: 'uppercase',
          color: 'var(--dl-strong)',
        }}>
        {scanning ? 'Scanning Gmail…' : 'Scan Gmail for trips'}
      </button>
      {error && (
        <div style={{ marginTop: 6, fontFamily: mono, fontSize: F.sm, color: 'var(--dl-red, #c0392b)' }}>{error}</div>
      )}
      {scanMsg && !error && (
        <div style={{ marginTop: 6, fontFamily: mono, fontSize: F.sm, color: 'var(--dl-middle)' }}>{scanMsg}</div>
      )}
      {candidates.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontFamily: mono, fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--dl-middle)' }}>
            Pending ({candidates.length})
          </div>
          {candidates.map(c => (
            <div key={c.id} style={{
              border: '1px solid var(--dl-border)', borderRadius: 6, padding: '6px 8px',
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <div style={{ fontFamily: mono, fontSize: F.sm, color: 'var(--dl-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.name || 'Trip'}
              </div>
              {(c.start_date || c.end_date) && (
                <div style={{ fontFamily: mono, fontSize: '10px', color: 'var(--dl-middle)' }}>
                  {c.start_date}{c.end_date && c.end_date !== c.start_date ? ' → ' + c.end_date : ''}
                  {c.stops?.length ? ` · ${c.stops.length} stop${c.stops.length === 1 ? '' : 's'}` : ''}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                <button onClick={() => decide(c.id, 'accept')}
                  style={{
                    flex: 1, padding: '4px 8px', border: 'none', borderRadius: 4, cursor: 'pointer',
                    background: 'var(--dl-accent-15)', color: 'var(--dl-accent)',
                    fontFamily: mono, fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase',
                  }}>Accept</button>
                <button onClick={() => decide(c.id, 'reject')}
                  style={{
                    flex: 1, padding: '4px 8px', border: '1px solid var(--dl-border)', borderRadius: 4, cursor: 'pointer',
                    background: 'transparent', color: 'var(--dl-middle)',
                    fontFamily: mono, fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase',
                  }}>Skip</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Profile link / handle bootstrap ─────────────────────────────────────────
// Minimal entry point: if you have a handle, link to /u/[handle]. If you
// don't, a single inline input lets you claim one (then it links). All other
// profile editing (name, bio, avatar, banner, public toggle) lives on the
// profile page itself.
function ProfileLink({ token }) {
  const [handle, setHandle] = useState(null);   // null = loading, '' = not set
  const [draft, setDraft]   = useState('');
  const [error, setError]   = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch('/api/profile/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setHandle(d?.profile?.handle || ''))
      .catch(() => setHandle(''));
  }, [token]);

  if (handle === null) return <div style={{ fontFamily: mono, fontSize: F.sm, color: 'var(--dl-middle)' }}>Loading…</div>;

  if (handle) {
    return (
      <a href={`/u/${handle}`} target="_blank" rel="noreferrer" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        textDecoration: 'none', padding: '4px 0',
      }}>
        <span style={{
          fontFamily: mono, fontSize: F.sm, letterSpacing: '0.04em', textTransform: 'uppercase',
          color: 'var(--dl-strong)',
        }}>Public profile</span>
        <span style={{
          fontFamily: mono, fontSize: F.sm, color: 'var(--dl-accent)', letterSpacing: '0.02em',
        }}>@{handle} →</span>
      </a>
    );
  }

  const claim = async () => {
    const v = draft.trim().toLowerCase();
    if (!v) return;
    setSaving(true); setError(null);
    try {
      const r = await fetch('/api/profile/me', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: v }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d?.error || 'Failed'); return; }
      setHandle(d.profile.handle);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={{
        fontFamily: mono, fontSize: F.sm, letterSpacing: '0.04em', textTransform: 'uppercase',
        color: 'var(--dl-strong)', marginBottom: 6,
      }}>Public profile</div>
      <div style={{ display: 'flex', gap: 4 }}>
        <span style={{ fontFamily: mono, fontSize: F.sm, color: 'var(--dl-middle)', alignSelf: 'center' }}>@</span>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value.toLowerCase())}
          onKeyDown={e => { if (e.key === 'Enter') claim(); }}
          placeholder="pick a handle"
          style={{
            flex: 1, minWidth: 0,
            background: 'var(--dl-surface)', border: '1px solid var(--dl-border2)',
            borderRadius: 5, outline: 'none', color: 'var(--dl-strong)',
            fontFamily: mono, fontSize: F.sm, padding: '5px 7px',
          }}
        />
        <button
          onClick={claim}
          disabled={!draft.trim() || saving}
          style={{
            background: 'var(--dl-accent-15)', border: '1px solid var(--dl-accent-30, var(--dl-border2))',
            borderRadius: 5, padding: '5px 10px', cursor: draft.trim() ? 'pointer' : 'default',
            fontFamily: mono, fontSize: F.sm, color: 'var(--dl-accent)',
          }}>{saving ? '…' : 'Go'}</button>
      </div>
      {error && (
        <div style={{ fontFamily: mono, fontSize: '10px', color: 'var(--dl-red, #c0392b)', marginTop: 4 }}>{error}</div>
      )}
    </div>
  );
}

// ─── Profile settings (legacy — kept for reference, not rendered) ────────────
function ProfileSettingsPanel({ token }) {
  const [profile, setProfile] = useState(null);
  const [draft, setDraft]     = useState({});
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);
  const [savedAt, setSavedAt] = useState(0);

  useEffect(() => {
    if (!token) return;
    fetch('/api/profile/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => {
        const p = d?.profile || {};
        setProfile(p);
        setDraft({
          handle:         p.handle || '',
          display_name:   p.display_name || '',
          bio:            p.bio || '',
          profile_public: !!p.profile_public,
        });
      }).catch(() => {});
  }, [token]);

  const save = async (patch) => {
    if (!token) return;
    setSaving(true); setError(null);
    try {
      const r = await fetch('/api/profile/me', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d?.error || 'Save failed');
        return;
      }
      setProfile(d.profile);
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  };

  const handleBlur = (key) => {
    const value = draft[key] ?? '';
    if (value === (profile?.[key] || '')) return;
    save({ [key]: value });
  };

  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    background: 'var(--dl-surface)', border: '1px solid var(--dl-border2)',
    borderRadius: 5, outline: 'none', color: 'var(--dl-strong)',
    fontFamily: mono, fontSize: F.sm, padding: '6px 8px',
  };
  const labelStyle = {
    fontFamily: mono, fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase',
    color: 'var(--dl-middle)', marginBottom: 3, display: 'block',
  };

  if (!profile) return <div style={{ fontFamily: mono, fontSize: F.sm, color: 'var(--dl-middle)' }}>Loading…</div>;

  const profileUrl = profile.handle ? `/u/${profile.handle}` : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <label style={labelStyle}>Handle</label>
        <input
          value={draft.handle || ''}
          onChange={e => setDraft(d => ({ ...d, handle: e.target.value.toLowerCase() }))}
          onBlur={() => handleBlur('handle')}
          placeholder="your-handle"
          style={inputStyle}
        />
      </div>
      <div>
        <label style={labelStyle}>Display name</label>
        <input
          value={draft.display_name || ''}
          onChange={e => setDraft(d => ({ ...d, display_name: e.target.value }))}
          onBlur={() => handleBlur('display_name')}
          placeholder="Your name"
          style={inputStyle}
        />
      </div>
      <div>
        <label style={labelStyle}>Bio</label>
        <textarea
          value={draft.bio || ''}
          onChange={e => setDraft(d => ({ ...d, bio: e.target.value }))}
          onBlur={() => handleBlur('bio')}
          placeholder="One line about you"
          rows={2}
          style={{ ...inputStyle, resize: 'vertical', minHeight: 40 }}
        />
      </div>

      {/* Public toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: mono, fontSize: F.sm, color: 'var(--dl-strong)' }}>
          Profile public
        </span>
        <button
          onClick={() => {
            const next = !draft.profile_public;
            setDraft(d => ({ ...d, profile_public: next }));
            save({ profile_public: next });
          }}
          aria-pressed={!!draft.profile_public}
          style={{
            width: 36, height: 20, borderRadius: 999, border: 'none', cursor: 'pointer',
            background: draft.profile_public ? 'var(--dl-accent)' : 'var(--dl-border)',
            position: 'relative', transition: 'background 0.15s',
          }}>
          <span style={{
            position: 'absolute', top: 2, left: draft.profile_public ? 18 : 2,
            width: 16, height: 16, borderRadius: '50%', background: '#fff',
            transition: 'left 0.15s',
          }} />
        </button>
      </div>

      {error && <div style={{ fontFamily: mono, fontSize: F.sm, color: 'var(--dl-red, #c0392b)' }}>{error}</div>}
      {!error && savedAt > 0 && Date.now() - savedAt < 2000 && (
        <div style={{ fontFamily: mono, fontSize: '10px', color: 'var(--dl-middle)' }}>Saved</div>
      )}

      {profileUrl && draft.profile_public && (
        <a href={profileUrl} target="_blank" rel="noreferrer"
          style={{
            fontFamily: mono, fontSize: F.sm, letterSpacing: '0.04em', textTransform: 'uppercase',
            color: 'var(--dl-accent)', textDecoration: 'none',
            border: '1px solid var(--dl-accent-30, var(--dl-border2))',
            borderRadius: 6, padding: '6px 10px', textAlign: 'center',
          }}>
          View profile →
        </a>
      )}
    </div>
  );
}

// ─── Header ──────────────────────────────────────────────────────────────────
