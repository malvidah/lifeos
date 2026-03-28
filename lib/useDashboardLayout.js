'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import { migrateFromCollapseState } from './layoutMigration';

const DEFAULT_LAYOUTS = {
  desktop: [{ name: 'Dashboard', cards: ['project-graph', 'journal', 'tasks'] }],
  mobile: [{ name: 'Dashboard', cards: ['project-graph', 'journal', 'tasks'] }],
};

export function useDashboardLayout(token, isMobile) {
  const [allLayouts, setAllLayouts] = useState(null);
  const [currentPageIdx, setCurrentPageIdx] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef(null);

  // Load from settings on mount
  useEffect(() => {
    if (!token) return;
    api.get('/api/settings', token).then(settings => {
      const layouts = settings?.data?.dashboard_layouts;
      if (layouts) {
        setAllLayouts(layouts);
      } else {
        const migrated = typeof window !== 'undefined'
          ? migrateFromCollapseState()
          : DEFAULT_LAYOUTS;
        setAllLayouts(migrated);
        api.patch('/api/settings', { dashboard_layouts: migrated }, token);
      }
      setLoaded(true);
    }).catch(() => {
      setAllLayouts(DEFAULT_LAYOUTS);
      setLoaded(true);
    });
  }, [token]);

  const deviceKey = isMobile ? 'mobile' : 'desktop';
  const pages = allLayouts?.[deviceKey] || DEFAULT_LAYOUTS[deviceKey];
  const safePageIdx = Math.min(currentPageIdx, pages.length - 1);

  // Debounced save to settings API
  const save = useCallback((newLayouts) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.patch('/api/settings', { dashboard_layouts: newLayouts }, token);
    }, 500);
  }, [token]);

  const updatePages = useCallback((newPages) => {
    const updated = { ...allLayouts, [deviceKey]: newPages };
    setAllLayouts(updated);
    save(updated);
  }, [allLayouts, deviceKey, save]);

  const addCard = useCallback((pageIdx, cardId) => {
    const newPages = pages.map((p, i) =>
      i === pageIdx ? { ...p, cards: [...p.cards, cardId] } : p
    );
    updatePages(newPages);
  }, [pages, updatePages]);

  const removeCard = useCallback((pageIdx, cardId) => {
    const newPages = pages.map((p, i) =>
      i === pageIdx ? { ...p, cards: p.cards.filter(c => c !== cardId) } : p
    );
    updatePages(newPages);
  }, [pages, updatePages]);

  const reorderCards = useCallback((pageIdx, newCardOrder) => {
    const newPages = pages.map((p, i) =>
      i === pageIdx ? { ...p, cards: newCardOrder } : p
    );
    updatePages(newPages);
  }, [pages, updatePages]);

  const addPage = useCallback((name) => {
    updatePages([...pages, { name, cards: [] }]);
  }, [pages, updatePages]);

  const removePage = useCallback((pageIdx) => {
    const newPages = pages.filter((_, i) => i !== pageIdx);
    updatePages(
      newPages.length > 0
        ? newPages
        : [{ name: 'Dashboard', cards: ['project-graph', 'journal', 'tasks'] }]
    );
    if (safePageIdx >= newPages.length) {
      setCurrentPageIdx(Math.max(0, newPages.length - 1));
    }
  }, [pages, updatePages, safePageIdx]);

  const renamePage = useCallback((pageIdx, name) => {
    const newPages = pages.map((p, i) =>
      i === pageIdx ? { ...p, name } : p
    );
    updatePages(newPages);
  }, [pages, updatePages]);

  return {
    pages,
    currentPageIdx: safePageIdx,
    setCurrentPageIdx,
    addCard,
    removeCard,
    reorderCards,
    addPage,
    removePage,
    renamePage,
    loaded,
    deviceKey,
  };
}
