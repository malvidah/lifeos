"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api";
import { useStore, getStore } from "@/lib/store";

// ─── DB I/O ───────────────────────────────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function todayDateKey() { return new Date().toISOString().slice(0, 10); }

export async function dbSave(date, type, data, token) {
  if (!token) return;

  // Guard 1: date must be a valid YYYY-MM-DD string.
  // An invalid date means a stale-closure / ref bug — abort instead of
  // silently corrupting a DB row.
  if (!date || !ISO_DATE_RE.test(date)) {
    console.error("[dbSave] Invalid date — aborting write", { date, type });
    return;
  }

  // Guard 2: never write an empty value to a past date.
  // This is almost always a stale-flush bug, not intentional user action.
  const isEmpty =
    data === null || data === undefined || data === "" ||
    (typeof data === "object" && !Array.isArray(data) && Object.keys(data).length === 0);
  if (isEmpty && date < todayDateKey()) {
    console.warn("[dbSave] Skipping empty write to past date", { date, type });
    return;
  }

  // Route typed content to its dedicated endpoint; fall back to /api/entries
  // for legacy types (health, scores, settings, etc.) until they are migrated.
  const TYPED_ENDPOINTS = { journal: '/api/journal', tasks: '/api/tasks', meals: '/api/meals', workouts: '/api/workouts' };
  const url = TYPED_ENDPOINTS[type] ?? '/api/entries';
  const body = JSON.stringify(TYPED_ENDPOINTS[type] ? { date, data } : { date, type, data });
  try {
    await api.post(url, JSON.parse(body), token);
  } catch {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon(url + "?token=" + encodeURIComponent(token), blob);
    }
  }
}

export async function dbLoad(date, type, token) {
  if (!token) return null;
  const TYPED_ENDPOINTS = { journal: '/api/journal', tasks: '/api/tasks', meals: '/api/meals', workouts: '/api/workouts' };
  const url = TYPED_ENDPOINTS[type]
    ? `${TYPED_ENDPOINTS[type]}?date=${date}`
    : `/api/entries?date=${date}&type=${type}`;
  try {
    const d = await api.get(url, token);
    return d?.data ?? null;
  } catch { return null; }
}

// ─── User cache lifecycle ─────────────────────────────────────────────────────

let CURRENT_USER_ID = null;

export function clearCacheForUser(newUserId) {
  if (CURRENT_USER_ID && CURRENT_USER_ID !== newUserId) {
    getStore().clearAllCache();
  }
  CURRENT_USER_ID = newUserId;
}

// ─── Undo / Redo ──────────────────────────────────────────────────────────────
// Keep the same API surface as before — callers don't need to change.

export function pushHistory(entry)  { getStore().pushHistory(entry); }
export function canUndo()           { const h = getStore().history; return h.cursor >= 0; }
export function canRedo()           { const h = getStore().history; return h.cursor < h.stack.length - 1; }
export async function doUndo()      { await getStore().doUndo(); }
export async function doRedo()      { await getStore().doRedo(); }

// ─── Back-compat: expose MEM for the few callers that read it directly ────────
// ProjectView and ChatFloat read MEM[cacheKey] directly in snapshot logic.
// This proxy keeps them working without changes.
export const MEM = new Proxy({}, {
  get(_, key) { return getStore().mem[key]; },
  set(_, key, value) { getStore().setMemValue(key, value); return true; },
  deleteProperty(_, key) { getStore().clearMemKey(key); return true; },
  has(_, key) { return key in getStore().mem; },
  ownKeys() { return Object.keys(getStore().mem); },
  getOwnPropertyDescriptor(_, key) {
    const v = getStore().mem[key];
    return v !== undefined ? { value: v, writable: true, enumerable: true, configurable: true } : undefined;
  },
});

// DIRTY — back-compat proxy. Writing false or deleting clears dirty;
// writing true is a no-op (MEM writes already mark dirty via setMemValue).
export const DIRTY = new Proxy({}, {
  get(_, key) { return !!getStore().dirty[key]; },
  set(_, key, value) {
    if (!value) getStore().clearDirty(key);
    return true;
  },
  deleteProperty(_, key) { getStore().clearDirty(key); return true; },
});

// ─── useDbSave hook ───────────────────────────────────────────────────────────

