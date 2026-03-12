"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api";

// ─── In-memory cache ──────────────────────────────────────────────────────────
export const MEM = {};
export const DIRTY = {};
let CURRENT_USER_ID = null;

// ─── Global undo/redo history ─────────────────────────────────────────────────
export const HISTORY = { stack: [], cursor: -1 };
export function pushHistory(entry) {
  HISTORY.stack = HISTORY.stack.slice(0, HISTORY.cursor + 1);
  HISTORY.stack.push(entry);
  if (HISTORY.stack.length > 60) HISTORY.stack.shift();
  HISTORY.cursor = HISTORY.stack.length - 1;
}
export function canUndo() { return HISTORY.cursor >= 0; }
export function canRedo() { return HISTORY.cursor < HISTORY.stack.length - 1; }
export async function doUndo() { if (canUndo()) { await HISTORY.stack[HISTORY.cursor].undo(); HISTORY.cursor--; } }
export async function doRedo() { if (canRedo()) { HISTORY.cursor++; await HISTORY.stack[HISTORY.cursor].redo(); } }

export function clearCacheForUser(newUserId) {
  if (CURRENT_USER_ID && CURRENT_USER_ID !== newUserId) {
    for (const k of Object.keys(MEM)) delete MEM[k];
    for (const k of Object.keys(DIRTY)) delete DIRTY[k];
  }
  CURRENT_USER_ID = newUserId;
}

// ─── DB operations ────────────────────────────────────────────────────────────
export async function dbSave(date, type, data, token) {
  if (!token) return;
  const url = "/api/entries";
  const body = JSON.stringify({ date, type, data });
  try {
    await api.post(url, { date, type, data }, token);
  } catch {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon(url + "?token=" + encodeURIComponent(token), blob);
    }
  }
}

export async function dbLoad(date, type, token) {
  if (!token) return null;
  try {
    const d = await api.get(`/api/entries?date=${date}&type=${type}`, token);
    return d?.data ?? null;
  } catch { return null; }
}

// ─── useDbSave hook ───────────────────────────────────────────────────────────
export function useDbSave(date, type, empty, token, userId) {
  const cacheKey = `${userId || "anon"}:${date}:${type}`;
  const prevCacheKey = useRef(cacheKey);
  const [value, _set] = useState(() => MEM[cacheKey] ?? empty);
  const [loaded, setLoaded] = useState(cacheKey in MEM);
  const [rev, setRev] = useState(0);
  const live = useRef(value);
  const dateRef = useRef(date);
  const timerRef = useRef(null);
  live.current = value;

  if (prevCacheKey.current !== cacheKey) {
    prevCacheKey.current = cacheKey;
    const next = MEM[cacheKey] ?? empty;
    live.current = next;
    _set(next);
    setLoaded(cacheKey in MEM);
  }

  useEffect(() => {
    const handler = (e) => {
      if (!e.detail?.types || e.detail.types.includes(type)) {
        delete MEM[cacheKey];
        delete DIRTY[cacheKey];
        setRev(r => r + 1);
      }
    };
    const memHandler = (e) => {
      if (e.detail?.key === cacheKey && e.detail.value !== live.current) {
        live.current = e.detail.value;
        _set(e.detail.value);
      }
    };
    window.addEventListener('daylab:mem-update', memHandler);
    window.addEventListener('daylab:refresh', handler);
    const restoreHandler = (e) => {
      if (e.detail?.keys?.includes(cacheKey)) {
        const restored = MEM[cacheKey];
        if (restored !== undefined) { live.current = restored; _set(restored); }
      }
    };
    window.addEventListener('daylab:snapshot-restore', restoreHandler);
    return () => {
      window.removeEventListener('daylab:mem-update', memHandler);
      window.removeEventListener('daylab:refresh', handler);
      window.removeEventListener('daylab:snapshot-restore', restoreHandler);
    };
  }, [type, cacheKey]);

  useEffect(() => {
    if (!token || !userId) return;
    dateRef.current = date;
    if (rev === 0 && cacheKey in MEM && !DIRTY[cacheKey]) {
      _set(MEM[cacheKey]); live.current = MEM[cacheKey]; setLoaded(true); return;
    }
    dbLoad(date, type, token).then(remote => {
      if (DIRTY[cacheKey]) {
        dbSave(date, type, live.current, token);
        DIRTY[cacheKey] = false;
      } else {
        const val = remote ?? empty;
        MEM[cacheKey] = val; _set(val); live.current = val;
      }
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [date, type, token, userId, rev]); // eslint-disable-line

  useEffect(() => {
    if (!token) return;
    const flush = () => {
      clearTimeout(timerRef.current);
      if (DIRTY[cacheKey]) {
        dbSave(dateRef.current, type, live.current, token);
        DIRTY[cacheKey] = false;
      }
    };
    const onVis = () => {
      if (document.hidden) flush();
      else { flush(); setRev(r => r + 1); }
    };
    const onPageHide = () => flush();
    const poll = setInterval(() => {
      if (!DIRTY[cacheKey]) setRev(r => r + 1);
    }, 5 * 60 * 1000);
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(poll);
    };
  }, [type, token, cacheKey]); // eslint-disable-line

  const setValue = useCallback((u, { undoLabel, skipHistory } = {}) => {
    const prev = live.current;
    const next = typeof u === "function" ? u(live.current) : u;
    live.current = next;
    MEM[cacheKey] = next;
    DIRTY[cacheKey] = true;
    _set(next);
    window.dispatchEvent(new CustomEvent('daylab:mem-update', { detail: { key: cacheKey, value: next } }));
    clearTimeout(timerRef.current);
    dbSave(dateRef.current, type, live.current, token);
    DIRTY[cacheKey] = false;
    if (!skipHistory && undoLabel) {
      pushHistory({
        label: undoLabel,
        undo: () => {
          live.current = prev; MEM[cacheKey] = prev; DIRTY[cacheKey] = true; _set(prev);
          clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => { dbSave(dateRef.current, type, prev, token); DIRTY[cacheKey] = false; }, 200);
        },
        redo: () => {
          live.current = next; MEM[cacheKey] = next; DIRTY[cacheKey] = true; _set(next);
          clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => { dbSave(dateRef.current, type, next, token); DIRTY[cacheKey] = false; }, 200);
        },
      });
    }
  }, [type, token, cacheKey]); // eslint-disable-line

  return { value, setValue, loaded };
}
