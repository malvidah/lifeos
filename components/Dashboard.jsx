"use client";
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { mono, F, injectBlurWebFont } from "@/lib/tokens";
import { createClient } from "@/lib/supabase";
import { api } from "@/lib/api";
import { todayKey, toKey, shift } from "@/lib/dates";
import { isValidDate } from "@/lib/validate";
import { tagDisplayName } from "@/lib/tags";
import { bustOuraCache } from "@/lib/ouraCache";
import { saveLocationIfNeeded } from "@/lib/weather";
import { MEM, DIRTY, clearCacheForUser, doUndo, doRedo } from "@/lib/db";
import { useIsMobile, useCollapse } from "@/lib/hooks";
import { useDashboardLayout } from "@/lib/useDashboardLayout";
import { useProjects } from "@/lib/useProjects";
import { NoteContext, NavigationContext, ProjectNamesContext, PlaceNamesContext } from "@/lib/contexts";
import Header from "./nav/Header.jsx";
import NavBar from "./nav/NavBar.jsx";
import ChatFloat from "./widgets/ChatFloat.jsx";
import { useSearch, SearchResults } from "./widgets/SearchResults.jsx";
import LoginScreen from "./views/LoginScreen.jsx";
import { ToastContainer } from "./ui/Toast.jsx";
import WelcomeOverlay from "./ui/WelcomeOverlay.jsx";
import ShortcutCheatsheet from "./ui/ShortcutCheatsheet.jsx";
import { OfflineIndicator } from "./ui/OfflineBanner.jsx";
import { useRealtimeSync } from "@/lib/useRealtimeSync";
import { CARD_REGISTRY } from "./dashboard/cardRegistry";
import PageContainer from "./dashboard/PageContainer";
import PageDots from "./dashboard/PageDots";
import { DraggableCard } from "./dashboard/DraggableCard";
import { DndContext, closestCenter, useSensor, useSensors, PointerSensor, TouchSensor } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";

// ── Dock items derived from card registry ─────────────────────────────────────
const DOCK_ORDER = ['project-graph','world-map','cal','goals','health','habits','notes','tasks','journal','meals','workouts'];
const DOCK_ITEMS = DOCK_ORDER.map(id => { const c = CARD_REGISTRY.find(r => r.id === id); return { id, label: c.label.replace(/^.*?\s/, ''), icon: c.icon }; });


