"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api";
import { useStore, getStore } from "@/lib/store";
import { parseJournalBlocks } from "@/lib/parseBlocks";
import { isOnline } from "@/lib/useOnlineStatus";
import { enqueue } from "@/lib/offlineQueue";
import { markLocalSave } from "@/lib/useRealtimeSync";

// ─── DB I/O ───────────────────────────────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function todayDateKey() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
}

const TYPED_ENDPOINTS = { journal: '/api/journal', tasks: '/api/tasks', meals: '/api/meals', workouts: '/api/workouts' };

// Journal wire format: server stores/returns blocks, client works with HTML.
// These transforms run at the IO boundary so useDbSave stays HTML-based.
function journalToWire(html) {
  return { blocks: parseJournalBlocks(html || '') };
}
function journalFromWire(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return '';
  return blocks
    .sort((a, b) => a.position - b.position)
    .map(b => b.content)
    .join('');
}

export async function dbSave(date, type, data, token) {
  if (!token) return;

  // Guard 1: for date-keyed types, date must be a valid YYYY-MM-DD string.
  if (TYPED_ENDPOINTS[type]) {
    if (!date || !ISO_DATE_RE.test(date)) {
      console.error("[dbSave] Invalid date — aborting write", { date, type });
      return;
    }

    // Guard 2: block empty writes ONLY if data was never loaded for this key.
    // If data was loaded (hydrated), empty writes are intentional (user cleared content).
    // If data was never loaded (e.g., offline first-open), empty writes would overwrite real DB data.
    const isEmpty =
      data === null || data === undefined || data === "" ||
      (typeof data === "object" && !Array.isArray(data) && Object.keys(data).length === 0) ||
      (Array.isArray(data) && data.length === 0);
    const cacheKey = `${CURRENT_USER_ID || 'anon'}:${date}:${type}`;
    if (isEmpty && !isHydrated(cacheKey)) {
      console.warn("[dbSave] Skipping empty write for unhydrated key", { date, type });
      return;
    }
  }
  const url = TYPED_ENDPOINTS[type] ?? '/api/entries';
  // Journal sends pre-split blocks; other types send { date, data }
  const body = type === 'journal'
    ? { date, ...journalToWire(data) }
    : TYPED_ENDPOINTS[type] ? { date, data } : { date, type, data };
  // Mark this save so the realtime subscription ignores the echo
  const realtimeTable = type === 'journal' ? 'journal_blocks' : (TYPED_ENDPOINTS[type] ? type : 'entries');
  if (date) markLocalSave(realtimeTable, date);
  const result = await api.post(url, body, token);
  if (result && result.ok === false) {
    if (result.offline) {
      enqueue(url, body, token);
      return;
    }
    console.warn("[dbSave] Save failed", { date, type, status: result.status });
  }
}

// Unload-safe save via sendBeacon — used ONLY by the beforeunload/pagehide flush.
function dbSaveBeacon(date, type, data, token) {
  if (!token) return;
  // Same empty guard as dbSave — block empty writes for unhydrated keys
  const isEmpty =
    data === null || data === undefined || data === "" ||
    (typeof data === "object" && !Array.isArray(data) && Object.keys(data).length === 0) ||
    (Array.isArray(data) && data.length === 0);
  const cacheKey = `${CURRENT_USER_ID || 'anon'}:${date}:${type}`;
  if (isEmpty && !isHydrated(cacheKey)) return;
  const url = TYPED_ENDPOINTS[type] ?? '/api/entries';
  const bodyObj = type === 'journal'
    ? { date, ...journalToWire(data) }
    : TYPED_ENDPOINTS[type] ? { date, data } : { date, type, data };
  // If offline, enqueue (sync localStorage write) instead of beacon (fails silently offline)
  if (!isOnline()) {
    enqueue(url, bodyObj, token);
    return;
  }
  if (!navigator.sendBeacon) return;
  // Mark this save so the realtime subscription ignores the echo
  const realtimeTable = type === 'journal' ? 'journal_blocks' : (TYPED_ENDPOINTS[type] ? type : 'entries');
  if (date) markLocalSave(realtimeTable, date);
  navigator.sendBeacon(url + "?token=" + encodeURIComponent(token), new Blob([JSON.stringify(bodyObj)], { type: "application/json" }));
}

export async function dbLoad(date, type, token) {
  if (!token) return null;
  const url = TYPED_ENDPOINTS[type]
    ? `${TYPED_ENDPOINTS[type]}?date=${date}`
    : `/api/entries?date=${date}&type=${type}`;
  try {
    const d = await api.get(url, token);
    // Journal returns { blocks: [...] } — join into HTML for the editor
    if (type === 'journal') return journalFromWire(d?.blocks);
    return d?.data ?? null;
  } catch { return null; }
}

// ─── Hydration tracking ──────────────────────────────────────────────────────
// Tracks cache keys that have been loaded with real data (from server or localStorage).
// Only keys in this set are allowed to write empty values — prevents empty
// default state from overwriting real DB data, while allowing intentional clears.
const _hydrated = new Set();
export function markHydrated(key) { _hydrated.add(key); }
export function isHydrated(key) { return _hydrated.has(key); }

// ─── User cache lifecycle ─────────────────────────────────────────────────────

let CURRENT_USER_ID = null;

