"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { mono, F, injectBlurWebFont, projectColor } from "@/lib/tokens";
import { createClient } from "@/lib/supabase";
import { api } from "@/lib/api";
import { todayKey, toKey, shift } from "@/lib/dates";
import { tagDisplayName } from "@/lib/tags";
import { bustOuraCache } from "@/lib/ouraCache";
import { MEM, DIRTY, clearCacheForUser, doUndo, doRedo } from "@/lib/db";
import { useIsMobile, useCollapse } from "@/lib/hooks";
import { NavigationContext, ProjectNamesContext } from "@/lib/contexts";
import { Card } from "./ui/primitives.jsx";
import Header from "./nav/Header.jsx";
import NavBar from "./nav/NavBar.jsx";
import CalendarCard from "./cards/CalendarCard.jsx";
import HealthCard from "./cards/HealthCard.jsx";
import WorkoutsCard from "./cards/WorkoutsCard.jsx";
import { MapCard } from "./cards/MapCard.jsx";
import { JournalEditor, Meals } from "./widgets/JournalEditor.jsx";
import Tasks, { TaskFilterBtns } from "./widgets/Tasks.jsx";
import ChatFloat from "./widgets/ChatFloat.jsx";
import { useSearch, SearchResults } from "./widgets/SearchResults.jsx";
import LoginScreen from "./views/LoginScreen.jsx";
import ProjectView from "./views/ProjectView.jsx";
import HealthProjectView from "./views/HealthProjectView.jsx";
import "./theme/theme.css";

