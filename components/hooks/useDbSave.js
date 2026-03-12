"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { dbSave, dbLoad } from "../utils/db.js";
import { MEM, DIRTY, pushHistory } from "./cache.js";
export function useDbSave(date, type, empty, token, userId) {
  // Include userId in cache key so different users never share cache entries
  const cacheKey = `${userId||"anon"}:${date}:${type}`;
  const prevCacheKey = useRef(cacheKey);
  const [value, _set] = useState(() => MEM[cacheKey] ?? empty);
  const [loaded, setLoaded] = useState(cacheKey in MEM);
  const [rev, setRev] = useState(0);
  const live = useRef(value);
  const dateRef = useRef(date);
  const timerRef = useRef(null);
  live.current = value;

  // When date changes the cacheKey changes — immediately show empty/cached value
  // so the previous date's data is never visible on the new date
  if (prevCacheKey.current !== cacheKey) {
    prevCacheKey.current = cacheKey;
    const next = MEM[cacheKey] ?? empty;
    live.current = next;
    _set(next);
    setLoaded(cacheKey in MEM);
  }

  // Listen for external refresh events (e.g. from voice input)
  useEffect(() => {
    const handler = (e) => {
      if (!e.detail?.types || e.detail.types.includes(type)) {
        // Clear cache so we get fresh DB data
        delete MEM[cacheKey];
        delete DIRTY[cacheKey];
        setRev(r => r + 1);
      }
    };
    // Sync from sibling hook instances that wrote to the same cache key
    const memHandler = (e) => {
      if (e.detail?.key === cacheKey && e.detail.value !== live.current) {
        live.current = e.detail.value;
        _set(e.detail.value);
      }
    };
    window.addEventListener('lifeos:mem-update', memHandler);
    window.addEventListener('lifeos:refresh', handler);
    // Restore snapshot (from undo of AI entry)
    const restoreHandler = (e) => {
      if (e.detail?.keys?.includes(cacheKey)) {
        const restored = MEM[cacheKey];
        if (restored !== undefined) { live.current = restored; _set(restored); }
      }
    };
    window.addEventListener('lifeos:snapshot-restore', restoreHandler);
    return () => { window.removeEventListener('lifeos:mem-update', memHandler); window.removeEventListener('lifeos:refresh', handler); window.removeEventListener('lifeos:snapshot-restore', restoreHandler); };
  }, [type, cacheKey]);

  // Fetch from DB whenever date/type/token/userId changes, or rev bumps (poll/visibility)
  useEffect(() => {
    if (!token || !userId) return;
    dateRef.current = date;
    // Use cache only for initial render (rev===0) when data is clean
    if (rev === 0 && cacheKey in MEM && !DIRTY[cacheKey]) {
      _set(MEM[cacheKey]); live.current = MEM[cacheKey]; setLoaded(true); return;
    }
    // Always fetch from DB on rev bump or dirty state
    dbLoad(date, type, token).then(remote => {
      if (DIRTY[cacheKey]) {
        // User has typed since we started fetching — last local write wins, don't overwrite
        // But save immediately to push local to DB
        dbSave(date, type, live.current, token);
        DIRTY[cacheKey] = false;
      } else {
        // No local changes — accept DB value authoritatively
        const val = remote ?? empty;
        MEM[cacheKey] = val; _set(val); live.current = val;
      }
      setLoaded(true);
    }).catch(() => setLoaded(true)); // on error, show what we have
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
      if (document.hidden) {
        flush(); // leaving — save immediately
      } else {
        flush(); // returning — save then re-fetch
        setRev(r => r + 1);
      }
    };
    const onPageHide = () => flush();
    // Poll every 5min passively — only if no local dirty changes
    // (single-user app; visibility flush + beforeunload cover real-time needs)
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

  const setValue = useCallback((u, {undoLabel, skipHistory} = {}) => {
    const prev = live.current;
    const next = typeof u === "function" ? u(live.current) : u;
    live.current = next;
    MEM[cacheKey] = next;
    DIRTY[cacheKey] = true;
    _set(next);
    // Notify sibling hook instances with the same cacheKey
    window.dispatchEvent(new CustomEvent('lifeos:mem-update', { detail: { key: cacheKey, value: next } }));
    // Write to DB immediately on every setValue call.
    // Previously used a 200ms debounce (originally for keystroke batching) but
    // onBlur fires once per session — immediate write prevents data loss on navigation
    // where component unmounts before the timer fires.
    clearTimeout(timerRef.current);
    dbSave(dateRef.current, type, live.current, token);
    DIRTY[cacheKey] = false;
    // Push undo entry for meaningful edits (not AI calorie estimates, not loading)
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
