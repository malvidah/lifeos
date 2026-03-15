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
import { Card, ErrorBoundary } from "./ui/primitives.jsx";
import WeatherBackground from "./ui/WeatherBackground.jsx";
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
import { HomeSettingsPanel } from "./views/ProjectSettingsPanel.jsx";
import { ToastContainer } from "./ui/Toast.jsx";

function DashboardInner() {
  const { theme, setTheme } = useTheme();

  const [session,   setSession]   = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [selected,  setSelected]  = useState(todayKey);
  const [calView,   setCalView]   = useState(() => localStorage.getItem('calView') || 'day');
  const [events,    setEvents]    = useState({});
  const [healthDots,setHealthDots]= useState(()=>{
    // Load cached dots from localStorage for instant display — no grey flash
    try { const c = localStorage.getItem('daylab:healthDots'); return c ? JSON.parse(c) : {}; }
    catch { return {}; }
  });
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
  // Finds any health_metrics rows that don't have a computed scores entry
  // and fills them in. Always reloads dots afterward so calendar is current.
  useEffect(() => {
    if (!token || !userId) return;
    const key = `scores_backfill_done:${userId}`;
    if (sessionStorage.getItem(key)) return; // already ran this session
    sessionStorage.setItem(key, '1');
    api.post('/api/scores-backfill', {}, token)
      .then(d => {
        console.log(`[daylab] scores-backfill result:`, d);
        loadDots(); // always reload — shows correct colored vs grey dots
      })
      .catch(e => {
        console.warn('[daylab] scores-backfill failed:', e);
        // Backfill failed (likely timeout) — clear flag so it retries next session
        sessionStorage.removeItem(key);
      });
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [homeSettingsOpen, setHomeSettingsOpen] = useState(false);
  // Close settings whenever we navigate to a different project
  useEffect(() => { setSettingsOpen(false); setHomeSettingsOpen(false); }, [activeProject]);
  const [mealsCollapsed,  toggleMeals]    = useCollapse("meals",   false);
  const [actCollapsed,    toggleAct]      = useCollapse("workouts",false);
  const collapseMap = {journal:notesCollapsed,tasks:tasksCollapsed,meals:mealsCollapsed,workouts:actCollapsed};
  const toggleMap   = {journal:toggleNotes,  tasks:toggleTasks,  meals:toggleMeals,  workouts:toggleAct};

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

    const fetchCal=()=>api.get(`/api/calendar?start=${start}&end=${end}&tz=${encodeURIComponent(tz)}`,token)
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

  // Persist dots to localStorage so they're instant on next page load
  useEffect(()=>{
    if(Object.keys(healthDots).length > 0) {
      try { localStorage.setItem('daylab:healthDots', JSON.stringify(healthDots)); } catch {}
    }
  },[healthDots]);

  // Load health dots from health_scores table.
  const loadDots = useCallback(()=>{
    if(!token||!userId)return;
    const since=toKey(shift(new Date(),-730)); // ~2 years of history
    // Use the API helper (authenticated fetch) instead of direct Supabase client
    // to avoid session/RLS issues with the browser client
    api.get(`/api/health/scores?start=${since}&end=${todayKey()}`, token)
      .then(data=>{
        console.log(`[daylab] loadDots: ${data?.rows?.length ?? 0} score rows loaded`);
        if(!data?.rows)return;
        setHealthDots(prev => {
          const next = {...prev};
          data.rows.forEach(row=>{
            if(!row.date)return;
            next[row.date]={
              sleep:    row.sleep_score     ||0,
              readiness:row.readiness_score ||0,
              activity: row.activity_score  ||0,
              recovery: row.recovery_score  ||0,
            };
          });
          return next;
        });
      }).catch(()=>{});
  },[token,userId]);

  useEffect(()=>{ loadDots(); },[loadDots]);

  // Reload dots when integrations finish backfilling (e.g. Oura connect)
  useEffect(()=>{
    const handler = () => loadDots();
    window.addEventListener('daylab:reload-dots', handler);
    return () => window.removeEventListener('daylab:reload-dots', handler);
  },[loadDots]);

  const mobile = useIsMobile();
  if(!authReady) return (
    <div style={{background:"var(--dl-bg)",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <span style={{fontFamily:mono,fontSize:F.sm,color:"var(--dl-highlight)",letterSpacing:"0.2em"}}>loading…</span>
    </div>
  );
  if(!session) return <LoginScreen/>;

  const syncStatus={syncing:syncing.size>0,lastSync};

  const MEALS_HDR = <span style={{display:"flex",gap:0}}><span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:"var(--dl-middle)",width:50,textAlign:"center"}}>prot</span><span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:"var(--dl-middle)",width:72,textAlign:"center"}}>energy</span></span>;
  const ACT_HDR = <span style={{display:"flex",gap:0}}>
    <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:"var(--dl-middle)",width:60,textAlign:"center"}}>dist</span>
    <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:"var(--dl-middle)",width:100,textAlign:"center"}}>pace</span>
    <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:"var(--dl-middle)",width:72,textAlign:"center"}}>energy</span>
  </span>;
  const WIDGETS = [
    {id:"journal",  label:"Journal",  color:()=>"var(--dl-accent)", Comp:JournalEditor},
    {id:"tasks",    label:"Tasks",    color:()=>"var(--dl-blue)",   Comp:Tasks},
    {id:"meals",    label:"Meals",    color:()=>"var(--dl-red)",    Comp:Meals,    headerRight:()=>MEALS_HDR},
    {id:"workouts", label:"Workouts", color:()=>"var(--dl-green)",  Comp:WorkoutsCard, headerRight:()=>ACT_HDR},
  ];
  const [leftWidget,...rightWidgets] = WIDGETS;

  return (
    <ProjectNamesContext.Provider value={allProjectNames}>
    <ToastContainer/>
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
    <div style={{background:activeProject?"var(--dl-bg)":"transparent",height:"100vh",color:"var(--dl-strong)",display:"flex",flexDirection:"column",overflowY:mobile?"auto":"hidden",position:"relative"}}>
      {/* Weather gradient — full viewport, behind everything. Visible through
          glassmorphic elements (nav bar, chat float) that use backdrop-filter.
          Cards have opaque backgrounds and sit on top. */}
      {!activeProject && <WeatherBackground date={selected} theme={theme}/>}

      <Header session={session} token={token} userId={userId} syncStatus={syncStatus} theme={theme} onThemeChange={setTheme} selected={selected} onGoToToday={()=>setSelected(todayKey())} onGoHome={()=>{setActiveProject(null);setSelected(todayKey());}} stravaConnected={stravaConnected} onStravaChange={setStravaConnected}/>

      {/* Vignette — fixed, same on every page */}
      <div style={{
        position:"fixed", top:"calc(env(safe-area-inset-top, 0px) + 38px)", left:0, right:0,
        height:80, pointerEvents:"none", zIndex:48,
        background:"linear-gradient(to bottom, var(--dl-bg) 0%, var(--dl-bg) 30%, transparent 100%)",
      }}/>


      {/* ── SINGLE layout path — stacks on narrow, 2-col on wide ─── */}
        <div style={{flex:1, minHeight:0, overflow:"hidden", display:"flex", flexDirection:"column", alignItems:"stretch", position:"relative", zIndex:1}}>
        <div style={{
          flex:1, minHeight:0, maxWidth:1200, width:"100%", margin:"0 auto", alignSelf:"stretch",
          display:"flex", flexDirection:"column", overflow:"hidden"}}>

          <HomeSettingsPanel open={homeSettingsOpen} onClose={() => setHomeSettingsOpen(false)} />

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
                date={selected}
                searchOpen={searchOpen} setSearchOpen={setSearchOpen}
                searchQuery={searchQuery} setSearchQuery={setSearchQuery}
                searchInputRef={searchInputRef} srLoading={srLoading}
                onGoHome={() => { setActiveProject(null); setSelected(todayKey()); }}
                onGoToProjects={() => setActiveProject('__graph__')}
                onSelectDate={setSelected}
                onOpenSettings={() => setHomeSettingsOpen(true)}
              />
                              {/* Cal + Health — hidden during search */}
                {!searchOpen && (
                  <>
                    <div style={{flexShrink:0}}>
                      <ErrorBoundary label="Calendar">
                      <CalendarCard selected={selected} onSelect={setSelected}
                        events={events} setEvents={setEvents} healthDots={healthDots}
                        token={token} collapsed={calCollapsed} onToggle={toggleCal}
                        calView={calView} onCalViewChange={v=>{setCalView(v);}}/>
                      </ErrorBoundary>
                    </div>
                    <div style={{flexShrink:0}}>
                      <ErrorBoundary label="Health">
                      <HealthCard date={selected} token={token} userId={userId}
                        onHealthChange={onHealthChange} onScoresReady={onScoresReady} onSyncStart={startSync} onSyncEnd={endSync}
                        collapsed={healthCollapsed} onToggle={toggleHealth}/>
                      </ErrorBoundary>
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
                  <ErrorBoundary label={leftWidget.label}>
                  <Card label={leftWidget.label} color={leftWidget.color()}
                    collapsed={collapseMap[leftWidget.id]}
                    onToggle={toggleMap[leftWidget.id]}
                    headerRight={leftWidget.headerRight?.()} autoHeight>
                    <leftWidget.Comp date={selected} token={token} userId={userId} stravaConnected={stravaConnected}/>
                  </Card>
                  </ErrorBoundary>
                  {rightWidgets.map(w=>(
                    <ErrorBoundary key={w.id} label={w.label}>
                    <Card label={w.label} color={w.color()}
                      collapsed={collapseMap[w.id]}
                      onToggle={toggleMap[w.id]}
                      headerRight={w.id==='tasks' ? <TaskFilterBtns filter={taskFilter} setFilter={setTaskFilter}/> : w.headerRight?.()} autoHeight>
                      <w.Comp date={selected} token={token} userId={userId} stravaConnected={stravaConnected} taskFilter={w.id==='tasks'?taskFilter:undefined}/>
                    </Card>
                    </ErrorBoundary>
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
                      <ErrorBoundary label={leftWidget.label}>
                      <Card label={leftWidget.label} color={leftWidget.color()}
                        collapsed={collapseMap[leftWidget.id]}
                        onToggle={toggleMap[leftWidget.id]}
                        headerRight={leftWidget.headerRight?.()}>
                        <leftWidget.Comp date={selected} token={token} userId={userId} stravaConnected={stravaConnected}/>
                      </Card>
                      </ErrorBoundary>
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
                        <ErrorBoundary label={w.label}>
                        <Card label={w.label} color={w.color()}
                          collapsed={collapseMap[w.id]}
                          onToggle={toggleMap[w.id]}
                          headerRight={w.id==='tasks' ? <TaskFilterBtns filter={taskFilter} setFilter={setTaskFilter}/> : w.headerRight?.()}>
                          <w.Comp date={selected} token={token} userId={userId} stravaConnected={stravaConnected} taskFilter={w.id==='tasks'?taskFilter:undefined}/>
                        </Card>
                        </ErrorBoundary>
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
              const pcol = isGraph ? "var(--dl-accent)" : projectColor(activeProject);
              return (
                <>
                  {/* Scrollable content */}
                  <div style={{flex:1,minHeight:0,overflow:'auto',padding:10,paddingTop:0,boxSizing:'border-box',
                    display:'flex',flexDirection:'column',gap:8}}>
                    {/* 25px breathing room + NavBar in scroll flow — same component as home view */}
                    <div style={{height:25,flexShrink:0}}/>
                    <NavBar
                      activeProject={activeProject}
                      date={selected}
                      searchOpen={searchOpen} setSearchOpen={setSearchOpen}
                      searchQuery={searchQuery} setSearchQuery={setSearchQuery}
                      searchInputRef={searchInputRef} srLoading={srLoading}
                      onGoHome={() => { setActiveProject(null); setSelected(todayKey()); }}
                      onGoToProjects={() => setActiveProject('__graph__')}
                      onOpenSettings={() => setSettingsOpen(true)}
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
                              fontFamily:mono,fontSize:F.sm,color:"var(--dl-middle)"}}>Loading graph…</div>
                          </Card>
                        )}
                        <ErrorBoundary label="Project">
                        <ProjectView
                          project="__everything__"
                          token={token} userId={userId}
                          onBack={() => {}}
                          onSelectDate={d => { setActiveProject(null); setSelected(d); }}
                          taskFilter={taskFilter} setTaskFilter={setTaskFilter}
                        />
                        </ErrorBoundary>
                      </div>
                    ) : (
                      <ErrorBoundary label="Project">
                      <ProjectView
                        project={activeProject}
                        token={token}
                        userId={userId}
                        onBack={() => setActiveProject(null)}
                        onSelectDate={d => { setActiveProject(null); setSelected(d); }}
                        taskFilter={taskFilter} setTaskFilter={setTaskFilter}
                        settingsOpen={settingsOpen}
                        onCloseSettings={() => setSettingsOpen(false)}
                        onRenamed={slug => { setActiveProject(slug); setSettingsOpen(false); }}
                      />
                      </ErrorBoundary>
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
        background:"linear-gradient(to top, var(--dl-bg) 0%, var(--dl-bg)99 35%, transparent 100%)",
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