function DashboardInner() {
  const { theme, setTheme, C } = useTheme();

  const [session,   setSession]   = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [selected,  setSelected]  = useState(todayKey);
  const [calView,   setCalView]   = useState(() => localStorage.getItem('calView') || 'day');
  const [events,    setEvents]    = useState({});
  const [healthDots,setHealthDots]= useState({});
  const [syncing,   setSyncing]   = useState(new Set());
  const [lastSync,  setLastSync]  = useState(null);
  const [googleToken,setGoogleToken] = useState(null);
  const [stravaConnected, setStravaConnected] = useState(false);
  const [activeProject, setActiveProject] = useState(null); // null = daily view, string = project name
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef(null);


  // Theme is now handled by ThemeContext

  useEffect(injectBlurWebFont, []);



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

  // Project names — fetched once on login, used by all editors for #tag autocomplete
  const [allProjectNames, setAllProjectNames] = useState([]);
  useEffect(() => {
    if (!token) return;
    api.get('/api/all-tags', token)
      .then(d => { if (Array.isArray(d?.tags)) setAllProjectNames(d.tags); })
      .catch(() => {});
  }, [token]); // eslint-disable-line

  // Listen for new project chip creation (/p + new name in any editor)
  useEffect(() => {
    const handler = (e) => {
      const name = e.detail?.name;
      if (!name) return;
      setAllProjectNames(prev => prev.includes(name) ? prev : [...prev, name]);
    };
    window.addEventListener('daylab:create-project', handler);
    return () => window.removeEventListener('daylab:create-project', handler);
  }, []); // eslint-disable-line

  // Graph data — declared HERE so token is already defined (avoids TDZ in minified bundle)
  const [graphData, setGraphData] = useState(null);
  useEffect(() => {
    if (activeProject !== '__graph__' || !token) return;
    if (graphData) return;
    Promise.all([
      api.get('/api/all-tags', token),
      api.get('/api/tag-connections', token),
    ]).then(([tagsRes, connsRes]) => {
      setGraphData({
        allTags: Array.isArray(tagsRes?.tags) ? tagsRes.tags : [],
        connections: Array.isArray(connsRes?.connections) ? connsRes.connections : [],
        recency: connsRes?.recency || {},
      });
    }).catch(() => { setGraphData({ allTags: [], connections: [], recency: {} }); });
  }, [activeProject, token]); // eslint-disable-line
  const { results: srResults, loading: srLoading } = useSearch(searchQuery, token, userId);

  // Expose token to native iOS layer (Swift reads this for HealthKit sync)
  // @supabase/ssr uses cookies not localStorage, so we bridge it manually
  useEffect(()=>{
    if(token) localStorage.setItem('daylab:token', token);
    else localStorage.removeItem('daylab:token');
  },[token]);

  useEffect(() => { localStorage.setItem('calView', calView); }, [calView]);

  // ── Auto-sync Oura on app open + visibility restore ────────────────────
  // Oura ring syncs to Oura servers automatically — we just need to fetch it.
  // Bust the module-level cache for today so HealthStrip re-fetches immediately.
  const bustTodayCacheAndSync = useCallback(() => {
    if (!token || !userId) return;
    const today = todayKey();
    // Remove today's entry from the module-level Oura cache so next render re-fetches
    bustOuraCache(userId, today);
    // Also evict today's health entry from the in-memory DB cache so useDbSave
    // re-fetches from Supabase after the fresh Oura write lands
    const healthKey = `${userId}:${today}:health`;
    delete MEM[healthKey];
    delete DIRTY[healthKey];
  }, [token, userId]);

  // Bust on mount (app open) and whenever window becomes visible again (return from background)
  useEffect(() => {
    if (!token || !userId) return;
    bustTodayCacheAndSync(); // immediate on mount
    const onVis = () => { if (!document.hidden) bustTodayCacheAndSync(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [token, userId, bustTodayCacheAndSync]); // eslint-disable-line

  // ── Silent background scores backfill — runs once per session ──────────
  // Finds any health/health_apple rows that don't have a computed scores entry
  // and fills them in. This is what populates historical trend data.
  useEffect(() => {
    if (!token || !userId) return;
    const key = `scores_backfill_done:${userId}`;
    if (sessionStorage.getItem(key)) return; // already ran this session
    sessionStorage.setItem(key, '1');
    api.post('/api/scores-backfill', {}, token)
      .then(d => { if (d?.scored > 0) console.log(`[daylab] backfilled ${d.scored} score entries`); })
      .catch(() => {}); // silent — never block the UI
  }, [token, userId]); // eslint-disable-line

  // ── Pull-to-refresh from native iOS app ────────────────────────────────
  useEffect(() => {
    const handler = () => {
      setSelected(todayKey());
      window.dispatchEvent(new CustomEvent('daylab:refresh', { detail: {} }));
    };
    window.addEventListener('daylabRefresh', handler);
    return () => window.removeEventListener('daylabRefresh', handler);
  }, []);

  // ── Collapse state ─────────────────────────────────────────────────────
  const [calCollapsed,    toggleCal]      = useCollapse("cal",     false);
  const [healthCollapsed, toggleHealth]   = useCollapse("health",  true);
  const [notesCollapsed,  toggleNotes]    = useCollapse("notes",   false);
  const [tasksCollapsed,  toggleTasks]    = useCollapse("tasks",   false);
  const [taskFilter, setTaskFilter] = useState('all');
  const [mealsCollapsed,  toggleMeals]    = useCollapse("meals",   false);
  const [actCollapsed,    toggleAct]      = useCollapse("workouts",false);
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
      if (document.activeElement?.isContentEditable) return;
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
    window.addEventListener('daylab:refresh', handler);
    return ()=>window.removeEventListener('daylab:refresh', handler);
  }, []);
  useEffect(()=>{
    if(!token)return;
    startSync("cal");
    const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
    const start=toKey(shift(new Date(),-30));
    const end=toKey(shift(new Date(),60));

    const fetchCal=()=>api.post("/api/calendar",{start,end,tz},token)
      .then(d=>{
        if(d?.events) setEvents(prev=>({...prev,...d.events}));
        if(d?.googleToken) setGoogleToken(d.googleToken);
      })
      .catch(()=>{})
      .finally(()=>endSync("cal"));

    fetchCalRef.current = fetchCal;

    // On fresh login, save the provider token first, then fetch
    if(sessionGoogleToken){
      api.post("/api/google-token",{googleToken:sessionGoogleToken,refreshToken:sessionRefreshToken},token)
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

  const MEALS_HDR = <span style={{display:"flex",gap:0}}><span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:C.dim,width:50,textAlign:"center"}}>prot</span><span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:C.dim,width:72,textAlign:"center"}}>energy</span></span>;
  const ACT_HDR = <span style={{display:"flex",gap:0}}>
    <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:C.dim,width:60,textAlign:"center"}}>dist</span>
    <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:C.dim,width:100,textAlign:"center"}}>pace</span>
    <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:C.dim,width:72,textAlign:"center"}}>energy</span>
  </span>;
  const WIDGETS = [
    {id:"journal",  label:"Journal",  color:()=>C.accent, Comp:JournalEditor},
    {id:"tasks",    label:"Tasks",    color:()=>C.blue,   Comp:Tasks},
    {id:"meals",    label:"Meals",    color:()=>C.red,    Comp:Meals,    headerRight:()=>MEALS_HDR},
    {id:"workouts", label:"Workouts", color:()=>C.green,  Comp:WorkoutsCard, headerRight:()=>ACT_HDR},
  ];
  const [leftWidget,...rightWidgets] = WIDGETS;

  return (
    <ProjectNamesContext.Provider value={allProjectNames}>
    <NavigationContext.Provider value={{
      navigateToProject: (name) => setActiveProject(name),
      navigateToNote: (name) => {
        // Navigate to __graph__ (which renders MapCard + the __everything__ ProjectView below it).
        // Navigating to __everything__ directly showed an orphaned bare list with no map.
        setActiveProject('__graph__');
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('daylab:go-to-note', { detail: { name } }));
        }, 150);
      },
    }}>
    <div style={{background:C.bg,height:"100vh",color:C.text,display:"flex",flexDirection:"column",overflowY:mobile?"auto":"hidden"}}>
      {/* Global styles now in theme.css */}

      <Header session={session} token={token} userId={userId} syncStatus={syncStatus} theme={theme} onThemeChange={setTheme} selected={selected} onGoToToday={()=>setSelected(todayKey())} onGoHome={()=>{setActiveProject(null);setSelected(todayKey());}} stravaConnected={stravaConnected} onStravaChange={setStravaConnected}/>

      {/* Vignette — fixed, same on every page */}
      <div style={{
        position:"fixed", top:"calc(env(safe-area-inset-top, 0px) + 38px)", left:0, right:0,
        height:80, pointerEvents:"none", zIndex:48,
        background:`linear-gradient(to bottom, ${C.bg} 0%, ${C.bg} 30%, transparent 100%)`,
      }}/>


      {/* ── SINGLE layout path — stacks on narrow, 2-col on wide ─── */}
        <div style={{flex:1, minHeight:0, overflow:"hidden", display:"flex", flexDirection:"column", alignItems:"stretch"}}>
        <div style={{
          flex:1, minHeight:0, maxWidth:1200, width:"100%", margin:"0 auto", alignSelf:"stretch",
          display:"flex", flexDirection:"column", overflow:"hidden"}}>

          {/* ── Day View scroll — calendar, health, cards ── */}
          {!activeProject && (
            <div style={{
              flex:1, minHeight:0, overflowY:"auto",
              padding:10, paddingTop:0,
              paddingBottom:mobile?200:0,
              display:"flex", flexDirection:"column", gap:8}}>
              {/* 25px breathing room under the top-bar vignette */}
              <div style={{height:25,flexShrink:0}}/>
              {/* NavBar — in scroll flow, same component on every page */}
              <NavBar
                activeProject={activeProject}
                searchOpen={searchOpen} setSearchOpen={setSearchOpen}
                searchQuery={searchQuery} setSearchQuery={setSearchQuery}
                searchInputRef={searchInputRef} srLoading={srLoading}
                date={selected} token={token} userId={userId}
                onSelectProject={setActiveProject}
                onBack={() => setActiveProject(null)}
                tagDisplayName={tagDisplayName} projectColor={projectColor}
              />
                              {/* Cal + Health — hidden during search */}
                {!searchOpen && (
                  <>
                    <div style={{flexShrink:0}}>
                      <CalendarCard selected={selected} onSelect={setSelected}
                        events={events} setEvents={setEvents} healthDots={healthDots}
                        token={token} collapsed={calCollapsed} onToggle={toggleCal}
                        calView={calView} onCalViewChange={v=>{setCalView(v);}}/>
                    </div>
                    <div style={{flexShrink:0}}>
                      <HealthCard date={selected} token={token} userId={userId}
                        onHealthChange={onHealthChange} onScoresReady={onScoresReady} onSyncStart={startSync} onSyncEnd={endSync}
                        collapsed={healthCollapsed} onToggle={toggleHealth}/>
                    </div>
                  </>
                )}
              {/* Search results or widgets */}
              {searchOpen ? (
                <div style={{ flex: 1, overflowY: 'auto', animation: 'fadeInUp 0.18s ease' }}>
                  <SearchResults
                    results={srResults}
                    loading={srLoading}
                    query={searchQuery}
                    onSelectDate={d => { setSearchOpen(false); setSearchQuery(''); setSelected(d); }}
                  />
                </div>
              ) : (
                <>
              {/* Widgets — row on wide, flat stack on narrow */}
              {mobile ? (
                <div style={{display:"flex", flexDirection:"column", gap:10, paddingBottom:200}}>
                  <Card label={leftWidget.label} color={leftWidget.color()}
                    collapsed={collapseMap[leftWidget.id]}
                    onToggle={toggleMap[leftWidget.id]}
                    headerRight={leftWidget.headerRight?.()} autoHeight>
                    <leftWidget.Comp date={selected} token={token} userId={userId} stravaConnected={stravaConnected}/>
                  </Card>
                  {rightWidgets.map(w=>(
                    <Card key={w.id} label={w.label} color={w.color()}
                      collapsed={collapseMap[w.id]}
                      onToggle={toggleMap[w.id]}
                      headerRight={w.id==='tasks' ? <TaskFilterBtns filter={taskFilter} setFilter={setTaskFilter}/> : w.headerRight?.()} autoHeight>
                      <w.Comp date={selected} token={token} userId={userId} stravaConnected={stravaConnected} taskFilter={w.id==='tasks'?taskFilter:undefined}/>
                    </Card>
                  ))}
                </div>
              ) : (
                <div style={{display:"flex", gap:10,
                  flexDirection:"row",
                  alignItems:"stretch"}}>

                  {/* Left column: Journal — stretches to match right col height */}
                  <div style={{flex:"1 1 0", minWidth:0,
                    display:"flex", flexDirection:"column", gap:10,
                    paddingBottom:180}}>
                    <div style={{flex:1, minHeight:320, display:"flex", flexDirection:"column"}}>
                      <Card label={leftWidget.label} color={leftWidget.color()}
                        collapsed={collapseMap[leftWidget.id]}
                        onToggle={toggleMap[leftWidget.id]}
                        headerRight={leftWidget.headerRight?.()}>
                        <leftWidget.Comp date={selected} token={token} userId={userId} stravaConnected={stravaConnected}/>
                      </Card>
                    </div>
                  </div>

                  {/* Right widgets — column always; last card stretches to fill */}
                  <div style={{flex:"1 1 0", minWidth:0,
                    display:"flex", flexDirection:"column", gap:10,
                    paddingBottom:180}}>
                    {rightWidgets.map((w, i)=>(
                      <div key={w.id} style={{
                        display:"flex", flexDirection:"column",
                        flex: (!collapseMap[w.id] && i === rightWidgets.length - 1) ? 1 : "0 0 auto",
                        minHeight: collapseMap[w.id]?0:200}}>
                        <Card label={w.label} color={w.color()}
                          collapsed={collapseMap[w.id]}
                          onToggle={toggleMap[w.id]}
                          headerRight={w.id==='tasks' ? <TaskFilterBtns filter={taskFilter} setFilter={setTaskFilter}/> : w.headerRight?.()}>
                          <w.Comp date={selected} token={token} userId={userId} stravaConnected={stravaConnected} taskFilter={w.id==='tasks'?taskFilter:undefined}/>
                        </Card>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
            </div>
          )}

          {/* ── Project view ── */}
          {activeProject && (
            (() => {
              const isGraph  = activeProject === '__graph__';
              const isHealth = activeProject === '__health__';
              const pcol = isHealth ? C.green : isGraph ? C.accent : projectColor(activeProject);
              return (
                <>
                  {/* Scrollable content */}
                  <div style={{flex:1,minHeight:0,overflow:'auto',padding:10,paddingTop:0,boxSizing:'border-box',
                    display:'flex',flexDirection:'column',gap:8}}>
                    {/* 25px breathing room + NavBar in scroll flow — same component as home view */}
                    <div style={{height:25,flexShrink:0}}/>
                    <NavBar
                      activeProject={activeProject}
                      searchOpen={searchOpen} setSearchOpen={setSearchOpen}
                      searchQuery={searchQuery} setSearchQuery={setSearchQuery}
                      searchInputRef={searchInputRef} srLoading={srLoading}
                      date={selected} token={token} userId={userId}
                      onSelectProject={setActiveProject}
                      onBack={() => setActiveProject(null)}
                      tagDisplayName={tagDisplayName} projectColor={projectColor}
                    />
                    {isGraph ? (
                      <div style={{display:'flex',flexDirection:'column',gap:10}}>
                        {graphData ? (
                          <MapCard
                            allTags={graphData.allTags}
                            connections={graphData.connections}
                            onSelectProject={p => { if (p === '__graph__') return; setActiveProject(p); }}
                            token={token} userId={userId}
                            taskFilter={taskFilter} setTaskFilter={setTaskFilter}
                          />
                        ) : (
                          <Card style={{height:'auto'}}>
                            <div style={{padding:40,display:'flex',alignItems:'center',justifyContent:'center',
                              fontFamily:mono,fontSize:F.sm,color:C.dim}}>Loading graph…</div>
                          </Card>
                        )}
                        <ProjectView
                          project="__everything__"
                          token={token} userId={userId}
                          onBack={() => {}}
                          onSelectDate={d => { setActiveProject(null); setSelected(d); }}
                          taskFilter={taskFilter} setTaskFilter={setTaskFilter}
                        />
                      </div>
                    ) : isHealth ? (
                      <HealthProjectView
                        token={token} userId={userId}
                        onBack={() => setActiveProject(null)}
                        onHealthChange={onHealthChange}
                        onScoresReady={onScoresReady}
                        startSync={startSync}
                        endSync={endSync}
                        onSelectDate={d => { setActiveProject(null); setSelected(d); }}
                        taskFilter={taskFilter} setTaskFilter={setTaskFilter}
                      />
                    ) : (
                      <ProjectView
                        project={activeProject}
                        token={token}
                        userId={userId}
                        onBack={() => setActiveProject(null)}
                        onSelectDate={d => { setActiveProject(null); setSelected(d); }}
                        taskFilter={taskFilter} setTaskFilter={setTaskFilter}
                      />
                    )}
                  </div>
                </>
              );
            })()
          )}

        </div>
        </div>

      {/* Bottom vignette — fades content up into the AI bar */}
      <div style={{
        position:"fixed", bottom:0, left:0, right:0,
        height:120, pointerEvents:"none", zIndex:96,
        background:`linear-gradient(to top, ${C.bg} 0%, ${C.bg}99 35%, transparent 100%)`,
      }}/>

      {/* Floating chat pill — hidden during search */}
      {!searchOpen && (
        <ChatFloat date={selected} token={token} userId={userId} theme={theme}
          healthKey={`${selected}:${healthDots[selected]?.sleep||0}:${healthDots[selected]?.readiness||0}`}/>
      )}
    </div>
    </NavigationContext.Provider>
    </ProjectNamesContext.Provider>
  );
}

export default function Dashboard() {
  return <ThemeProvider><DashboardInner /></ThemeProvider>;
}
