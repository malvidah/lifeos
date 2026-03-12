"use client";
import { useState, useEffect, useRef } from "react";
import { useTheme } from "@/lib/theme";
import { mono, F, R, blurweb } from "@/lib/tokens";
import { createClient } from "@/lib/supabase";
import { api } from "@/lib/api";
import { dbLoad, dbSave } from "@/lib/db";
import { ouraKey } from "@/lib/ouraCache";
import { IntegrationToggle, IntegrationRow, InfoTip, DayLabLoader } from "../ui/primitives.jsx";

export default function UserMenu({session,token,userId,theme,onThemeChange,stravaConnected,onStravaChange}) {
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
      if(d?.garminTokens?.oauth1){setGarminConnected(true);}
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
    api.get("/api/entries?date=0000-00-00&type=strava_token", token)
      .then(d=>{if(d?.data?.access_token)setStravaConnected(true);}).catch(()=>{});
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
  const divider=<div style={{height:1,background:"var(--dl-border)",margin:"10px 0"}}/>;
  const FREE_LIMIT = 10;
  const planBadge = planInfo === null ? null : planInfo.isPremium ? (
    <div style={{margin:"0 12px 10px",borderRadius:6,border:"1px solid var(--dl-accent)30",overflow:"hidden"}}>
      <div style={{padding:"10px 12px",textAlign:"center"}}>
        <div style={{fontFamily:mono,fontSize:F.sm,color:"var(--dl-accent)",letterSpacing:"0.06em",textTransform:"uppercase"}}>Premium ✦</div>
        <div style={{fontFamily:mono,fontSize:"10px",color:"var(--dl-muted)",marginTop:3}}>{planInfo.plan === 'yearly' ? 'Annual plan · $4/mo' : 'Monthly plan · $5/mo'}</div>
      </div>
      <button onClick={()=>window.location.href="/upgrade"} style={{width:"100%",padding:"7px 12px",background:"none",borderTop:"1px solid var(--dl-accent)20",border:"none",cursor:"pointer",fontFamily:mono,fontSize:"10px",color:"var(--dl-muted)",letterSpacing:"0.08em",textTransform:"uppercase",textAlign:"center"}}>
        Manage Plan →
      </button>
    </div>
  ) : (
    <div style={{margin:"0 12px 10px",borderRadius:6,border:"1px solid var(--dl-border)",overflow:"hidden"}}>
      <div style={{padding:"8px 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={{fontFamily:mono,fontSize:F.sm,color:"var(--dl-muted)",letterSpacing:"0.06em",textTransform:"uppercase"}}>Free plan</div>
          <div style={{fontFamily:mono,fontSize:"10px",color:"var(--dl-dim)",marginTop:2}}>{planInfo.insightCount}/{FREE_LIMIT} AI insights used</div>
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
      await api.post("/api/entries", {date:"global",type:"settings",data:{ouraToken:ouraKey.trim()}}, token);
      setOuraConnected(true);
      const d = await api.post("/api/oura-backfill", {}, token);
      if(!d?.ok) console.warn("Oura backfill error:", d?.error);
      api.post('/api/scores-backfill', { force: true }, token).catch(() => {});
    } catch(e) { console.warn("Oura connect failed:", e); }
    setSyncing(null);
  }

  async function disconnectOura() {
    // disconnect immediately — no prompt (confirm() is blocked in WKWebView)
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
    // disconnect immediately
    const sb = createClient();
    await sb.from("entries").delete().eq("type","health_apple").eq("user_id",userId);
    setAppleHealthHasData(false);
  }

  async function connectStrava() {
    window.location.href="/api/strava-connect";
  }

  async function connectGarmin() {
    if (!garminEmail.trim() || !garminPassword.trim()) return;
    setGarminLoading(true); setGarminError("");
    try {
      const d = await api.post("/api/garmin-auth", {email:garminEmail.trim(),password:garminPassword}, token);
      if (!d || d.error) {
        setGarminError(d?.error === "invalid_credentials" ? "Wrong email or password" : "Connection failed. Try again.");
      } else {
        setGarminConnected(true); setGarminEmail(""); setGarminPassword("");
      }
    } catch { setGarminError("Connection failed. Try again."); }
    setGarminLoading(false);
  }

  async function disconnectGarmin() {
    await api.delete("/api/garmin-auth", token);
    setGarminConnected(false); setGarminEmail(""); setGarminPassword(""); setGarminError("");
  }

  async function disconnectStrava() {
    // disconnect immediately
    const sb = createClient();
    await sb.from("entries").delete().eq("type","strava_token").eq("user_id",userId);
    setStravaConnected(false);
  }

  return (
    <div ref={ref} style={{position:"relative"}}>
      <button onClick={()=>setOpen(o=>!o)} style={{
        width:32,height:32,borderRadius:"50%",padding:0,cursor:"pointer",
        border:"1.5px solid var(--dl-border2)",background:avatar?"transparent":"var(--dl-surface)",
        overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center"}}>
        {avatar?<img src={avatar} width={32} height={32} style={{objectFit:"cover"}} alt=""/>
          :<span style={{fontFamily:mono,fontSize:F.sm,color:"var(--dl-muted)"}}>{initials}</span>}
      </button>

      {open&&(
        <div style={{
          position:"absolute",top:40,right:0,width:272,zIndex:300,
          background:"var(--dl-card)",border:"1px solid var(--dl-border2)",borderRadius:R,
          padding:"14px 0",display:"flex",flexDirection:"column",
          boxShadow:"var(--dl-shadow)",overflowY:"auto",maxHeight:"85vh",
        }}>

          {/* Identity + refresh */}
          <div style={{...row,paddingBottom:2,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div>
              <div style={{fontFamily:blurweb,fontSize:F.md,color:theme==="light"?"#6B5440":"#EFDFC3",letterSpacing:"0.04em"}}>{user?.user_metadata?.name||"—"}</div>
              <div style={{fontFamily:mono,fontSize:F.sm,color:"var(--dl-dim)",marginTop:2}}>{user?.email}</div>
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
                <path d="M841 518C841 551 842.5 578 845.5 599C849.5 619 856.5 635 866.5 647C877.5 659 892.5 667 911.5 671C930.5 675 955 677 985 677C1015 677 1039 679.5 1057 684.5C1076 689.5 1090.5 696 1100.5 704C1110.5 712 1117 721.5 1120 732.5C1124 742.5 1126 753 1126 764C1126 775 1124.5 786.5 1121.5 798.5C1119.5 809.5 1114 819.5 1105 828.5C1096 837.5 1082.5 845 1064.5 851C1046.5 857 1022 860 991 860C961 860 936 862 916 866C897 870 882 877.5 871 888.5C860 898.5 852 913 847 932C843 950 841 973 841 1001C841 1035 838.5 1061.5 833.5 1080.5C828.5 1099.5 821.5 1113.5 812.5 1122.5C804.5 1131.5 795 1137 784 1139C773 1141 762 1142 751 1142C721 1142 698.5 1133.5 683.5 1116.5C668.5 1098.5 661 1061 661 1004C661 951 651.5 914 632.5 893C614.5 871 580 860 529 860C481 860 443 854.5 415 843.5C387 831.5 373 806 373 767C373 737 383.5 714.5 404.5 699.5C426.5 684.5 466 677 523 677C551 677 574 675 592 671C610 666 624 658 634 647C645 635 652 619 655 599C659 579 661 553 661 521C661 493 663.5 470.5 668.5 453.5C673.5 436.5 680 423.5 688 414.5C696 405.5 705.5 399.5 716.5 396.5C727.5 393.5 739 392 751 392C784 392 807 403.5 820 426.5C834 448.5 841 479 841 518Z" fill={theme==="light"?"#6B5440":"#EFDFC3"}/>
                <path d="M1138 476C1138 488.667 1135.33 500.667 1130 512C1125.33 522.667 1118.67 532.333 1110 541C1102 549 1092.33 555.667 1081 561C1070.33 565.667 1059.33 568 1048 568C1036.67 568 1025.33 565.667 1014 561C1003.33 555.667 993.667 549 985 541C976.333 532.333 969.333 522.667 964 512C958.667 500.667 956 488.667 956 476C956 463.333 958.333 451.333 963 440C968.333 428.667 975 418.667 983 410C991.667 401.333 1001.33 394.667 1012 390C1023.33 384.667 1035.33 382 1048 382C1060.67 382 1072.33 384.667 1083 390C1094.33 394.667 1104 401.333 1112 410C1120 418.667 1126.33 428.667 1131 440C1135.67 451.333 1138 463.333 1138 476ZM1013 474C1013 484 1016.33 492.333 1023 499C1029.67 505.667 1038 509 1048 509C1058 509 1066.33 505.667 1073 499C1079.67 492.333 1083 484 1083 474C1083 464 1079.67 455.667 1073 449C1066.33 442.333 1058 439 1048 439C1038 439 1029.67 442.333 1023 449C1016.33 455.667 1013 464 1013 474Z" fill={theme==="light"?"#6B5440":"#EFDFC3"}/>
              </svg>
            </button>
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
                <form onSubmit={e=>{e.preventDefault();connectOura();}} style={{flex:1,minWidth:0,display:"flex"}}>
                  <input type="password" value={ouraKey}
                    onChange={e=>setOuraKey(e.target.value)}
                    placeholder="Token"
                    className="oura-token-input"
                    autoComplete="current-password"
                    style={{flex:1,minWidth:0,background:"var(--dl-surface)",border:"1px solid var(--dl-border2)",
                      borderRadius:5,outline:"none",color:"var(--dl-text)",fontFamily:mono,fontSize:F.sm,
                      padding:"5px 7px",boxSizing:"border-box",width:0}}/>
                </form>
              )}
            </IntegrationRow>
          </div>

          {divider}

          {/* Garmin */}
          <div style={row}>
            <IntegrationRow
              label="Garmin"
              connected={garminConnected}
              onToggleOn={garminEmail.trim() && garminPassword.trim() && !garminLoading ? connectGarmin : ()=>{}}
              onToggleOff={disconnectGarmin}
              pendingToggle={!garminConnected && !!garminEmail.trim() && !!garminPassword.trim()}
            >
              {!garminConnected && (
                <form onSubmit={e=>{e.preventDefault();connectGarmin();}} style={{display:"flex",flexDirection:"column",gap:4,flex:1,minWidth:0}}>
                  <input type="email" value={garminEmail}
                    onChange={e=>setGarminEmail(e.target.value)}
                    placeholder="Garmin email"
                    autoComplete="username"
                    style={{background:"var(--dl-surface)",border:"1px solid var(--dl-border2)",
                      borderRadius:5,outline:"none",color:"var(--dl-text)",fontFamily:mono,fontSize:F.sm,
                      padding:"5px 7px",width:"100%",boxSizing:"border-box"}}/>
                  <input type="password" value={garminPassword}
                    onChange={e=>setGarminPassword(e.target.value)}
                    placeholder="Garmin password"
                    autoComplete="current-password"
                    style={{background:"var(--dl-surface)",border:"1px solid var(--dl-border2)",
                      borderRadius:5,outline:"none",color:"var(--dl-text)",fontFamily:mono,fontSize:F.sm,
                      padding:"5px 7px",width:"100%",boxSizing:"border-box"}}/>
                  {garminLoading && <span style={{fontFamily:mono,fontSize:F.sm,color:"var(--dl-dim)"}}>Connecting…</span>}
                  {garminError && <span style={{fontFamily:mono,fontSize:F.sm,color:"var(--dl-red)"}}>{garminError}</span>}
                </form>
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
              <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",textTransform:"uppercase",color:"var(--dl-muted)"}}>
                Claude MCP
              </span>
              {!claudeConnected && (
                <a href="https://claude.ai/settings/connectors?modal=add-custom-connector"
                  target="_blank" rel="noreferrer"
                  style={{fontFamily:mono,fontSize:F.sm,color:"var(--dl-dim)",textDecoration:"none",letterSpacing:"0.02em"}}>
                  add →
                </a>
              )}
              {claudeConnected && (
                <span style={{fontFamily:mono,fontSize:F.sm,color:"var(--dl-green)"}}>✓</span>
              )}
            </div>
            <div style={{
              display:"flex",alignItems:"center",gap:6,
              background:"var(--dl-surface)",border:"1px solid var(--dl-border2)",
              borderRadius:5,padding:"6px 8px",
            }}>
              <span style={{flex:1,fontFamily:mono,fontSize:F.sm,
                userSelect:"all",letterSpacing:"0.02em",overflow:"hidden",
                textOverflow:"ellipsis",whiteSpace:"nowrap",color:"var(--dl-muted)"}}>
                {window.location.origin}/mcp
              </span>
              <button
                onClick={()=>{
                  navigator.clipboard.writeText(window.location.origin + "/mcp");
                  setUrlCopied(true);setTimeout(()=>setUrlCopied(false),2000);
                }}
                title="Copy URL"
                style={{background:"none",border:"none",cursor:"pointer",
                  color:urlCopied?"var(--dl-green)":"var(--dl-dim)",padding:0,flexShrink:0,
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
            <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:'0.04em',textTransform:'uppercase',color:"var(--dl-muted)"}}>
              {theme==="dark"?"Dark":"Light"} Mode
            </span>
            <button onClick={()=>onThemeChange(t=>t==="dark"?"light":"dark")}
              style={{
                background:theme==="dark"?"rgba(196,168,130,0.15)":"rgba(155,107,58,0.12)",
                border:"1px solid var(--dl-border2)",borderRadius:20,cursor:"pointer",
                padding:3,display:"flex",alignItems:"center",width:40,height:22,
                justifyContent:theme==="dark"?"flex-end":"flex-start"}}>
              <div style={{width:14,height:14,borderRadius:"50%",background:"var(--dl-accent)",transition:"all 0.2s"}}/>
            </button>
          </div>

          {divider}

          {/* Downloads — label + small buttons inline */}
          <div style={{...row,display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",textTransform:"uppercase",color:"var(--dl-muted)",flex:1}}>
              Downloads
            </span>
            <a href="https://github.com/malvidah/lifeos/releases/download/v1.0.2/Day.Lab-1.0.2-arm64.dmg" style={{
              display:"flex",alignItems:"center",gap:4,
              padding:"4px 9px",background:"var(--dl-surface)",
              border:"1px solid var(--dl-border2)",borderRadius:5,textDecoration:"none",
              color:"var(--dl-muted)",fontFamily:mono,fontSize:9,letterSpacing:"0.06em",textTransform:"uppercase",flexShrink:0}}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Mac
            </a>
            <a href="/download/ios" style={{
              display:"flex",alignItems:"center",gap:4,
              padding:"4px 9px",background:"var(--dl-surface)",
              border:"1px solid var(--dl-border2)",borderRadius:5,textDecoration:"none",
              color:"var(--dl-muted)",fontFamily:mono,fontSize:9,letterSpacing:"0.06em",textTransform:"uppercase",flexShrink:0}}>
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
                color:"var(--dl-dim)",fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",
                textTransform:"uppercase",textDecoration:"none"}}>
              Learn More
            </a>
            <button onClick={async()=>{const s=createClient();await s.auth.signOut();}}
              style={{background:"none",border:"none",padding:0,cursor:"pointer",
                color:"var(--dl-dim)",fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",textTransform:"uppercase"}}>
              Sign Out →
            </button>
          </div>

        </div>
      )}
    </div>
  );
}

// ─── Header ──────────────────────────────────────────────────────────────────