// ── URL-based date state ─────────────────────────────────────────────────────
// Reads ?date=YYYY-MM-DD from URL; defaults to today if absent or invalid.
// setSelected updates the URL via pushState so browser back/forward works.
function readDateFromUrl() {
  const p = new URLSearchParams(window.location.search).get('date');
  return (p && isValidDate(p)) ? p : todayKey();
}
function useUrlDate() {
  const [selected, _setSelected] = useState(readDateFromUrl);

  // Sync state when browser back/forward fires popstate
  useEffect(() => {
    const onPop = () => _setSelected(readDateFromUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const setSelected = useCallback(valOrFn => {
    _setSelected(prev => {
      const next = typeof valOrFn === 'function' ? valOrFn(prev) : valOrFn;
      if (next === prev) return prev;
      const url = new URL(window.location.href);
      if (next === todayKey()) {
        url.searchParams.delete('date');
      } else {
        url.searchParams.set('date', next);
      }
      window.history.pushState({}, '', url);
      return next;
    });
  }, []);

  return [selected, setSelected];
}

function DashboardInner() {
  const { theme, preference, setTheme } = useTheme();

  const [session,   setSession]   = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [selected,  setSelected]  = useUrlDate();
  const [chatExpanded, setChatExpanded] = useState(false);
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
  const [journalMode, setJournalMode] = useState('recent');
  const [activeProject, setActiveProject] = useState(() => {
    try {
      const v = localStorage.getItem('daylab:activeProject');
      // __graph__ had special meaning in the old two-view architecture — treat as null now
      return (v && v !== '__graph__') ? v : null;
    } catch { return null; }
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
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

  // Auto-advance selected date at midnight — only if user was on the previous "today"
  const prevTodayRef = useRef(todayKey());
  useEffect(() => {
    const check = () => {
      const today = todayKey();
      const prevToday = prevTodayRef.current;
      if (today !== prevToday) {
        // Midnight crossed — advance only if user was viewing the old today
        setSelected(prev => prev === prevToday ? today : prev);
        prevTodayRef.current = today;
      }
    };
    const timer = setInterval(check, 30_000);
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVis); };
  }, []);

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

  // ── Real-time sync across devices (Supabase Realtime) ──────────────
  useRealtimeSync(userId, token);

  // Project names — used by all editors for #tag autocomplete
  const [allProjectNames, setAllProjectNames] = useState([]);

  // Place names — used by editors for /l autocomplete
  const [allPlaceNames, setAllPlaceNames] = useState([]);
  useEffect(() => {
    if (!token) return;
    api.get('/api/places', token).then(d => {
      setAllPlaceNames((d?.places ?? []).map(p => p.name));
    });
  }, [token]);
  // Listen for new place chip creation (/l + new name)
  useEffect(() => {
    const handler = (e) => {
      const name = e.detail?.name;
      if (name) setAllPlaceNames(prev => prev.includes(name) ? prev : [...prev, name]);
    };
    window.addEventListener('daylab:create-place', handler);
    return () => window.removeEventListener('daylab:create-place', handler);
  }, []);

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

  // Save today's location to DB on first load (fire-and-forget)
  useEffect(() => { saveLocationIfNeeded(token); }, [token]);

  // Replay offline queue once authenticated
  useEffect(() => {
    if (token) import('@/lib/offlineQueue').then(m => m.replayIfNeeded(token));
  }, [token]);

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
        loadDots(); // always reload — shows correct colored vs grey dots
      })
      .catch(() => {
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

  // ── Filter/view state (kept — used by card internals) ──────────────────
  const [habitFilter, setHabitFilter_] = useState(() => {
    try { return localStorage.getItem('daylab:habitFilter') || 'all'; } catch { return 'all'; }
  });
  const setHabitFilter = useCallback((f) => {
    setHabitFilter_(f);
    try { localStorage.setItem('daylab:habitFilter', f); } catch {}
  }, []);
  const [taskFilter, setTaskFilter] = useState('all');
  const [goalsViewMode, setGoalsViewMode] = useState('kanban');
  // World-map collapse kept for navigateToPlace behavior
  const [timelineCollapsed, toggleTimeline] = useCollapse("world-map", true);

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

  // onScoresReady: called by HealthStrip when /api/health/scores returns fresh computed scores.
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
  const layout = useDashboardLayout(token, mobile);

  // ── Layout edit mode ─────────────────────────────────────────────────────
  // Triggered by a 500ms long-press on any card header (via DraggableCard).
  const [editMode, setEditMode] = useState(false);
  const enterEditMode = useCallback(() => setEditMode(true),  []);
  const exitEditMode  = useCallback(() => setEditMode(false), []);

  // Close edit mode when the user switches pages (swipe while editing isn't
  // possible, but programmatic page switches still work).
  const prevPageRef = useRef(layout.currentPageIdx);
  useEffect(() => {
    if (prevPageRef.current !== layout.currentPageIdx) {
      prevPageRef.current = layout.currentPageIdx;
      setEditMode(false);
    }
  }, [layout.currentPageIdx]);

  // dnd-kit sensors — PointerSensor with a 5px distance threshold so a tap
  // on the drag handle doesn't immediately fire a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 50, tolerance: 5 } }),
  );

  // Persist currentPageIdx to localStorage so it survives refresh
  useEffect(() => {
    if (layout.loaded) {
      try { localStorage.setItem('daylab:pageIdx', String(layout.currentPageIdx)); } catch {}
    }
  }, [layout.currentPageIdx, layout.loaded]);
  // Restore on load
  useEffect(() => {
    if (layout.loaded) {
      try {
        const saved = parseInt(localStorage.getItem('daylab:pageIdx'), 10);
        if (!isNaN(saved) && saved > 0 && saved < layout.pages.length) {
          layout.setCurrentPageIdx(saved);
        }
      } catch {}
    }
  }, [layout.loaded]); // eslint-disable-line

  const syncStatus={syncing:syncing.size>0,lastSync};

  // __graph__ is treated as no project filter (shows all notes/entries).
  // Any other non-null activeProject is a real project slug.
  const projectFilter = (activeProject && activeProject !== '__graph__') ? activeProject : null;

  const activeProjectName = projectFilter
    ? (tagDisplayName ? tagDisplayName(projectFilter) : projectFilter)
    : 'All Projects';

  // Props bag passed to every card's render function from the registry
  const cardProps = {
    date: selected, setSelected, token, userId, projectFilter, selectProject,
    graphData, healthDots, events, setEvents, calView, setCalView,
    stravaConnected, journalMode, setJournalMode,
    goalsViewMode, setGoalsViewMode, habitFilter, setHabitFilter,
    taskFilter, setTaskFilter, startSync, endSync, onHealthChange, onScoresReady,
    searchOpen, allNoteNames, setAllNoteNames,
  };

  // Current page's card IDs — used for dock active state
  const currentPageCards = layout.pages[layout.currentPageIdx]?.cards || [];

  // renderPage: renders all cards for a given page config.
  // Wraps cards in DndContext + SortableContext so drag-to-reorder works in
  // edit mode without touching any individual card component.
  const renderPage = useCallback((page, pageIdx) => {
    const handleDragEnd = (event) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const ids = page.cards;
      const oldIdx = ids.indexOf(String(active.id));
      const newIdx = ids.indexOf(String(over.id));
      if (oldIdx === -1 || newIdx === -1) return;
      layout.reorderCards(pageIdx, arrayMove(ids, oldIdx, newIdx));
    };

    return (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={page.cards} strategy={verticalListSortingStrategy}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10, paddingTop: 0, maxWidth: 1200, width: '100%', margin: '0 auto' }}>
            {page.cards.map(cardId => {
              const entry = CARD_REGISTRY.find(c => c.id === cardId);
              if (!entry) return null;
              return (
                <DraggableCard
                  key={cardId}
                  cardId={cardId}
                  editMode={editMode}
                  onEnterEditMode={enterEditMode}
                  onRemove={() => layout.removeCard(pageIdx, cardId)}
                >
                  {entry.render(cardProps)}
                </DraggableCard>
              );
            })}
            <div style={{ paddingBottom: 200 }} />
          </div>
        </SortableContext>
      </DndContext>
    );
  }, [cardProps, editMode, enterEditMode, layout, sensors]);

  // Early returns AFTER all hooks
  if(!authReady) return (
    <div style={{background:"var(--dl-bg)",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <span style={{fontFamily:mono,fontSize:F.sm,color:"var(--dl-highlight)",letterSpacing:"0.2em"}}>loading…</span>
    </div>
  );
  if(!session) return <LoginScreen/>;

  return (
    <ProjectNamesContext.Provider value={allProjectNames}>
    <PlaceNamesContext.Provider value={allPlaceNames}>
    <NoteContext.Provider value={{ notes: allNoteNames, onCreateNote: (name) => {
      window.dispatchEvent(new CustomEvent('daylab:create-note', { detail: { name } }));
    }}}>
    <ToastContainer/>
    <WelcomeOverlay/>
    <NavigationContext.Provider value={{
      navigateToProject: (name) => selectProject(name),
      navigateToNote: (name) => {
        window.dispatchEvent(new CustomEvent('daylab:go-to-note', { detail: { name } }));
      },
      navigateToPlace: (name) => {
        // Ensure world map is visible before navigating
        if (timelineCollapsed) {
          toggleTimeline();
          // Delay event until map component mounts and registers listener
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('daylab:go-to-place', { detail: { name } }));
          }, 500);
        } else {
          window.dispatchEvent(new CustomEvent('daylab:go-to-place', { detail: { name } }));
        }
      },
    }}>
    <div style={{background:"var(--dl-bg)",height:"100vh",color:"var(--dl-strong)",display:"flex",flexDirection:"column",overflowY:mobile?"auto":"hidden",position:"relative"}}>
      <Header session={session} token={token} userId={userId} syncStatus={syncStatus} theme={theme} themePreference={preference} onThemeChange={setTheme} selected={selected} onSelectDate={setSelected} onGoToToday={()=>setSelected(todayKey())} onGoHome={()=>{selectProject(null);setSelected(todayKey());}} stravaConnected={stravaConnected} onStravaChange={setStravaConnected}/>

      {/* ── Main scroll area ─── */}
      <div style={{flex:1, minHeight:0, overflow:"hidden", display:"flex", flexDirection:"column", alignItems:"stretch", position:"relative", zIndex:1}}>

        {/* ── Fixed nav + header spacer ── */}
        <div ref={scrollContainerRef} style={{flex:1, minHeight:0, display:"flex", flexDirection:"column", overflowY: searchOpen ? 'auto' : 'hidden'}}>
        <div style={{maxWidth:1200, width:"100%", margin:"0 auto", padding:10, paddingTop:0, display:"flex", flexDirection:"column", gap:8, flexShrink:0}}>

          {/* Spacer for fixed header */}
          <div style={{height:"calc(env(safe-area-inset-top, 0px) + 100px)",flexShrink:0}}/>

          {/* NavBar — dock icons centered between settings and search */}
          <NavBar
            searchOpen={searchOpen} setSearchOpen={setSearchOpen}
            searchQuery={searchQuery} setSearchQuery={setSearchQuery}
            searchInputRef={searchInputRef} srLoading={srLoading}
            toolsOpen={toolsOpen} setToolsOpen={setToolsOpen}
            activeProjectName={activeProjectName}
            onBack={activeProject ? () => { selectProject(null); setSelected(todayKey()); } : null}
            dockItems={DOCK_ITEMS.map(item => ({
              ...item,
              isOpen: currentPageCards.includes(item.id),
              onToggle: () => {
                const pageIdx = layout.currentPageIdx;
                if (currentPageCards.includes(item.id)) {
                  layout.removeCard(pageIdx, item.id);
                } else {
                  layout.addCard(pageIdx, item.id);
                }
              },
            }))}
          />
        </div>

          {/* Search results replace page content when open */}
          {searchOpen ? (
            <div style={{ flex: 1, overflowY: 'auto', animation: 'fadeInUp 0.18s ease', padding: '0 10px', maxWidth: 1200, width: '100%', margin: '0 auto' }}>
              <SearchResults
                results={srResults}
                loading={srLoading}
                query={searchQuery}
                onSelectDate={d => { setSearchOpen(false); setSearchQuery(''); setSelected(d); }}
              />
            </div>
          ) : layout.loaded ? (
            <>
              {/* ── Edit-mode bar — shown above the page content ── */}
              {editMode && (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '5px 16px', flexShrink: 0,
                  background: 'var(--dl-glass)',
                  backdropFilter: 'blur(20px) saturate(1.4)',
                  WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
                  borderBottom: '1px solid var(--dl-border)',
                  maxWidth: 1200, width: '100%', margin: '0 auto',
                  boxSizing: 'border-box',
                  animation: 'fadeInUp 0.15s ease',
                }}>
                  <span style={{
                    fontFamily: mono, fontSize: F.sm, letterSpacing: '0.08em',
                    textTransform: 'uppercase', color: 'var(--dl-highlight)',
                  }}>
                    Editing — {layout.pages[layout.currentPageIdx]?.name}
                  </span>
                  <button
                    onClick={exitEditMode}
                    style={{
                      background: 'var(--dl-accent)', color: '#fff', border: 'none',
                      borderRadius: 100, padding: '4px 16px', cursor: 'pointer',
                      fontFamily: mono, fontSize: F.sm, letterSpacing: '0.06em',
                      fontWeight: 'bold',
                    }}
                  >
                    Done
                  </button>
                </div>
              )}

              <PageContainer
                pages={layout.pages}
                renderPage={renderPage}
                currentPageIdx={layout.currentPageIdx}
                onPageChange={layout.setCurrentPageIdx}
                editMode={editMode}
              />
              <PageDots
                count={layout.pages.length}
                active={layout.currentPageIdx}
                pages={layout.pages}
                onDotClick={(i) => layout.setCurrentPageIdx(i)}
                onAddPage={(name) => {
                  layout.addPage(name);
                  // Navigate to the newly created page after state update
                  setTimeout(() => layout.setCurrentPageIdx(layout.pages.length), 50);
                }}
                onRenamePage={(i, name) => layout.renamePage(i, name)}
                onDeletePage={(i) => layout.removePage(i)}
              />
            </>
          ) : null}

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
          healthKey={`${selected}:${healthDots[selected]?.sleep||0}:${healthDots[selected]?.readiness||0}`}
          expanded={chatExpanded} onExpandedChange={setChatExpanded}/>
      )}

      {/* Keyboard shortcut cheatsheet — ? button + overlay */}
      <ShortcutCheatsheet/>
    </div>
    </NavigationContext.Provider>
    </NoteContext.Provider>
    </PlaceNamesContext.Provider>
    </ProjectNamesContext.Provider>
  );
}

export default function Dashboard() {
  return <ThemeProvider><DashboardInner /></ThemeProvider>;
}
