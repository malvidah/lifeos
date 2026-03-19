"use client";
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { mono, F, injectBlurWebFont } from "@/lib/tokens";
import { createClient } from "@/lib/supabase";
import { api } from "@/lib/api";
import { todayKey, toKey, shift } from "@/lib/dates";
import { bustOuraCache } from "@/lib/ouraCache";
import { MEM, DIRTY, clearCacheForUser, doUndo, doRedo } from "@/lib/db";
import { useIsMobile, useCollapse } from "@/lib/hooks";
import { useProjects } from "@/lib/useProjects";
import { NoteContext, NavigationContext, ProjectNamesContext } from "@/lib/contexts";
import { Card, ErrorBoundary } from "./ui/primitives.jsx";
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
import NotesCard from "./widgets/NotesCard.jsx";
import LoginScreen from "./views/LoginScreen.jsx";
import { HomeSettingsPanel, ProjectSettingsPanel } from "./views/ProjectSettingsPanel.jsx";
import { ToastContainer } from "./ui/Toast.jsx";

// ── Dock icons (inline SVG, matching codebase style) ──────────────────────────
const DOCK_ITEMS = [
  { id: 'map',      label: 'Map',      icon: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 21l8-14 8 14H0z" transform="translate(0,-1)"/><path d="M2 21l5-8 4 5" transform="translate(0,-1)"/>
    </svg>
  )},
  { id: 'cal',      label: 'Cal',      icon: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  )},
  { id: 'health',   label: 'Health',   icon: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>
  )},
  { id: 'notes',    label: 'Notes',    icon: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
    </svg>
  )},
  { id: 'journal',  label: 'Journal',  icon: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
    </svg>
  )},
  { id: 'tasks',    label: 'Tasks',    icon: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
    </svg>
  )},
  { id: 'meals',    label: 'Meals',    icon: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>
    </svg>
  )},
  { id: 'workouts', label: 'Workouts', icon: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  )},
];

// Static widget definitions — outside component so they're not recreated each render
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
const [leftWidget, ...rightWidgets] = WIDGETS;

