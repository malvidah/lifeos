"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { ThemeProvider, useTheme } from "./theme/ThemeContext.jsx";
import { mono, F, injectBlurWebFont } from "./theme/tokens.js";
import { createClient } from "../lib/supabase.js";
import { todayKey, toKey, shift } from "./utils/dates.js";
import { tagDisplayName } from "./utils/tags.js";
import { bustOuraCache } from "./utils/ouraCache.js";
import { MEM, DIRTY, clearCacheForUser, doUndo, doRedo } from "./hooks/cache.js";
import { useIsMobile } from "./hooks/useIsMobile.js";
import { useCollapse } from "./hooks/useCollapse.js";
import { projectColor, Widget, Card, TaskFilterBtns, NavigationContext } from "./ui/index.jsx";
import { Header } from "./nav/Header.jsx";
import { NavBar } from "./nav/NavBar.jsx";
import { CalendarCard } from "./cards/CalendarCard.jsx";
import { HealthCard } from "./cards/HealthCard.jsx";
import { WorkoutsCard } from "./cards/WorkoutsCard.jsx";
import { MapCard } from "./cards/MapCard.jsx";
import { JournalEditor, Meals, ProjectNamesContext } from "./widgets/JournalEditor.jsx";
import { Tasks } from "./widgets/Tasks.jsx";
import { ChatFloat } from "./widgets/ChatFloat.jsx";
import { useSearch, SearchResults } from "./widgets/SearchResults.jsx";
import { LoginScreen } from "./views/LoginScreen.jsx";
import { ProjectView } from "./views/ProjectView.jsx";
import { HealthProjectView } from "./views/HealthProjectView.jsx";
import "./theme/theme.css";

