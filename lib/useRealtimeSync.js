"use client";
// ─── Real-time sync across devices ───────────────────────────────────────────
// Subscribes to Supabase Realtime postgres_changes on key tables.
// When a change arrives from ANOTHER client, dispatches events so existing
// components (Tasks, Journal, HabitsCard, etc.) reload their data.
//
// Filters out changes from THIS client using a unique clientId stored in
// each row's `_client_id` metadata (not available — so we use a timestamp-
// based heuristic: ignore changes that arrive within 2s of our own saves).

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase";
import { getStore } from "@/lib/store";

// Unique ID for this browser tab — used to ignore our own changes
const CLIENT_ID = typeof crypto !== "undefined" && crypto.randomUUID
  ? crypto.randomUUID()
  : Math.random().toString(36).slice(2);

// Track recent saves from this client so we can filter them out
const _recentSaves = new Map(); // key: "table:date" → timestamp

/** Call this after any local save to suppress the resulting realtime echo. */
export function markLocalSave(table, date) {
  const key = `${table}:${date}`;
  _recentSaves.set(key, Date.now());
  // Auto-cleanup after 5s
  setTimeout(() => _recentSaves.delete(key), 5000);
}

function isOwnChange(table, date) {
  const key = `${table}:${date}`;
  const ts = _recentSaves.get(key);
  if (!ts) return false;
  // If we saved within the last 3 seconds, assume it's our own echo
  return Date.now() - ts < 3000;
}

// Tables we care about for realtime sync
const TRACKED_TABLES = ["journal_blocks", "tasks", "entries", "meal_items", "workouts"];

/**
 * Hook: subscribe to Supabase Realtime for the authenticated user.
 * Call once at the Dashboard level.
 *
 * @param {string|null} userId - Current user ID (from session)
 * @param {string|null} token  - Current access token
 */
export function useRealtimeSync(userId, token) {
  const channelRef = useRef(null);

  useEffect(() => {
    if (!userId || !token) return;

    const supabase = createClient();

    // Build a single channel with multiple table subscriptions
    let channel = supabase.channel(`sync:${userId}`, {
      config: { broadcast: { self: false } },
    });

    for (const table of TRACKED_TABLES) {
      channel = channel.on(
        "postgres_changes",
        {
          event: "*", // INSERT, UPDATE, DELETE
          schema: "public",
          table,
          filter: `user_id=eq.${userId}`,
        },
        (payload) => handleChange(table, payload, userId)
      );
    }

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        console.log("[realtime] Connected — listening for cross-device changes");
      }
    });

    channelRef.current = channel;

    // When user finishes editing (blur from contenteditable), flush any
    // deferred journal refresh that arrived while they were typing.
    const onFocusOut = (e) => {
      const pending = window._daylabPendingJournalRefresh;
      if (!pending) return;
      // Only act if focus left a contenteditable / .dl-editor element
      const left = e.target?.closest?.(".dl-editor") || e.target?.isContentEditable;
      if (!left) return;
      // Small delay to let the blur-triggered save complete first
      setTimeout(() => {
        const date = window._daylabPendingJournalRefresh;
        if (!date) return;
        window._daylabPendingJournalRefresh = null;
        invalidateCache(userId, date, "journal");
        window.dispatchEvent(
          new CustomEvent("daylab:refresh", {
            detail: { types: ["journal"], date },
          })
        );
      }, 500);
    };
    document.addEventListener("focusout", onFocusOut);

    return () => {
      document.removeEventListener("focusout", onFocusOut);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [userId, token]);
}

// ─── Change handler ──────────────────────────────────────────────────────────

function handleChange(table, payload, userId) {
  const row = payload.new || payload.old || {};
  const date = row.date || null;

  // Filter out our own saves
  if (date && isOwnChange(table, date)) {
    return;
  }

  console.log(`[realtime] External change: ${table} ${payload.eventType}`, date ? `(${date})` : "");

  switch (table) {
    case "tasks":
      // Tasks uses row-level CRUD — just trigger a reload
      window.dispatchEvent(new CustomEvent("daylab:tasks-saved"));
      window.dispatchEvent(new CustomEvent("daylab:habits-changed"));
      // Also invalidate the mem cache for tasks on that date
      if (date) invalidateCache(userId, date, "tasks");
      break;

    case "journal_blocks":
      // Trigger journal reload — but only if the user isn't actively editing.
      // If a TipTap editor is focused, the user has unsaved keystrokes that
      // markDirty() tracks in a ref (not in the store dirty map). Reloading
      // would overwrite their work. Instead, defer until the editor blurs.
      if (date) {
        const editorFocused =
          document.activeElement?.closest?.(".dl-editor") ||
          document.activeElement?.isContentEditable;
        if (editorFocused) {
          // Stash a flag so the next blur/visibility-change triggers a reload
          window._daylabPendingJournalRefresh = date;
        } else {
          invalidateCache(userId, date, "journal");
          window.dispatchEvent(
            new CustomEvent("daylab:refresh", {
              detail: { types: ["journal"], date },
            })
          );
        }
      }
      break;

    case "entries":
      // Generic entries — refresh all types for that date
      if (date) {
        const type = row.type;
        if (type) invalidateCache(userId, date, type);
        window.dispatchEvent(
          new CustomEvent("daylab:refresh", {
            detail: { types: type ? [type] : undefined, date },
          })
        );
      }
      break;

    case "meal_items":
      if (date) {
        invalidateCache(userId, date, "meals");
        window.dispatchEvent(
          new CustomEvent("daylab:refresh", {
            detail: { types: ["meals"], date },
          })
        );
      }
      break;

    case "workouts":
      if (date) {
        invalidateCache(userId, date, "workouts");
        window.dispatchEvent(
          new CustomEvent("daylab:refresh", {
            detail: { types: ["workouts"], date },
          })
        );
      }
      break;
  }
}

// ─── Cache invalidation ──────────────────────────────────────────────────────

function invalidateCache(userId, date, type) {
  const cacheKey = `${userId}:${date}:${type}`;
  const store = getStore();
  // Only invalidate if the key is not currently dirty (unsaved local changes)
  if (!store.dirty[cacheKey]) {
    store.clearMemKey(cacheKey);
  }
}