export function useDbSave(date, type, empty, token, userId) {
  const cacheKey = `${userId || "anon"}:${date}:${type}`;

  // Subscribe to just our cache key — re-renders only when this key changes
  const memValue = useStore(s => s.mem[cacheKey]);
  const { setMemValue, loadMemValue, clearDirty, clearMemKey } = useStore.getState();

  const value  = memValue !== undefined ? memValue : empty;
  const loaded = memValue !== undefined;

  const [rev, setRev] = useState(0);
  const dateRef  = useRef(date);
  const timerRef = useRef(null);
  dateRef.current = date;

  // ── Load / remote sync ────────────────────────────────────────────────────
  useEffect(() => {
    if (!token || !userId) return;
    const { mem, dirty } = getStore();

    // Already in cache and not dirty — use it
    if (cacheKey in mem && !dirty[cacheKey] && rev === 0) {
      return;
    }

    dbLoad(date, type, token).then(remote => {
      const { dirty: d } = getStore();
      if (d[cacheKey]) {
        // A write happened while loading — save it
        dbSave(date, type, getStore().mem[cacheKey], token);
        clearDirty(cacheKey);
      } else {
        loadMemValue(cacheKey, remote ?? empty);
      }
    }).catch(() => {
      // Ensure loaded even on error
      if (!(cacheKey in getStore().mem)) loadMemValue(cacheKey, empty);
    });
  }, [date, type, token, userId, rev]); // eslint-disable-line

  // ── Force-reload trigger (replaces daylab:refresh event) ─────────────────
  // Components that previously dispatched daylab:refresh now call clearMemKey(key)
  // or call setRev() on a specific useDbSave instance. For the general "refresh
  // all of type X" pattern, we keep listening to the legacy event for now so
  // older callsites don't break — this can be removed once all callers are updated.
  useEffect(() => {
    const handler = (e) => {
      if (!e.detail?.types || e.detail.types.includes(type)) {
        clearMemKey(cacheKey);
        setRev(r => r + 1);
      }
    };
    window.addEventListener("daylab:refresh", handler);
    return () => window.removeEventListener("daylab:refresh", handler);
  }, [type, cacheKey]); // eslint-disable-line

  // ── Flush on visibility/unload ────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    const flush = () => {
      clearTimeout(timerRef.current);
      if (getStore().dirty[cacheKey]) {
        dbSave(dateRef.current, type, getStore().mem[cacheKey], token);
        clearDirty(cacheKey);
      }
    };
    const onVis = () => {
      if (document.hidden) flush();
      else { flush(); setRev(r => r + 1); }
    };
    const poll = setInterval(() => {
      if (!getStore().dirty[cacheKey]) setRev(r => r + 1);
    }, 5 * 60 * 1000);
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(poll);
    };
  }, [type, token, cacheKey]); // eslint-disable-line

  // ── setValue ──────────────────────────────────────────────────────────────
  // IMPORTANT: use `date` from the closure (not `dateRef.current`) so that a
  // stale setValue captured by DayLabEditor's unmount flush always saves to
  // its own date, even if `dateRef.current` has advanced to a new date.
  const setValue = useCallback((u, { undoLabel, skipHistory } = {}) => {
    const prev = getStore().mem[cacheKey] ?? empty;
    const next = typeof u === "function" ? u(prev) : u;

    setMemValue(cacheKey, next);           // reactive update via store
    dbSave(date, type, next, token);
    clearDirty(cacheKey);

    if (!skipHistory && undoLabel) {
      pushHistory({
        label: undoLabel,
        undo: () => {
          setMemValue(cacheKey, prev);
          clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            dbSave(date, type, prev, token);
            clearDirty(cacheKey);
          }, 200);
        },
        redo: () => {
          setMemValue(cacheKey, next);
          clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            dbSave(date, type, next, token);
            clearDirty(cacheKey);
          }, 200);
        },
      });
    }
  }, [type, token, cacheKey]); // eslint-disable-line

  // markDirty — update the in-memory cache without an immediate DB save.
  // The beforeunload / pagehide flush will persist the value to the server.
  const markDirty = useCallback((v) => {
    setMemValue(cacheKey, v);
  }, [cacheKey]); // eslint-disable-line

  return { value, setValue, loaded, markDirty };
}
