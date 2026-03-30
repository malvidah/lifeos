"use client";
import { useState, useEffect } from "react";

export function useIsMobile() {
  const [mobile, setMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia("(max-width: 768px)").matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const handler = (e) => setMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return mobile;
}

// Persists journal mode per device type (mobile vs desktop) so each context
// remembers its own preference across hard refreshes and new sessions.
// Defaults: mobile → 'today', desktop → 'recent'.
export function useJournalMode() {
  const isMobile = typeof window !== 'undefined'
    ? window.matchMedia("(max-width: 768px)").matches
    : false;
  const storageKey = isMobile ? 'journalMode:mobile' : 'journalMode:desktop';
  const defaultMode = isMobile ? 'today' : 'recent';

  const [mode, setModeState] = useState(() => {
    if (typeof window === 'undefined') return defaultMode;
    return localStorage.getItem(storageKey) ?? defaultMode;
  });

  // Re-read from storage when the breakpoint crosses (e.g. window resize),
  // so the displayed mode always matches the active device bucket.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const handler = () => {
      const mobile = mq.matches;
      const key = mobile ? 'journalMode:mobile' : 'journalMode:desktop';
      const def = mobile ? 'today' : 'recent';
      setModeState(localStorage.getItem(key) ?? def);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const setMode = (next) => {
    localStorage.setItem(storageKey, next);
    setModeState(next);
  };

  return [mode, setMode];
}

export function useCollapse(key, defaultCollapsed = false) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return defaultCollapsed;
    const saved = localStorage.getItem(`collapse:${key}`);
    return saved !== null ? saved === "true" : defaultCollapsed;
  });
  const toggle = () => setCollapsed(prev => {
    const next = !prev;
    localStorage.setItem(`collapse:${key}`, String(next));
    return next;
  });
  return [collapsed, toggle];
}
