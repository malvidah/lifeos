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

// Normalise whatever shape is stored in settings into a flat pages array.
// Handles three historical formats:
//   { shared: [...], homeIdx: n } — current unified format
//   { desktop: [...], mobile: [] } — old per-device format
//   [...]                          — even older flat array
function normalise(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw;           // legacy flat array
  if (raw.shared) return raw.shared;            // current format
  if (raw.desktop) return raw.desktop;          // old desktop layout takes precedence
  if (raw.mobile)  return raw.mobile;           // fall back to mobile
  return null;
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
    // Discard if out of range or from a different day
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
  const [homeIdx, setHomeIdxState]              = useState(1); // default to 2nd page
  const [loaded, setLoaded]                     = useState(false);
  const saveTimer  = useRef(null);
  // Ref so callbacks always write the latest homeIdx without stale closures
  const homeIdxRef = useRef(1);
  homeIdxRef.current = homeIdx;
  // Guard: never allow a save before the initial GET resolves.
  // Without this, addCard/removeCard called during the load window would
  // write DEFAULT_PAGES (pages=null → currentPages fallback) to Supabase,
  // silently wiping the user's real layout.
  const loadedRef = useRef(false);

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
    api.get('/api/settings', token).then(settings => {
      const raw        = settings?.data?.dashboard_layouts;
      const normalised = normalise(raw);

      // homeIdx: stored in raw.homeIdx (new format). Fall back to 1 (2nd page)
      // for existing users who don't have it set yet.
      const rawHomeIdx = typeof raw?.homeIdx === 'number' ? raw.homeIdx : 1;

      // Determine start page: URL param > localStorage (same day only) > homeIdx
      const resolveStart = (pageList, safeHome) => {
        const fromUrl = readPageFromUrl();
        if (fromUrl != null && fromUrl < pageList.length) return fromUrl;
        const stored = readStoredPage(pageList.length);
        return stored ?? safeHome;
      };

      if (normalised) {
        const safeHome = Math.min(rawHomeIdx, normalised.length - 1);
        setPages(normalised);
        setHomeIdxState(safeHome);
        homeIdxRef.current = safeHome;
        const startIdx = resolveStart(normalised, safeHome);
        setCurrentPageIdxRaw(startIdx);
        // Sync URL so the address bar reflects the actual page
        if (typeof window !== 'undefined') {
          const url = new URL(window.location.href);
          url.searchParams.set('p', startIdx);
          window.history.replaceState({}, '', url);
        }
        // Rewrite old formats as unified
        if (raw && !Array.isArray(raw) && !raw.shared) {
          api.patch('/api/settings', { dashboard_layouts: { shared: normalised, homeIdx: safeHome } }, token);
        }
      } else {
        // Nothing saved yet — try migrating from older collapse state
        const migrated      = typeof window !== 'undefined'
          ? migrateFromCollapseState()
          : { shared: DEFAULT_PAGES };
        const migratedPages = normalise(migrated) || DEFAULT_PAGES;
        const safeHome      = Math.min(rawHomeIdx, migratedPages.length - 1);
        setPages(migratedPages);
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
      setPages(DEFAULT_PAGES);
      loadedRef.current = true;
      setLoaded(true);
    });
  }, [token]);

  const currentPages = pages || DEFAULT_PAGES;
  const safePageIdx  = Math.min(currentPageIdx, currentPages.length - 1);

  // ── Debounced save — always writes { shared, homeIdx } ───────────────────
  // homeIdx is read from the ref so it's always current even in stale closures.
  // loadedRef guards against saves that fire before the initial GET settles
  // (e.g. a user tapping a card during the loading window, which would send
  // DEFAULT_PAGES to Supabase and wipe their real layout).
  const save = useCallback((newPages) => {
    if (!loadedRef.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.patch('/api/settings', {
        dashboard_layouts: { shared: newPages, homeIdx: homeIdxRef.current },
      }, token);
    }, 500);
  }, [token]);

  const updatePages = useCallback((newPages) => {
    setPages(newPages);
    save(newPages);
  }, [save]);

  // ── Card management ───────────────────────────────────────────────────────
  const addCard = useCallback((pageIdx, cardId) => {
    updatePages(currentPages.map((p, i) =>
      i === pageIdx ? { ...p, cards: [cardId, ...p.cards] } : p
    ));
  }, [currentPages, updatePages]);

  const removeCard = useCallback((pageIdx, cardId) => {
    updatePages(currentPages.map((p, i) =>
      i === pageIdx ? { ...p, cards: p.cards.filter(c => c !== cardId) } : p
    ));
  }, [currentPages, updatePages]);

  const reorderCards = useCallback((pageIdx, newCardOrder) => {
    updatePages(currentPages.map((p, i) =>
      i === pageIdx ? { ...p, cards: newCardOrder } : p
    ));
  }, [currentPages, updatePages]);

  // ── Page management ───────────────────────────────────────────────────────
  const addPage = useCallback((name) => {
    updatePages([...currentPages, { name, cards: [] }]);
  }, [currentPages, updatePages]);

  const removePage = useCallback((pageIdx) => {
    const newPages = currentPages.filter((_, i) => i !== pageIdx);
    const safe     = newPages.length > 0 ? newPages : DEFAULT_PAGES;
    updatePages(safe);
    if (safePageIdx >= safe.length) setCurrentPageIdx(Math.max(0, safe.length - 1));
    // Adjust homeIdx if the removed page was at or before it
    const h = homeIdxRef.current;
    if (pageIdx === h) {
      const newHome = Math.max(0, h - 1);
      setHomeIdxState(newHome);
      homeIdxRef.current = newHome;
    } else if (pageIdx < h) {
      setHomeIdxState(h - 1);
      homeIdxRef.current = h - 1;
    }
  }, [currentPages, updatePages, safePageIdx]);

  const renamePage = useCallback((pageIdx, name) => {
    updatePages(currentPages.map((p, i) =>
      i === pageIdx ? { ...p, name } : p
    ));
  }, [currentPages, updatePages]);

  // Reorder pages — moves fromIdx to toIdx, tracks homeIdx along with its page.
  const reorderPages = useCallback((fromIdx, toIdx) => {
    if (fromIdx === toIdx) return;
    const arr    = [...currentPages];
    const [moved] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, moved);

    // Compute where homeIdx ends up
    const h = homeIdxRef.current;
    let newHome = h;
    if (h === fromIdx) {
      newHome = toIdx;
    } else if (fromIdx < h && toIdx >= h) {
      newHome = h - 1;
    } else if (fromIdx > h && toIdx <= h) {
      newHome = h + 1;
    }

    // Compute where currentPageIdx ends up
    const cur = safePageIdx;
    let newCur = cur;
    if (cur === fromIdx) {
      newCur = toIdx;
    } else if (fromIdx < cur && toIdx >= cur) {
      newCur = cur - 1;
    } else if (fromIdx > cur && toIdx <= cur) {
      newCur = cur + 1;
    }

    setHomeIdxState(newHome);
    homeIdxRef.current = newHome;
    setCurrentPageIdx(newCur);
    updatePages(arr);  // save is debounced and reads homeIdxRef
  }, [currentPages, safePageIdx, updatePages]);

  // Mark a page as the home page — saves immediately (no debounce).
  const setHomeIdx = useCallback((idx) => {
    if (!loadedRef.current) return;
    const safe = Math.min(idx, currentPages.length - 1);
    setHomeIdxState(safe);
    homeIdxRef.current = safe;
    api.patch('/api/settings', {
      dashboard_layouts: { shared: currentPages, homeIdx: safe },
    }, token);
  }, [currentPages, token]);

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