export function clearCacheForUser(newUserId) {
  if (CURRENT_USER_ID && CURRENT_USER_ID !== newUserId) {
    _hydrated.clear();
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
// ChatFloat and note rename logic read MEM[cacheKey] directly for cache invalidation.
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
  const dateRef      = useRef(date);
  const timerRef     = useRef(null);
  const pendingRef   = useRef(null);  // holds unsaved value from markDirty (non-reactive)
  const lastSavedRef = useRef(null);  // dedup: skip dbSave if value unchanged

  // ── Serial save queue ────────────────────────────────────────────────────
  // All writes (setValue, undo, redo, flush) go through queueSave so only
  // one POST is in-flight at a time. This prevents DELETE+INSERT races.
  const pendingSaveRef = useRef(null);  // { value, date } waiting to save
  const inflightRef    = useRef(false); // true while a POST is in progress

  const queueSave = useCallback((saveDate, saveType, saveValue, saveToken) => {
    pendingSaveRef.current = { value: saveValue, date: saveDate };
    if (inflightRef.current) return; // current save will drain the queue
    runNext(saveType, saveToken);
  }, [type, token]); // eslint-disable-line

  const runNext = useCallback(async (saveType, saveToken) => {
    if (!pendingSaveRef.current) return;
    const { value, date: saveDate } = pendingSaveRef.current;
    pendingSaveRef.current = null;
    inflightRef.current = true;
    lastSavedRef.current = value;
    try {
      await dbSave(saveDate, saveType, value, saveToken);
    } finally {
      inflightRef.current = false;
      if (pendingSaveRef.current) runNext(saveType, saveToken);
    }
  }, []); // eslint-disable-line

  // When date changes, flush any pending save for the OLD date before updating dateRef.
  if (dateRef.current !== date) {
    if (pendingRef.current !== null && pendingRef.current !== lastSavedRef.current) {
      queueSave(dateRef.current, type, pendingRef.current, token);
    }
    clearTimeout(timerRef.current);
    pendingRef.current = null;
    dateRef.current = date;
  }

  // ── Load / remote sync ────────────────────────────────────────────────────
  useEffect(() => {
    if (!token || !userId) return;
    const { mem, dirty } = getStore();

    // Offline: use cached data if available, don't overwrite with empty
    if (!isOnline()) {
      if (cacheKey in getStore().mem) markHydrated(cacheKey);
      else loadMemValue(cacheKey, empty);
      return;
    }

    // Already in cache, not dirty, first load — use cached value but verify with server
    if (cacheKey in mem && !dirty[cacheKey] && rev === 0) {
      markHydrated(cacheKey);
      // If cache has a non-empty value, trust it (avoids fetch loop)
      const cached = mem[cacheKey];
      if (cached !== null && cached !== undefined && cached !== '' && cached !== empty) {
        return;
      }
      // Cache is empty — fetch from server in case it's stale
    }

    dbLoad(date, type, token).then(remote => {
      const { dirty: d } = getStore();
      if (d[cacheKey]) {
        // A write happened while loading — save it
        dbSave(date, type, getStore().mem[cacheKey], token);
        clearDirty(cacheKey);
      } else {
        const val = remote ?? empty;
        loadMemValue(cacheKey, val);
        markHydrated(cacheKey);
        // Mark as "already saved" so a flush with identical content is a no-op.
        // Prevents duplication when hard-refresh triggers beforeunload flush
        // with the same HTML that was just loaded.
        lastSavedRef.current = val;
      }
    }).catch(() => {
      // Ensure loaded even on error — but don't overwrite existing cache
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
        // Only invalidate if the event has no date or the date matches this instance
        if (e.detail?.date && e.detail.date !== date) return;
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
      clearTimeout(timerRef.current);  // cancel any deferred setValue save
      // If a fetch is already in-flight with the latest data, don't double-save
      if (inflightRef.current && !pendingSaveRef.current && pendingRef.current === null) return;
      const val = pendingRef.current ?? (getStore().dirty[cacheKey] ? getStore().mem[cacheKey] : null);
      if (val !== null && val !== lastSavedRef.current) {
        lastSavedRef.current = val;
        pendingRef.current = null;
        pendingSaveRef.current = null; // cancel any queued fetch save
        dbSaveBeacon(dateRef.current, type, val, token);
      }
      clearDirty(cacheKey);
    };
    const onVis = () => {
      if (document.hidden) flush();   // save via sendBeacon (tab going away)
      else {
        // Tab returning — flush any pending (sendBeacon is fine here too,
        // the important thing is the timer was cancelled) then reload.
        flush();
        setRev(r => r + 1);
      }
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
    clearDirty(cacheKey);

    if (next !== lastSavedRef.current) {
      // Defer the save so that if the browser is unloading, the flush
      // handler can cancel this timer and use sendBeacon instead.
      // 300ms debounce prevents rapid-fire saves.
      pendingRef.current = next;
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (pendingRef.current === next) {
          pendingRef.current = null;
          queueSave(date, type, next, token);
        }
      }, 300);
    } else {
      pendingRef.current = null;
    }

    if (!skipHistory && undoLabel) {
      pushHistory({
        label: undoLabel,
        undo: () => {
          setMemValue(cacheKey, prev);
          clearTimeout(timerRef.current);
          pendingRef.current = null;
          queueSave(date, type, prev, token);
        },
        redo: () => {
          setMemValue(cacheKey, next);
          clearTimeout(timerRef.current);
          pendingRef.current = null;
          queueSave(date, type, next, token);
        },
      });
    }
  }, [type, token, cacheKey]); // eslint-disable-line

  // markDirty — stash the latest value without triggering a Zustand re-render.
  // The beforeunload / pagehide / visibility-change flush will persist it.
  // Uses a ref to avoid the onUpdate → setMemValue → re-render → onUpdate loop.
  const markDirty = useCallback((v) => {
    pendingRef.current = v;
  }, []);

  return { value, setValue, loaded, markDirty };
}
