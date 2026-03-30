"use client";
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { mono, serif, F, injectBlurWebFont } from "@/lib/tokens";
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

// ── PageContent ───────────────────────────────────────────────────────────────
// Extracted as a proper React component so DndContext gets stable identity
// across renders. Inline JSX inside renderPage caused DndContext to re-register
// wheel event listeners on every editMode change → WebGL context loss.
function PageContent({ page, pageIdx, editMode, enterEditMode, cardProps, sensors, layoutRef }) {
  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = page.cards;
    const oldIdx = ids.indexOf(String(active.id));
    const newIdx = ids.indexOf(String(over.id));
    if (oldIdx === -1 || newIdx === -1) return;
    layoutRef.current.reorderCards(pageIdx, arrayMove(ids, oldIdx, newIdx));
  }, [page.cards, pageIdx, layoutRef]);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={page.cards} strategy={verticalListSortingStrategy}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10,
          // Push first card below header (≈88px) + glass nav row (40px) + gaps
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 148px)",
          maxWidth: 1200, width: '100%', margin: '0 auto' }}>
          {page.cards.map(cardId => {
            const entry = CARD_REGISTRY.find(c => c.id === cardId);
            if (!entry) return null;
            return (
              <DraggableCard key={cardId} cardId={cardId} editMode={editMode} onEnterEditMode={enterEditMode}>
                {entry.render(cardProps)}
              </DraggableCard>
            );
          })}
          <div style={{ paddingBottom: 200 }} />
        </div>
      </SortableContext>
    </DndContext>
  );
}


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

  // Keep a stable ref to layout so renderPage can call reorderCards without
  // needing layout in its dep array (which would cause renderPage to churn on
  // every debounced Supabase save, re-mounting every card on the page).
  const layoutRef = useRef(layout);
  useEffect(() => { layoutRef.current = layout; });

  // ── Layout edit mode ─────────────────────────────────────────────────────
  // Triggered by long-pressing a card header OR tapping the leftmost grid icon.
  const [editMode, setEditMode] = useState(false);
  const enterEditMode = useCallback(() => setEditMode(true),  []);
  const exitEditMode  = useCallback(() => setEditMode(false), []);

  // openSearch / closeSearch — used by the glass search float
  const openSearch  = useCallback(() => { setSearchOpen(true);  setTimeout(() => searchInputRef.current?.focus(), 60); }, []);
  const closeSearch = useCallback(() => { setSearchOpen(false); setSearchQuery(''); }, []);

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

  // Props bag passed to every card's render function from the registry.
  // Memoized so renderPage (and therefore every card) only re-renders when
  // actual data they depend on changes — not on every parent state update
  // (e.g. syncing, editMode, searchQuery shouldn't re-render the Tasks card).
  const cardProps = useMemo(() => ({
    date: selected, setSelected, token, userId, projectFilter, selectProject,
    graphData, healthDots, events, setEvents, calView, setCalView,
    stravaConnected, journalMode, setJournalMode,
    goalsViewMode, setGoalsViewMode, habitFilter, setHabitFilter,
    taskFilter, setTaskFilter, startSync, endSync, onHealthChange, onScoresReady,
    searchOpen, allNoteNames, setAllNoteNames,
  }), [
    selected, setSelected, token, userId, projectFilter, selectProject,
    graphData, healthDots, events, setEvents, calView, setCalView,
    stravaConnected, journalMode, setJournalMode,
    goalsViewMode, setGoalsViewMode, habitFilter, setHabitFilter,
    taskFilter, setTaskFilter, startSync, endSync, onHealthChange, onScoresReady,
    searchOpen, allNoteNames, setAllNoteNames,
  ]); // eslint-disable-line

  // Current page's card IDs — used for dock active state
  const currentPageCards = layout.pages[layout.currentPageIdx]?.cards || [];

  // renderPage: renders all cards for a given page as a PageContent component.
  // PageContent is a proper React component (not inline JSX) so DndContext gets
  // stable identity — prevents wheel event re-registration and WebGL context loss.
  const renderPage = useCallback((page, pageIdx) => (
    <PageContent
      page={page}
      pageIdx={pageIdx}
      editMode={editMode}
      enterEditMode={enterEditMode}
      cardProps={cardProps}
      sensors={sensors}
      layoutRef={layoutRef}
    />
  ), [editMode, enterEditMode, cardProps, sensors, layoutRef]);

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

      {/* ── Full-height content area — scrolls under the glass overlays ─── */}
      <div style={{flex:1, minHeight:0, overflow:"hidden", display:"flex", flexDirection:"column", alignItems:"stretch", position:"relative", zIndex:1}}>
        <div ref={scrollContainerRef} style={{flex:1, minHeight:0, display:"flex", flexDirection:"column", overflowY: searchOpen ? 'auto' : 'hidden'}}>

          {searchOpen ? (
            <div style={{ flex: 1, overflowY: 'auto', animation: 'fadeInUp 0.18s ease',
              padding: '0 10px', paddingTop: "calc(env(safe-area-inset-top, 0px) + 148px)",
              maxWidth: 1200, width: '100%', margin: '0 auto' }}>
              <SearchResults
                results={srResults}
                loading={srLoading}
                query={searchQuery}
                onSelectDate={d => { closeSearch(); setSelected(d); }}
              />
            </div>
          ) : layout.loaded ? (
            <>
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
                  setTimeout(() => layout.setCurrentPageIdx(layout.pages.length), 50);
                }}
                onRenamePage={(i, name) => layout.renamePage(i, name)}
                onDeletePage={(i) => layout.removePage(i)}
              />
            </>
          ) : null}

        </div>
      </div>

      {/* ── Glass nav floats — fixed above the scroll area ───────────────── */}
      {/* Left: layout/edit mode toggle (circular) */}
      <button
        onClick={() => setEditMode(v => !v)}
        style={{
          position: "fixed",
          top: "calc(env(safe-area-inset-top, 0px) + 100px)",
          left: 12, zIndex: 95,
          width: 40, height: 40, borderRadius: "50%",
          background: editMode
            ? "color-mix(in srgb, var(--dl-accent) 14%, var(--dl-glass))"
            : "var(--dl-glass)",
          backdropFilter: "blur(20px) saturate(1.4)",
          WebkitBackdropFilter: "blur(20px) saturate(1.4)",
          border: editMode
            ? "1px solid color-mix(in srgb, var(--dl-accent) 30%, transparent)"
            : "1px solid var(--dl-glass-border)",
          boxShadow: "var(--dl-glass-shadow)",
          cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: editMode ? "var(--dl-accent)" : "var(--dl-highlight)",
          transition: "background 0.2s, color 0.2s, border 0.2s",
          WebkitAppRegion: "no-drag",
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/>
        </svg>
      </button>

      {/* Center: project name pill / widget dock (edit mode) / search input */}
      <div style={{
        position: "fixed",
        top: "calc(env(safe-area-inset-top, 0px) + 100px)",
        left: 60, right: 60,
        zIndex: 95,
        display: "flex", justifyContent: "center",
        WebkitAppRegion: "no-drag",
      }}>
        {searchOpen ? (
          /* Search input pill */
          <div style={{
            display: "flex", alignItems: "center", height: 40, gap: 8,
            background: "var(--dl-glass)",
            backdropFilter: "blur(20px) saturate(1.4)",
            WebkitBackdropFilter: "blur(20px) saturate(1.4)",
            border: "1px solid var(--dl-glass-border)", borderRadius: 100,
            boxShadow: "var(--dl-glass-shadow)",
            padding: "0 10px 0 16px", width: "100%", maxWidth: 480,
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--dl-highlight)" strokeWidth="2.5" strokeLinecap="round" style={{flexShrink:0}}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') closeSearch(); }}
              placeholder="Search"
              style={{ flex:1, background:'transparent', border:'none', outline:'none', fontFamily:serif, fontSize:F.md, color:"var(--dl-strong)", caretColor:"var(--dl-accent)" }}
            />
            {srLoading && <span style={{fontFamily:mono,fontSize:8,color:"var(--dl-highlight)",letterSpacing:'0.12em',flexShrink:0}}>…</span>}
            <button onClick={closeSearch} style={{background:'none',border:'none',cursor:'pointer',color:"var(--dl-highlight)",display:'flex',alignItems:'center',justifyContent:'center',width:26,height:26,borderRadius:'50%',flexShrink:0}}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        ) : editMode ? (
          /* Widget dock */
          <div style={{
            display: "flex", alignItems: "center", height: 40, gap: 2,
            background: "var(--dl-glass)",
            backdropFilter: "blur(20px) saturate(1.4)",
            WebkitBackdropFilter: "blur(20px) saturate(1.4)",
            border: "1px solid var(--dl-glass-border)", borderRadius: 100,
            boxShadow: "var(--dl-glass-shadow)",
            padding: "0 4px",
            overflowX: "auto", scrollbarWidth: "none", msOverflowStyle: "none",
          }}>
            {DOCK_ITEMS.map(item => {
              const isOpen = currentPageCards.includes(item.id);
              return (
                <button key={item.id}
                  onClick={() => {
                    const pageIdx = layout.currentPageIdx;
                    if (isOpen) layout.removeCard(pageIdx, item.id);
                    else layout.addCard(pageIdx, item.id);
                  }}
                  title={item.label}
                  style={{
                    background: isOpen ? 'var(--dl-glass-active)' : 'transparent',
                    border: 'none', borderRadius: 100, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: isOpen ? "var(--dl-strong)" : "var(--dl-highlight)",
                    width: 34, height: 34, flexShrink: 0,
                    transition: 'background 0.15s, color 0.15s',
                  }}
                >
                  {item.icon}
                </button>
              );
            })}
          </div>
        ) : (
          /* Project name pill */
          <div style={{
            display: "flex", alignItems: "center", height: 40, gap: 4,
            background: "var(--dl-glass)",
            backdropFilter: "blur(20px) saturate(1.4)",
            WebkitBackdropFilter: "blur(20px) saturate(1.4)",
            border: "1px solid var(--dl-glass-border)", borderRadius: 100,
            boxShadow: "var(--dl-glass-shadow)",
            padding: "0 16px",
          }}>
            {activeProject && (
              <button
                onClick={() => { selectProject(null); setSelected(todayKey()); }}
                style={{background:'none',border:'none',cursor:'pointer',color:"var(--dl-highlight)",display:'flex',alignItems:'center',padding:'2px 2px 2px 0',transition:'color 0.15s'}}
                onMouseEnter={e => e.currentTarget.style.color = "var(--dl-strong)"}
                onMouseLeave={e => e.currentTarget.style.color = "var(--dl-highlight)"}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
              </button>
            )}
            <span
              style={{fontFamily:mono, fontSize:11, letterSpacing:'0.1em', textTransform:'uppercase', color:"var(--dl-highlight)", cursor: activeProject ? 'pointer' : 'default', whiteSpace:'nowrap'}}
              onClick={activeProject ? () => { selectProject(null); setSelected(todayKey()); } : undefined}
            >
              {activeProjectName || 'All Projects'}
            </span>
          </div>
        )}
      </div>

      {/* Right: search toggle (circular) */}
      {!searchOpen && (
        <button
          onClick={openSearch}
          style={{
            position: "fixed",
            top: "calc(env(safe-area-inset-top, 0px) + 100px)",
            right: 12, zIndex: 95,
            width: 40, height: 40, borderRadius: "50%",
            background: "var(--dl-glass)",
            backdropFilter: "blur(20px) saturate(1.4)",
            WebkitBackdropFilter: "blur(20px) saturate(1.4)",
            border: "1px solid var(--dl-glass-border)",
            boxShadow: "var(--dl-glass-shadow)",
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--dl-highlight)",
            transition: "color 0.15s",
            WebkitAppRegion: "no-drag",
          }}
          onMouseEnter={e => e.currentTarget.style.color = "var(--dl-strong)"}
          onMouseLeave={e => e.currentTarget.style.color = "var(--dl-highlight)"}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </button>
      )}

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
          expanded={chatExpanded} onExpandedChange={setChatExpanded}
          circular={true} />
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