function DashboardInner() {
  const { theme, setTheme, C } = useTheme();
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [selected, setSelected] = useState(todayKey);
  const [calView, setCalView] = useState(() => typeof window !== "undefined" ? localStorage.getItem('calView') || 'day' : 'day');
  const [events, setEvents] = useState({});
  const [healthDots, setHealthDots] = useState({});
  const [syncing, setSyncing] = useState(new Set());
  const [lastSync, setLastSync] = useState(null);
  const [stravaConnected, setStravaConnected] = useState(false);
  const [activeProject, setActiveProject] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef(null);

  useEffect(injectBlurWebFont, []);

  // Auth
  useEffect(() => {
    const supabase = createClient();
    const code = new URLSearchParams(window.location.search).get("code");
    if (code) supabase.auth.exchangeCodeForSession(code).then(() => window.history.replaceState({}, document.title, window.location.pathname));
    supabase.auth.getSession().then(({ data: { session } }) => { clearCacheForUser(session?.user?.id ?? null); setSession(session); setAuthReady(true); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => { clearCacheForUser(s?.user?.id ?? null); setSession(s); setAuthReady(true); });
    return () => subscription.unsubscribe();
  }, []);

  const token = session?.access_token;
  const userId = session?.user?.id ?? null;

  // Project names
  const [allProjectNames, setAllProjectNames] = useState([]);
  useEffect(() => {
    if (!token) return;
    fetch('/api/all-tags', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => { if (Array.isArray(d.tags)) setAllProjectNames(d.tags); }).catch(() => {});
  }, [token]);
  useEffect(() => {
    const handler = (e) => { const name = e.detail?.name; if (name) setAllProjectNames(prev => prev.includes(name) ? prev : [...prev, name]); };
    window.addEventListener('lifeos:create-project', handler);
    return () => window.removeEventListener('lifeos:create-project', handler);
  }, []);

  // Graph data
  const [graphData, setGraphData] = useState(null);
  useEffect(() => {
    if (activeProject !== '__graph__' || !token || graphData) return;
    Promise.all([
      fetch('/api/all-tags', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      fetch('/api/tag-connections', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    ]).then(res => setGraphData({ allTags: Array.isArray(res[0].tags) ? res[0].tags : [], connections: Array.isArray(res[1].connections) ? res[1].connections : [], recency: res[1].recency || {} }))
      .catch(() => setGraphData({ allTags: [], connections: [], recency: {} }));
  }, [activeProject, token]);

  const { results: srResults, loading: srLoading } = useSearch(searchQuery, token, userId);

  useEffect(() => { if (token) localStorage.setItem('daylab:token', token); else localStorage.removeItem('daylab:token'); }, [token]);
  useEffect(() => { localStorage.setItem('calView', calView); }, [calView]);

  // Auto-sync Oura
  const bustTodayCacheAndSync = useCallback(() => {
    if (!token || !userId) return;
    const today = todayKey();
    bustOuraCache(userId, today);
    delete MEM[userId + ':' + today + ':health'];
    delete DIRTY[userId + ':' + today + ':health'];
  }, [token, userId]);
  useEffect(() => {
    if (!token || !userId) return;
    bustTodayCacheAndSync();
    const onVis = () => { if (!document.hidden) bustTodayCacheAndSync(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [token, userId, bustTodayCacheAndSync]);

  // Scores backfill
  useEffect(() => {
    if (!token || !userId) return;
    const key = 'scores_backfill_done:' + userId;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    fetch('/api/scores-backfill', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}' })
      .then(r => r.json()).then(d => { if (d.scored > 0) console.log('[daylab] backfilled ' + d.scored + ' score entries'); }).catch(() => {});
  }, [token, userId]);

  // Pull-to-refresh
  useEffect(() => {
    const handler = () => { setSelected(todayKey()); window.dispatchEvent(new CustomEvent('lifeos:refresh', { detail: {} })); };
    window.addEventListener('daylabRefresh', handler);
    return () => window.removeEventListener('daylabRefresh', handler);
  }, []);

  // Collapse state
  const [calCollapsed, toggleCal] = useCollapse("cal", false);
  const [healthCollapsed, toggleHealth] = useCollapse("health", true);
  const [notesCollapsed, toggleNotes] = useCollapse("notes", false);
  const [tasksCollapsed, toggleTasks] = useCollapse("tasks", false);
  const [taskFilter, setTaskFilter] = useState('all');
  const [mealsCollapsed, toggleMeals] = useCollapse("meals", false);
  const [actCollapsed, toggleAct] = useCollapse("workouts", false);
  const collapseMap = { notes: notesCollapsed, tasks: tasksCollapsed, meals: mealsCollapsed, activity: actCollapsed };
  const toggleMap = { notes: toggleNotes, tasks: toggleTasks, meals: toggleMeals, activity: toggleAct };

  // Undo/redo
  useEffect(() => {
    const handler = async (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key !== 'z') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
      e.preventDefault();
      if (e.shiftKey) await doRedo(); else await doUndo();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const sessionGoogleToken = session?.provider_token;
  const sessionRefreshToken = session?.provider_refresh_token;
  const startSync = useCallback(k => setSyncing(s => new Set([...s, k])), []);
  const endSync = useCallback(k => {
    setSyncing(s => { const n = new Set(s); n.delete(k); return n; });
    setLastSync(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  }, []);

  // Calendar fetch
  const calRefreshRef = useRef(null);
  const fetchCalRef = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (e.detail?.types?.includes('calendar') && fetchCalRef.current) fetchCalRef.current(); };
    window.addEventListener('lifeos:refresh', handler);
    return () => window.removeEventListener('lifeos:refresh', handler);
  }, []);
  useEffect(() => {
    if (!token) return;
    startSync("cal");
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const start = toKey(shift(new Date(), -30)), end = toKey(shift(new Date(), 60));
    const fetchCal = () => fetch("/api/calendar", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token }, body: JSON.stringify({ start, end, tz }) })
      .then(r => r.ok ? r.json() : null).then(d => { if (d?.events) setEvents(prev => Object.assign({}, prev, d.events)); if (d?.googleToken) {} }).catch(() => {}).finally(() => endSync("cal"));
    fetchCalRef.current = fetchCal;
    if (sessionGoogleToken) {
      fetch("/api/google-token", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token }, body: JSON.stringify({ googleToken: sessionGoogleToken, refreshToken: sessionRefreshToken }) }).then(() => fetchCal()).catch(() => fetchCal());
    } else fetchCal();
    calRefreshRef.current = setInterval(fetchCal, 45 * 60 * 1000);
    return () => { if (calRefreshRef.current) clearInterval(calRefreshRef.current); };
  }, [token]);

  const onHealthChange = useCallback(() => {}, []);
  const onScoresReady = useCallback((date, d) => {
    setHealthDots(prev => {
      const p = prev[date] || {};
      return Object.assign({}, prev, { [date]: { sleep: d.sleep?.score ?? p.sleep ?? 0, readiness: d.readiness?.score ?? p.readiness ?? 0, activity: d.activity?.score ?? p.activity ?? 0, recovery: d.recovery?.score ?? p.recovery ?? 0 } });
    });
  }, []);

  // Load health dots
  useEffect(() => {
    if (!token || !userId) return;
    const supabase = createClient();
    supabase.auth.setSession({ access_token: token, refresh_token: '' });
    const since = toKey(shift(new Date(), -180)), dotsToday = todayKey();
    supabase.from('entries').select('date,data').eq('user_id', userId).eq('type', 'scores').gte('date', since).lte('date', dotsToday)
      .then(function(res) { const data = res.data; if (!data) return; const dots = {}; data.forEach(function(row) { if (!row.date || !row.data) return; dots[row.date] = { sleep: +row.data.sleepScore || 0, readiness: +row.data.readinessScore || 0, activity: +row.data.activityScore || 0, recovery: +row.data.recoveryScore || 0 }; }); setHealthDots(dots); }).catch(() => {});
  }, [token, userId]);

  const mobile = useIsMobile();
  if (!authReady) return (
    <div style={{ background: C.bg, height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ fontFamily: mono, fontSize: F.sm, color: C.muted, letterSpacing: "0.2em" }}>{"loading\u2026"}</span>
    </div>
  );
  if (!session) return <LoginScreen />;

  const syncStatus = { syncing: syncing.size > 0, lastSync: lastSync };

  const WIDGETS = [
    { id: "journal", label: "Journal", color: function() { return C.accent; }, Comp: JournalEditor },
    { id: "tasks", label: "Tasks", color: function() { return C.blue; }, Comp: Tasks },
    { id: "meals", label: "Meals", color: function() { return C.red; }, Comp: Meals, headerRight: function() { return <MealsHeader C={C} />; } },
    { id: "workouts", label: "Workouts", color: function() { return C.green; }, Comp: WorkoutsCard, headerRight: function() { return <ActHeader C={C} />; } },
  ];
  const leftWidget = WIDGETS[0];
  const rightWidgets = WIDGETS.slice(1);

  return (
    <ProjectNamesContext.Provider value={allProjectNames}>
    <NavigationContext.Provider value={{
      navigateToProject: function(name) { setActiveProject(name); },
      navigateToNote: function(name) { setActiveProject('__graph__'); setTimeout(function() { window.dispatchEvent(new CustomEvent('lifeos:go-to-note', { detail: { name: name } })); }, 150); },
    }}>
    <div style={{ background: C.bg, height: "100vh", color: C.text, display: "flex", flexDirection: "column", overflowY: mobile ? "auto" : "hidden" }}>
      <Header session={session} token={token} userId={userId} syncStatus={syncStatus} theme={theme} onThemeChange={setTheme} selected={selected} onGoToToday={function() { setSelected(todayKey()); }} onGoHome={function() { setActiveProject(null); setSelected(todayKey()); }} stravaConnected={stravaConnected} onStravaChange={setStravaConnected} />
      <div style={{ position: "fixed", top: "calc(env(safe-area-inset-top, 0px) + 38px)", left: 0, right: 0, height: 80, pointerEvents: "none", zIndex: 48, background: "linear-gradient(to bottom, " + C.bg + " 0%, " + C.bg + " 30%, transparent 100%)" }} />
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", alignItems: "stretch" }}>
      <div style={{ flex: 1, minHeight: 0, maxWidth: 1200, width: "100%", margin: "0 auto", alignSelf: "stretch", display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {!activeProject && (
          <DayView selected={selected} setSelected={setSelected} events={events} setEvents={setEvents} healthDots={healthDots} token={token} userId={userId} mobile={mobile} searchOpen={searchOpen} setSearchOpen={setSearchOpen} searchQuery={searchQuery} setSearchQuery={setSearchQuery} searchInputRef={searchInputRef} srLoading={srLoading} srResults={srResults} activeProject={activeProject} setActiveProject={setActiveProject} calCollapsed={calCollapsed} toggleCal={toggleCal} healthCollapsed={healthCollapsed} toggleHealth={toggleHealth} calView={calView} setCalView={setCalView} onHealthChange={onHealthChange} onScoresReady={onScoresReady} startSync={startSync} endSync={endSync} stravaConnected={stravaConnected} collapseMap={collapseMap} toggleMap={toggleMap} leftWidget={leftWidget} rightWidgets={rightWidgets} taskFilter={taskFilter} setTaskFilter={setTaskFilter} C={C} />
        )}

        {activeProject && (
          <ProjectRouter activeProject={activeProject} setActiveProject={setActiveProject} selected={selected} setSelected={setSelected} searchOpen={searchOpen} setSearchOpen={setSearchOpen} searchQuery={searchQuery} setSearchQuery={setSearchQuery} searchInputRef={searchInputRef} srLoading={srLoading} token={token} userId={userId} graphData={graphData} taskFilter={taskFilter} setTaskFilter={setTaskFilter} onHealthChange={onHealthChange} onScoresReady={onScoresReady} startSync={startSync} endSync={endSync} C={C} />
        )}
      </div></div>

      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: 120, pointerEvents: "none", zIndex: 96, background: "linear-gradient(to top, " + C.bg + " 0%, " + C.bg + "99 35%, transparent 100%)" }} />
      {!searchOpen && <ChatFloat date={selected} token={token} userId={userId} theme={theme} healthKey={selected + ':' + (healthDots[selected]?.sleep || 0) + ':' + (healthDots[selected]?.readiness || 0)} />}
    </div>
    </NavigationContext.Provider>
    </ProjectNamesContext.Provider>
  );
}

// Sub-components to keep the return clean
function MealsHeader({ C }) {
  return <span style={{display:"flex",gap:0}}><span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:C.dim,width:50,textAlign:"center"}}>prot</span><span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:C.dim,width:72,textAlign:"center"}}>energy</span></span>;
}
function ActHeader({ C }) {
  return <span style={{display:"flex",gap:0}}><span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:C.dim,width:60,textAlign:"center"}}>dist</span><span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:C.dim,width:100,textAlign:"center"}}>pace</span><span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:C.dim,width:72,textAlign:"center"}}>energy</span></span>;
}

