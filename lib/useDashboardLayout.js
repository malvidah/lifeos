'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import { migrateFromCollapseState } from './layoutMigration';

const DEFAULT_PAGES = [
  { name: 'Overview', cards: ['project-graph', 'cal', 'goals'] },
  { name: 'Today',    cards: ['habits', 'tasks', 'journal'] },
  { name: 'Health',   cards: ['health', 'meals', 'workouts'] },
  { name: 'Notes',    cards: ['world-map', 'notes'] },
];

function newPageId() {
  return 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function withIds(arr) {
  return arr.map(p => {
    const page = p?.id ? p : { ...p, id: newPageId() };
    if (!Array.isArray(page.cards)) page.cards = [];
    return page;
  });
}

function normalise(raw) {
  if (!raw) return null;
  let arr = null;
  if (Array.isArray(raw)) arr = raw;
  else if (raw.shared) arr = raw.shared;
  else if (raw.desktop) arr = raw.desktop;
  else if (raw.mobile)  arr = raw.mobile;
  return arr ? withIds(arr) : null;
}

// ── URL + localStorage helpers ────────────────────────────────────────────
function readPageFromUrl() {
  if (typeof window === 'undefined') return null;
  const p = new URLSearchParams(window.location.search).get('p');
  const v = parseInt(p, 10);
  return Number.isFinite(v) && v >= 0 ? v : null;
}
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}
function readStoredPage(pageCount) {
  try {
    const v = parseInt(localStorage.getItem('daylab:currentPageIdx'), 10);
    const d = localStorage.getItem('daylab:currentPageIdxDate');
    if (Number.isFinite(v) && v >= 0 && v < pageCount && d === todayKey()) return v;
    return null;
  } catch { return null; }
}
function persistPage(idx) {
  try {
    localStorage.setItem('daylab:currentPageIdx', idx);
    localStorage.setItem('daylab:currentPageIdxDate', todayKey());
  } catch {}
}

