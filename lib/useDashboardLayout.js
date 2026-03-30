'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import { migrateFromCollapseState } from './layoutMigration';

const DEFAULT_PAGES = [{ name: 'Dashboard', cards: ['project-graph', 'journal', 'tasks'] }];

// Normalise whatever shape is stored in settings into a flat pages array.
// Handles three historical formats:
//   { shared: [...] }              — current unified format
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

export function useDashboardLayout(token) {
  const [pages, setPages]             = useState(null);
  const [currentPageIdx, setCurrentPageIdx] = useState(0);
  const [loaded, setLoaded]           = useState(false);
  const saveTimer = useRef(null);

  // Load from settings on mount — migrate old formats automatically
  useEffect(() => {
    if (!token) return;
    api.get('/api/settings', token).then(settings => {
      const raw = settings?.data?.dashboard_layouts;
      const normalised = normalise(raw);
      if (normalised) {
        setPages(normalised);
        // If the stored format was old (desktop/mobile), rewrite it as unified
        if (raw && !Array.isArray(raw) && !raw.shared) {
          api.patch('/api/settings', { dashboard_layouts: { shared: normalised } }, token);
        }
      } else {
        // Nothing saved yet — try migrating from the even-older collapse state
        const migrated = typeof window !== 'undefined'
          ? migrateFromCollapseState()
          : { shared: DEFAULT_PAGES };
        const migratedPages = normalise(migrated) || DEFAULT_PAGES;
        setPages(migratedPages);
        api.patch('/api/settings', { dashboard_layouts: { shared: migratedPages } }, token);
      }
      setLoaded(true);
    }).catch(() => {
      setPages(DEFAULT_PAGES);
      setLoaded(true);
    });
  }, [token]);

  const currentPages = pages || DEFAULT_PAGES;
  const safePageIdx  = Math.min(currentPageIdx, currentPages.length - 1);

  // Debounced save — always writes unified { shared: [...] } format
  const save = useCallback((newPages) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.patch('/api/settings', { dashboard_layouts: { shared: newPages } }, token);
    }, 500);
  }, [token]);

  const updatePages = useCallback((newPages) => {
    setPages(newPages);
    save(newPages);
  }, [save]);

  const addCard = useCallback((pageIdx, cardId) => {
    updatePages(currentPages.map((p, i) =>
      i === pageIdx ? { ...p, cards: [...p.cards, cardId] } : p
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

  const addPage = useCallback((name) => {
    updatePages([...currentPages, { name, cards: [] }]);
  }, [currentPages, updatePages]);

  const removePage = useCallback((pageIdx) => {
    const newPages = currentPages.filter((_, i) => i !== pageIdx);
    const safe = newPages.length > 0 ? newPages : DEFAULT_PAGES;
    updatePages(safe);
    if (safePageIdx >= safe.length) setCurrentPageIdx(Math.max(0, safe.length - 1));
  }, [currentPages, updatePages, safePageIdx]);

  const renamePage = useCallback((pageIdx, name) => {
    updatePages(currentPages.map((p, i) =>
      i === pageIdx ? { ...p, name } : p
    ));
  }, [currentPages, updatePages]);

  return {
    pages: currentPages,
    currentPageIdx: safePageIdx,
    setCurrentPageIdx,
    addCard,
    removeCard,
    reorderCards,
    addPage,
    removePage,
    renamePage,
    loaded,
  };
}