function DayView({ selected, setSelected, events, setEvents, healthDots, token, userId, mobile, searchOpen, setSearchOpen, searchQuery, setSearchQuery, searchInputRef, srLoading, srResults, activeProject, setActiveProject, calCollapsed, toggleCal, healthCollapsed, toggleHealth, calView, setCalView, onHealthChange, onScoresReady, startSync, endSync, stravaConnected, collapseMap, toggleMap, leftWidget, rightWidgets, taskFilter, setTaskFilter, C }) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 10, paddingTop: 0, paddingBottom: mobile ? 200 : 0, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ height: 25, flexShrink: 0 }} />
      <NavBar activeProject={activeProject} searchOpen={searchOpen} setSearchOpen={setSearchOpen} searchQuery={searchQuery} setSearchQuery={setSearchQuery} searchInputRef={searchInputRef} srLoading={srLoading} date={selected} token={token} userId={userId} onSelectProject={setActiveProject} onBack={function() { setActiveProject(null); }} tagDisplayName={tagDisplayName} projectColor={projectColor} />
      {!searchOpen && (<>
        <div style={{ flexShrink: 0 }}><CalendarCard selected={selected} onSelect={setSelected} events={events} setEvents={setEvents} healthDots={healthDots} token={token} collapsed={calCollapsed} onToggle={toggleCal} calView={calView} onCalViewChange={function(v) { setCalView(v); }} /></div>
        <div style={{ flexShrink: 0 }}><HealthCard date={selected} token={token} userId={userId} onHealthChange={onHealthChange} onScoresReady={onScoresReady} onSyncStart={startSync} onSyncEnd={endSync} collapsed={healthCollapsed} onToggle={toggleHealth} /></div>
      </>)}
      {searchOpen ? (
        <div style={{ flex: 1, overflowY: 'auto', animation: 'fadeInUp 0.18s ease' }}><SearchResults results={srResults} loading={srLoading} query={searchQuery} onSelectDate={function(d) { setSearchOpen(false); setSearchQuery(''); setSelected(d); }} /></div>
      ) : (<>
        {mobile ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingBottom: 200 }}>
            <Widget label={leftWidget.label} color={leftWidget.color()} collapsed={collapseMap[leftWidget.id]} onToggle={toggleMap[leftWidget.id]} headerRight={leftWidget.headerRight ? leftWidget.headerRight() : null} autoHeight><leftWidget.Comp date={selected} token={token} userId={userId} stravaConnected={stravaConnected} /></Widget>
            {rightWidgets.map(function(w) { return <Widget key={w.id} label={w.label} color={w.color()} collapsed={collapseMap[w.id]} onToggle={toggleMap[w.id]} headerRight={w.id === 'tasks' ? <TaskFilterBtns filter={taskFilter} setFilter={setTaskFilter} /> : (w.headerRight ? w.headerRight() : null)} autoHeight><w.Comp date={selected} token={token} userId={userId} stravaConnected={stravaConnected} taskFilter={w.id === 'tasks' ? taskFilter : undefined} /></Widget>; })}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 10, flexDirection: "row", alignItems: "stretch" }}>
            <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", gap: 10, paddingBottom: 180 }}>
              <div style={{ flex: 1, minHeight: 320, display: "flex", flexDirection: "column" }}>
                <Widget label={leftWidget.label} color={leftWidget.color()} collapsed={collapseMap[leftWidget.id]} onToggle={toggleMap[leftWidget.id]} headerRight={leftWidget.headerRight ? leftWidget.headerRight() : null}><leftWidget.Comp date={selected} token={token} userId={userId} stravaConnected={stravaConnected} /></Widget>
              </div>
            </div>
            <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", gap: 10, paddingBottom: 180 }}>
              {rightWidgets.map(function(w, i) { return <div key={w.id} style={{ display: "flex", flexDirection: "column", flex: (!collapseMap[w.id] && i === rightWidgets.length - 1) ? 1 : "0 0 auto", minHeight: collapseMap[w.id] ? 0 : 200 }}><Widget label={w.label} color={w.color()} collapsed={collapseMap[w.id]} onToggle={toggleMap[w.id]} headerRight={w.id === 'tasks' ? <TaskFilterBtns filter={taskFilter} setFilter={setTaskFilter} /> : (w.headerRight ? w.headerRight() : null)}><w.Comp date={selected} token={token} userId={userId} stravaConnected={stravaConnected} taskFilter={w.id === 'tasks' ? taskFilter : undefined} /></Widget></div>; })}
            </div>
          </div>
        )}
      </>)}
    </div>
  );
}

