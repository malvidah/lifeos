"use client";
// ─── Day Lab client-side data store ───────────────────────────────────────────
// Single source of truth for in-memory entry cache, dirty tracking, and
// undo/redo history. Replaces module-level MEM/DIRTY/HISTORY globals and
// the daylab:mem-update / daylab:refresh / daylab:snapshot-restore event bus.
//
// Usage:
//   import { useStore } from "@/lib/store";
//   const value    = useStore(s => s.mem["userId:date:type"]);
//   const setMem   = useStore(s => s.setMemValue);
//   const refresh  = useStore(s => s.clearMemKey);

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { devtools } from "zustand/middleware";

// ─── localStorage persistence for mem cache ──────────────────────────────────
const MEM_CACHE_KEY = 'daylab:mem-cache';
const DATE_KEY_RE = /^[^:]+:\d{4}-\d{2}-\d{2}:/; // only cache date-keyed entries

function hydrateMemCache() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(MEM_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

let _persistTimer = null;
function persistMemCache(mem) {
  clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    try {
      // Only persist date-keyed entries (journal, tasks, meals, workouts, etc.)
      const toCache = {};
      for (const key in mem) {
        if (DATE_KEY_RE.test(key)) toCache[key] = mem[key];
      }
      localStorage.setItem(MEM_CACHE_KEY, JSON.stringify(toCache));
    } catch (e) {
      // QuotaExceededError — evict oldest entries and retry once
      if (e?.name === 'QuotaExceededError') {
        try { localStorage.removeItem(MEM_CACHE_KEY); } catch {}
      }
    }
  }, 500);
}

export const useStore = create(
  devtools(
    immer((set, get) => ({
      // ─── Cache ─────────────────────────────────────────────────────────────
      // mem[cacheKey] = data value (any JSON)
      mem: hydrateMemCache(),
      // dirty[cacheKey] = true when mem has unsaved changes
      dirty: {},

      // Write a value (marks dirty, triggers all subscribers)
      setMemValue(key, value) {
        set(state => {
          state.mem[key] = value;
          state.dirty[key] = true;
        });
        persistMemCache(get().mem);
      },

      // Load a value from remote (does not mark dirty)
      loadMemValue(key, value) {
        set(state => {
          state.mem[key] = value;
          // Ensure dirty is not accidentally set
          if (state.dirty[key] === undefined) state.dirty[key] = false;
        });
        persistMemCache(get().mem);
      },

      clearDirty(key) {
        set(state => { state.dirty[key] = false; });
      },

      clearMemKey(key) {
        set(state => {
          delete state.mem[key];
          delete state.dirty[key];
        });
        persistMemCache(get().mem);
      },

      // Wipe all cache for a different user (called on login/logout)
      clearAllCache() {
        set(state => { state.mem = {}; state.dirty = {}; });
        try { localStorage.removeItem(MEM_CACHE_KEY); } catch {}
      },

      // ─── Undo / Redo history ───────────────────────────────────────────────
      history: { stack: [], cursor: -1 },

      pushHistory(entry) {
        set(state => {
          state.history.stack = state.history.stack.slice(0, state.history.cursor + 1);
          state.history.stack.push(entry);
          if (state.history.stack.length > 60) state.history.stack.shift();
          state.history.cursor = state.history.stack.length - 1;
        });
      },

      async doUndo() {
        const { history } = get();
        if (history.cursor < 0) return;
        await history.stack[history.cursor].undo();
        set(state => { state.history.cursor--; });
      },

      async doRedo() {
        const { history } = get();
        if (history.cursor >= history.stack.length - 1) return;
        set(state => { state.history.cursor++; });
        const { history: h } = get();
        await h.stack[h.cursor].redo();
      },
    })),
    { name: "DayLab" }
  )
);

// ─── Plain (non-hook) accessors for use outside React ─────────────────────────
// Use these in timeouts and undo/redo handlers where hooks can't run.
export const getStore = () => useStore.getState();
