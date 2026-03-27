"use client";
import { useState, useCallback, useRef, useEffect } from "react";

const STORAGE_KEY = "daylab:tips-shown";

function getShownTips() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function markTipShown(tipId) {
  try {
    const shown = getShownTips();
    if (!shown.includes(tipId)) {
      shown.push(tipId);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(shown));
    }
  } catch { /* ignore */ }
}

/**
 * useTip(tipId) — tracks whether a contextual tip has been shown.
 * Returns { shown, show, dismiss, visible } where:
 *   - shown: true if this tip was already dismissed (persisted)
 *   - visible: true if the tip is currently being displayed
 *   - show(): display the tip (if not already shown)
 *   - dismiss(): hide and persist
 */
export function useTip(tipId) {
  const [visible, setVisible] = useState(false);
  const [shown, setShown] = useState(() => getShownTips().includes(tipId));
  const timerRef = useRef(null);

  const dismiss = useCallback(() => {
    setVisible(false);
    setShown(true);
    markTipShown(tipId);
    clearTimeout(timerRef.current);
  }, [tipId]);

  const show = useCallback(() => {
    if (getShownTips().includes(tipId)) return;
    setVisible(true);
    // Auto-dismiss after 8 seconds
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(dismiss, 8000);
  }, [tipId, dismiss]);

  // Cleanup timer on unmount
  useEffect(() => () => clearTimeout(timerRef.current), []);

  return { shown, visible, show, dismiss };
}