export function useDashboardLayout(token) {
  const [pages, setPages]                       = useState(null);
  const [currentPageIdx, setCurrentPageIdxRaw]  = useState(1);
  const [homeIdx, setHomeIdxState]              = useState(1);
  const [loaded, setLoaded]                     = useState(false);
  const saveTimer  = useRef(null);
  const homeIdxRef = useRef(1);
  homeIdxRef.current = homeIdx;
  const loadedRef = useRef(false);

  // Ref that always holds the latest pages, updated synchronously.
  // Prevents stale-closure bugs in addCard/removeCard/reorderCards
  // when called rapidly before React re-renders.
  const pagesRef = useRef(null);

  const currentPages = pages || withIds(DEFAULT_PAGES);
  pagesRef.current = currentPages;

  // ── setCurrentPageIdx: updates state + URL + localStorage ────────────────
  const setCurrentPageIdx = useCallback((idx) => {
    setCurrentPageIdxRaw(idx);
    persistPage(idx);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('p', idx);
      window.history.pushState({}, '', url);
    }
  }, []);

  // ── Sync back/forward browser navigation ─────────────────────────────────
  useEffect(() => {
    const onPop = () => {
      const idx = readPageFromUrl();
      if (idx !== null) setCurrentPageIdxRaw(idx);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // ── Load from settings on mount ──────────────────────────────────────────
  useEffect(() => {
    if (!token) return;

    // Block saves until THIS load resolves. Prevents stale DEFAULT_PAGES
    // from being written if the token changed and the GET fails.
    loadedRef.current = false;

    api.get('/api/settings', token).then(settings => {
      const raw        = settings?.data?.dashboard_layouts;
      const normalised = normalise(raw);

      const rawHomeIdx = typeof raw?.homeIdx === 'number' ? raw.homeIdx : 1;

      const resolveStart = (pageList, safeHome) => {
        const fromUrl = readPageFromUrl();
        if (fromUrl != null && fromUrl < pageList.length) return fromUrl;
        const stored = readStoredPage(pageList.length);
        return stored ?? safeHome;
      };

      if (normalised) {
        const safeHome = Math.min(rawHomeIdx, normalised.length - 1);
        setPages(normalised);
        pagesRef.current = normalised;
        setHomeIdxState(safeHome);
        homeIdxRef.current = safeHome;
        const startIdx = resolveStart(normalised, safeHome);
        setCurrentPageIdxRaw(startIdx);
        if (typeof window !== 'undefined') {
          const url = new URL(window.location.href);
          url.searchParams.set('p', startIdx);
          window.history.replaceState({}, '', url);
        }
        const storedShared = raw?.shared;
        const idsBackfilled = Array.isArray(storedShared)
          && storedShared.some(p => !p?.id);
        if ((raw && !Array.isArray(raw) && !raw.shared) || idsBackfilled) {
          api.patch('/api/settings', { dashboard_layouts: { shared: normalised, homeIdx: safeHome } }, token);
        }
      } else {
        const migrated      = typeof window !== 'undefined'
          ? migrateFromCollapseState()
          : { shared: DEFAULT_PAGES };
        const migratedPages = normalise(migrated) || withIds(DEFAULT_PAGES);
        const safeHome      = Math.min(rawHomeIdx, migratedPages.length - 1);
        setPages(migratedPages);
        pagesRef.current = migratedPages;
        setHomeIdxState(safeHome);
        homeIdxRef.current = safeHome;
        const startIdx = resolveStart(migratedPages, safeHome);
        setCurrentPageIdxRaw(startIdx);
        if (typeof window !== 'undefined') {
          const url = new URL(window.location.href);
          url.searchParams.set('p', startIdx);
          window.history.replaceState({}, '', url);
        }
        api.patch('/api/settings', { dashboard_layouts: { shared: migratedPages, homeIdx: safeHome } }, token);
      }
      loadedRef.current = true;
      setLoaded(true);
    }).catch(() => {
      setPages(withIds(DEFAULT_PAGES));
      setLoaded(true);
      // loadedRef.current intentionally left false — saves are blocked until a
      // successful load. Refreshing the page will retry the GET and restore real settings.
    });
  }, [token]);

  const safePageIdx  = Math.min(currentPageIdx, currentPages.length - 1);

  // ── Debounced save ──────────────────────────────────────────────────────
  const save = useCallback((newPages) => {
    if (!loadedRef.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.patch('/api/settings', {
        dashboard_layouts: { shared: newPages, homeIdx: homeIdxRef.current },
      }, token);
    }, 500);
  }, [token]);

  // ── Flush pending save on page unload so close-tab doesn't lose changes ──
  useEffect(() => {
    const flush = () => {
      if (saveTimer.current && loadedRef.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        const latestPages = pagesRef.current;
        if (latestPages && token) {
          const body = JSON.stringify({
            dashboard_layouts: { shared: latestPages, homeIdx: homeIdxRef.current },
          });
          try {
            fetch('/api/settings', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body,
              keepalive: true,
            });
          } catch {}
        }
      }
    };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
    };
  }, [token]);

  const updatePages = useCallback((newPages) => {
    pagesRef.current = newPages;
    setPages(newPages);
    save(newPages);
  }, [save]);

  // ── Card management ───────────────────────────────────────────────────────
  // Read from pagesRef (not currentPages closure) so rapid calls
  // always see the latest state, even before React re-renders.
  const addCard = useCallback((pageIdx, cardId) => {
    const cp = pagesRef.current;
    updatePages(cp.map((p, i) =>
      i === pageIdx ? { ...p, cards: [cardId, ...p.cards] } : p
    ));
  }, [updatePages]);

  const removeCard = useCallback((pageIdx, cardId) => {
    const cp = pagesRef.current;
    updatePages(cp.map((p, i) =>
      i === pageIdx ? { ...p, cards: p.cards.filter(c => c !== cardId) } : p
    ));
  }, [updatePages]);

  const reorderCards = useCallback((pageIdx, newCardOrder) => {
    const cp = pagesRef.current;
    updatePages(cp.map((p, i) =>
      i === pageIdx ? { ...p, cards: newCardOrder } : p
    ));
  }, [updatePages]);

  // ── Page management ───────────────────────────────────────────────────────
  const addPage = useCallback((name) => {
    const cp = pagesRef.current;
    updatePages([...cp, { id: newPageId(), name, cards: [] }]);
  }, [updatePages]);

  const removePage = useCallback((pageIdx) => {
    const cp = pagesRef.current;
    const newPages = cp.filter((_, i) => i !== pageIdx);
    const safe     = newPages.length > 0 ? newPages : withIds(DEFAULT_PAGES);
    updatePages(safe);
    if (safePageIdx >= safe.length) setCurrentPageIdx(Math.max(0, safe.length - 1));
    const h = homeIdxRef.current;
    if (pageIdx === h) {
      const newHome = Math.max(0, h - 1);
      setHomeIdxState(newHome);
      homeIdxRef.current = newHome;
    } else if (pageIdx < h) {
      setHomeIdxState(h - 1);
      homeIdxRef.current = h - 1;
    }
  }, [updatePages, safePageIdx]);

  const renamePage = useCallback((pageIdx, name) => {
    const cp = pagesRef.current;
    updatePages(cp.map((p, i) =>
      i === pageIdx ? { ...p, name } : p
    ));
  }, [updatePages]);

  const reorderPages = useCallback((fromIdx, toIdx) => {
    if (fromIdx === toIdx) return;
    const arr    = [...pagesRef.current];
    const [moved] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, moved);

    const h = homeIdxRef.current;
    let newHome = h;
    if (h === fromIdx) {
      newHome = toIdx;
    } else if (fromIdx < h && toIdx >= h) {
      newHome = h - 1;
    } else if (fromIdx > h && toIdx <= h) {
      newHome = h + 1;
    }

    let newCur = safePageIdx;
    if (safePageIdx === fromIdx) {
      newCur = toIdx;
    } else if (fromIdx < safePageIdx && toIdx >= safePageIdx) {
      newCur = safePageIdx - 1;
    } else if (fromIdx > safePageIdx && toIdx <= safePageIdx) {
      newCur = safePageIdx + 1;
    }

    setHomeIdxState(newHome);
    homeIdxRef.current = newHome;
    setCurrentPageIdx(newCur);
    updatePages(arr);
  }, [safePageIdx, updatePages]);

  const setHomeIdx = useCallback((idx) => {
    if (!loadedRef.current) return;
    const cp = pagesRef.current;
    const safe = Math.min(idx, cp.length - 1);
    setHomeIdxState(safe);
    homeIdxRef.current = safe;
    api.patch('/api/settings', {
      dashboard_layouts: { shared: cp, homeIdx: safe },
    }, token);
  }, [token]);

  return {
    pages: currentPages,
    currentPageIdx: safePageIdx,
    setCurrentPageIdx,
    homeIdx,
    setHomeIdx,
    reorderPages,
    addCard,
    removeCard,
    reorderCards,
    addPage,
    removePage,
    renamePage,
    loaded,
  };
}