function ProjectRouter({ activeProject, setActiveProject, selected, setSelected, searchOpen, setSearchOpen, searchQuery, setSearchQuery, searchInputRef, srLoading, token, userId, graphData, taskFilter, setTaskFilter, onHealthChange, onScoresReady, startSync, endSync, C }) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 10, paddingTop: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ height: 25, flexShrink: 0 }} />
      <NavBar activeProject={activeProject} searchOpen={searchOpen} setSearchOpen={setSearchOpen} searchQuery={searchQuery} setSearchQuery={setSearchQuery} searchInputRef={searchInputRef} srLoading={srLoading} date={selected} token={token} userId={userId} onSelectProject={setActiveProject} onBack={function() { setActiveProject(null); }} tagDisplayName={tagDisplayName} projectColor={projectColor} />
      {activeProject === '__graph__' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {graphData ? <MapCard allTags={graphData.allTags} connections={graphData.connections} onSelectProject={function(p) { if (p !== '__graph__') setActiveProject(p); }} token={token} userId={userId} taskFilter={taskFilter} setTaskFilter={setTaskFilter} /> : <Card style={{ height: 'auto' }}><div style={{ padding: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: mono, fontSize: F.sm, color: C.dim }}>{"Loading graph\u2026"}</div></Card>}
          <ProjectView project="__everything__" token={token} userId={userId} onBack={function() {}} onSelectDate={function(d) { setActiveProject(null); setSelected(d); }} taskFilter={taskFilter} setTaskFilter={setTaskFilter} />
        </div>
      ) : activeProject === '__health__' ? (
        <HealthProjectView token={token} userId={userId} onBack={function() { setActiveProject(null); }} onHealthChange={onHealthChange} onScoresReady={onScoresReady} startSync={startSync} endSync={endSync} onSelectDate={function(d) { setActiveProject(null); setSelected(d); }} taskFilter={taskFilter} setTaskFilter={setTaskFilter} />
      ) : (
        <ProjectView project={activeProject} token={token} userId={userId} onBack={function() { setActiveProject(null); }} onSelectDate={function(d) { setActiveProject(null); setSelected(d); }} taskFilter={taskFilter} setTaskFilter={setTaskFilter} />
      )}
    </div>
  );
}

export default function Dashboard() {
  return <ThemeProvider><DashboardInner /></ThemeProvider>;
}