function DashboardInner() {
  const { theme, preference, setTheme } = useTheme();

  const [session,   setSession]   = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [selected,  setSelected]  = useState(() => {
    try { const s = localStorage.getItem('daylab:selected'); if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s; } catch {}
    return todayKey();
  });
  const [calView,   setCalView]   = useState(() => localStorage.getItem('calView') || 'day');
  const [events,    setEvents]    = useState({});
  const [healthDots,setHealthDots]= useState(()=>{
    // Load cached dots from localStorage for instant display — no grey flash
    try { const c = localStorage.getItem('daylab:healthDots'); return c ? JSON.parse(c) : {}; }
    catch { return {}; }
  });
  const [syncing,   setSyncing]   = useState(new Set());
  const [lastSync,  setLastSync]  = useState(null);
  const [stravaConnected, setStravaConnected] = useState(false);
  const [activeProject, setActiveProject] = useState(() => {
    try {
      const v = localStorage.getItem('daylab:activeProject');
      // __graph__ had special meaning in the old two-view architecture — treat as null now
      return (v && v !== '__graph__') ? v : null;
    } catch { return null; }
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const savedScrollTopRef = useRef(0);
  const scrollLockRafRef = useRef(null);

  // Wrap setActiveProject so scroll is always saved before the state change.
  const selectProject = useCallback((p) => {
    savedScrollTopRef.current = scrollContainerRef.current?.scrollTop ?? 0;
    setActiveProject(p);
  }, []);

  // After a project change: restore scrollTop synchronously (first paint),
  // then hold it via rAF loop for ~300ms to absorb async content re-renders
  // (Notes/Journal fetch new data and shift layout after initial paint).
  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const target = savedScrollTopRef.current;
    el.scrollTop = target;

    // Cancel any previous lock loop
    if (scrollLockRafRef.current) cancelAnimationFrame(scrollLockRafRef.current);

    const deadline = performance.now() + 350; // hold for 350ms
    const lock = () => {
      if (!scrollContainerRef.current) return;
      if (scrollContainerRef.current.scrollTop !== target) {
        scrollContainerRef.current.scrollTop = target;
      }
      if (performance.now() < deadline) {
        scrollLockRafRef.current = requestAnimationFrame(lock);
      }
    };
    scrollLockRafRef.current = requestAnimationFrame(lock);

    return () => {
      if (scrollLockRafRef.current) cancelAnimationFrame(scrollLockRafRef.current);
    };
  }, [activeProject]);


  // Persist selected date and active project for hard-refresh recovery
  useEffect(() => { try { localStorage.setItem('daylab:selected', selected); } catch {} }, [selected]);
  useEffect(() => { try { if (activeProject) localStorage.setItem('daylab:activeProject', activeProject); else localStorage.removeItem('daylab:activeProject'); } catch {} }, [activeProject]);

  // Theme is now handled by ThemeContext

  useEffect(injectBlurWebFont, []);



  useEffect(()=>{
    const supabase=createClient();
    const code=new URLSearchParams(window.location.search).get("code");
    if(code){supabase.auth.exchangeCodeForSession(code).then(({data:{session:s}})=>{
      window.history.replaceState({},document.title,window.location.pathname);
      // Save Google tokens immediately — provider_token is ONLY available here
      if(s?.provider_token && s?.access_token){
        api.post("/api/google-token",{googleToken:s.provider_token,refreshToken:s.provider_refresh_token||null},s.access_token).catch(()=>{});
      }
    });}
    supabase.auth.getSession().then(({data:{session}})=>{
      clearCacheForUser(session?.user?.id ?? null);
      setSession(session);setAuthReady(true);
    });
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,s)=>{
      clearCacheForUser(s?.user?.id ?? null);
      setSession(s);setAuthReady(true);
      // Save Google tokens on fresh login (provider_token only present after OAuth callback)
      if(s?.provider_token && s?.access_token){
        api.post("/api/google-token",{googleToken:s.provider_token,refreshToken:s.provider_refresh_token||null},s.access_token).catch(()=>{});
      }
    });
    return ()=>subscription.unsubscribe();
  },[]);

  const token=session?.access_token;
  const userId=session?.user?.id ?? null;

  // Project names — used by all editors for #tag autocomplete
  const [allProjectNames, setAllProjectNames] = useState([]);

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

  // Graph data — load eagerly on login so MapCard is always ready.
  // Also populates allProjectNames from the same /api/all-tags fetch to avoid a duplicate request.
  const [graphData, setGraphData] = useState(null);
  useEffect(() => {
    if (!token) return;
    if (graphData) return;
    Promise.all([
      api.get('/api/all-tags', token),
      api.get('/api/tag-connections', token),
      api.get('/api/project-stats', token),
    ]).then(([tagsRes, connsRes, statsRes]) => {
      const allTags = Array.isArray(tagsRes?.tags) ? tagsRes.tags : [];
      setAllProjectNames(allTags);
      setGraphData({
        allTags,
        connections: Array.isArray(connsRes?.connections) ? connsRes.connections : [],
        recency: connsRes?.recency || {},
        entryCounts: statsRes?.counts || {},
        completedTasks: statsRes?.completed || {},
        habits: statsRes?.habits || {},
      });
    }).catch(() => { setGraphData({ allTags: [], connections: [], recency: {}, entryCounts: {}, completedTasks: {} }); });
  }, [token]); // eslint-disable-line
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
  const [journalCollapsed,toggleJournal]  = useCollapse("journal", false);
  const [tasksCollapsed,  toggleTasks]    = useCollapse("tasks",   false);
  const [taskFilter, setTaskFilter] = useState('all');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [homeSettingsOpen, setHomeSettingsOpen] = useState(false);
  // Close settings panels whenever we navigate to a different project
  useEffect(() => { setSettingsOpen(false); setHomeSettingsOpen(false); }, [activeProject]);
  const [mealsCollapsed,  toggleMeals]    = useCollapse("meals",   false);
  const [actCollapsed,    toggleAct]      = useCollapse("workouts",false);
  const [notesCollapsed,  toggleNotes]    = useCollapse("notes",   false);
  const [mapCollapsed,    toggleMap_]     = useCollapse("map",     false);
  const collapseMap = {journal:journalCollapsed,tasks:tasksCollapsed,meals:mealsCollapsed,workouts:actCollapsed};
  const toggleMap   = {journal:toggleJournal,   tasks:toggleTasks,  meals:toggleMeals,  workouts:toggleAct};

  // ── Note names for NoteContext — shared across Journal + Notes editors ──────
  const [allNoteNames, setAllNoteNames] = useState([]);

  // ── Project recency tracking — update last_active when a project is selected ─
  const { updateProject } = useProjects(token);
  useEffect(() => {
    if (!activeProject || activeProject.startsWith('__') || !token) return;
    updateProject(activeProject, { last_active: todayKey() });
  }, [activeProject, token]); // eslint-disable-line

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

  // __graph__ is treated as no project filter (shows all notes/entries).
  // Any other non-null activeProject is a real project slug.
  const projectFilter = (activeProject && activeProject !== '__graph__') ? activeProject : null;

  return (
    <ProjectNamesContext.Provider value={allProjectNames}>
    <NoteContext.Provider value={{ notes: allNoteNames, onCreateNote: (name) => {
      window.dispatchEvent(new CustomEvent('daylab:create-note', { detail: { name } }));
    }}}>
    <ToastContainer/>
    <NavigationContext.Provider value={{
      navigateToProject: (name) => selectProject(name),
      navigateToNote: (name) => {
        window.dispatchEvent(new CustomEvent('daylab:go-to-note', { detail: { name } }));
      },
    }}>
    <div style={{background:"var(--dl-bg)",height:"100vh",color:"var(--dl-strong)",display:"flex",flexDirection:"column",overflowY:mobile?"auto":"hidden",position:"relative"}}>
      <Header session={session} token={token} userId={userId} syncStatus={syncStatus} theme={theme} themePreference={preference} onThemeChange={setTheme} selected={selected} onSelectDate={setSelected} onGoToToday={()=>setSelected(todayKey())} onGoHome={()=>{selectProject(null);setSelected(todayKey());}} stravaConnected={stravaConnected} onStravaChange={setStravaConnected}/>

      {/* ── Main scroll area ─── */}
      <div style={{flex:1, minHeight:0, overflow:"hidden", display:"flex", flexDirection:"column", alignItems:"stretch", position:"relative", zIndex:1}}>

        <HomeSettingsPanel open={homeSettingsOpen} onClose={() => setHomeSettingsOpen(false)} />
        {projectFilter && (
          <ProjectSettingsPanel
            project={projectFilter} token={token}
            open={settingsOpen} onClose={() => setSettingsOpen(false)}
            onRenamed={slug => { selectProject(slug); setSettingsOpen(false); }}
          />
        )}

        {/* ── Single unified scroll container ── */}
        <div ref={scrollContainerRef} style={{flex:1, minHeight:0, overflowY:"auto", paddingBottom:mobile?200:0, overflowAnchor:'none'}}>
        <div style={{maxWidth:1200, width:"100%", margin:"0 auto", padding:10, paddingTop:0, display:"flex", flexDirection:"column", gap:8}}>

          {/* Spacer for fixed header */}
          <div style={{height:"calc(env(safe-area-inset-top, 0px) + 84px)",flexShrink:0}}/>

          {/* NavBar — dock icons centered between settings and search */}
          <NavBar
            searchOpen={searchOpen} setSearchOpen={setSearchOpen}
            searchQuery={searchQuery} setSearchQuery={setSearchQuery}
            searchInputRef={searchInputRef} srLoading={srLoading}
            onOpenSettings={projectFilter ? () => setSettingsOpen(true) : () => setHomeSettingsOpen(true)}
            dockItems={DOCK_ITEMS.map(item => ({
              ...item,
              isOpen: item.id === 'map' ? !mapCollapsed
                : item.id === 'cal' ? !calCollapsed
                : item.id === 'health' ? !healthCollapsed
                : item.id === 'notes' ? !notesCollapsed
                : !collapseMap[item.id],
              onToggle: item.id === 'map' ? toggleMap_
                : item.id === 'cal' ? toggleCal
                : item.id === 'health' ? toggleHealth
                : item.id === 'notes' ? toggleNotes
                : toggleMap[item.id],
            }))}
          />

          {/* 2. MapCard — hidden when toggled off in dock */}
          {graphData && !searchOpen && !mapCollapsed && (
            <MapCard
              allTags={graphData.allTags}
              connections={graphData.connections}
              recency={graphData.recency}
              entryCounts={graphData.entryCounts}
              completedTasks={graphData.completedTasks}
              habits={graphData.habits}
              healthDots={healthDots}
              selectedProject={projectFilter}
              onSelectProject={selectProject}
            />
          )}

          {/* 3. CalendarCard — hidden when toggled off in dock */}
          {!searchOpen && !calCollapsed && (
            <div style={{flexShrink:0}}>
              <ErrorBoundary label="Calendar">
              <CalendarCard selected={selected} onSelect={setSelected}
                events={events} setEvents={setEvents} healthDots={healthDots}
                token={token} collapsed={false} onToggle={toggleCal}
                calView={calView} onCalViewChange={v=>{setCalView(v);}}/>
              </ErrorBoundary>
            </div>
          )}

          {/* 4. HealthCard — hidden when toggled off in dock */}
          {!searchOpen && !healthCollapsed && (
            <div style={{flexShrink:0}}>
              <ErrorBoundary label="Health">
              <HealthCard date={selected} token={token} userId={userId}
                onHealthChange={onHealthChange} onScoresReady={onScoresReady} onSyncStart={startSync} onSyncEnd={endSync}
                collapsed={false} onToggle={toggleHealth}/>
              </ErrorBoundary>
            </div>
          )}

          {/* Search results replace cards 5-9 when open */}
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
              {/* 5. Notes — hidden when toggled off in dock */}
              {!notesCollapsed && (
                <ErrorBoundary label="Notes">
                  <NotesCard project={projectFilter} token={token} userId={userId} onNoteNamesChange={setAllNoteNames} collapsed={false} onToggle={toggleNotes} />
                </ErrorBoundary>
              )}

              {/* 6–9. Journal, Tasks, Meals, Workouts */}
              {mobile ? (
                <div style={{display:"flex", flexDirection:"column", gap:10, paddingBottom:200}}>
                  {!collapseMap[leftWidget.id] && (
                    <ErrorBoundary label={leftWidget.label}>
                    <Card label={leftWidget.label} color={leftWidget.color()}
                      collapsed={false} onToggle={toggleMap[leftWidget.id]}
                      headerRight={leftWidget.headerRight?.()} autoHeight>
                      <leftWidget.Comp date={selected} token={token} userId={userId} stravaConnected={stravaConnected} project={projectFilter||undefined}/>
                    </Card>
                    </ErrorBoundary>
                  )}
                  {rightWidgets.map(w=> !collapseMap[w.id] && (
                    <ErrorBoundary key={w.id} label={w.label}>
                    <Card label={w.label} color={w.color()}
                      collapsed={false} onToggle={toggleMap[w.id]}
                      headerRight={w.id==='tasks' ? <TaskFilterBtns filter={taskFilter} setFilter={setTaskFilter}/> : w.headerRight?.()} autoHeight>
                      <w.Comp date={selected} token={token} userId={userId} stravaConnected={stravaConnected}
                        taskFilter={w.id==='tasks'?taskFilter:undefined}
                        project={w.id==='tasks'&&projectFilter?projectFilter:undefined}/>
                    </Card>
                    </ErrorBoundary>
                  ))}
                </div>
              ) : (
                <div style={{display:"flex", gap:10, flexDirection:"row", alignItems:"stretch"}}>
                  {/* Left column: Journal */}
                  {!collapseMap[leftWidget.id] && (
                    <div style={{flex:"1 1 0", minWidth:0, display:"flex", flexDirection:"column", gap:10, paddingBottom:180}}>
                      <div style={{flex:1, minHeight:320, display:"flex", flexDirection:"column"}}>
                        <ErrorBoundary label={leftWidget.label}>
                        <Card label={leftWidget.label} color={leftWidget.color()}
                          collapsed={false} onToggle={toggleMap[leftWidget.id]}
                          headerRight={leftWidget.headerRight?.()}>
                          <leftWidget.Comp date={selected} token={token} userId={userId} stravaConnected={stravaConnected} project={projectFilter||undefined}/>
                        </Card>
                        </ErrorBoundary>
                      </div>
                    </div>
                  )}
                  {/* Right widgets — Tasks, Meals, Workouts (only visible ones) */}
                  {rightWidgets.some(w => !collapseMap[w.id]) && (
                    <div style={{flex:"1 1 0", minWidth:0, display:"flex", flexDirection:"column", gap:10, paddingBottom:180}}>
                      {rightWidgets.filter(w => !collapseMap[w.id]).map((w, i, arr)=>(
                        <div key={w.id} style={{
                          display:"flex", flexDirection:"column",
                          flex: i === arr.length - 1 ? 1 : "0 0 auto",
                          minHeight: 200}}>
                          <ErrorBoundary label={w.label}>
                          <Card label={w.label} color={w.color()}
                            collapsed={false} onToggle={toggleMap[w.id]}
                            headerRight={w.id==='tasks' ? <TaskFilterBtns filter={taskFilter} setFilter={setTaskFilter}/> : w.headerRight?.()}>
                            <w.Comp date={selected} token={token} userId={userId} stravaConnected={stravaConnected}
                              taskFilter={w.id==='tasks'?taskFilter:undefined}
                              project={w.id==='tasks'&&projectFilter?projectFilter:undefined}/>
                          </Card>
                          </ErrorBoundary>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

        </div>{/* close max-width inner */}
        </div>{/* close scroll outer */}

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
    </NoteContext.Provider>
    </ProjectNamesContext.Provider>
  );
}

export default function Dashboard() {
  return <ThemeProvider><DashboardInner /></ThemeProvider>;
}
