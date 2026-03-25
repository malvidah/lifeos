"use client";
// ─── Offline write queue ─────────────────────────────────────────────────────
// Persists failed writes to localStorage and replays them FIFO on reconnect.
// Deduplicates by url so only the latest write per endpoint matters.

import { onOnline } from "@/lib/useOnlineStatus";

const STORAGE_KEY = 'daylab:write-queue';
const MAX_RETRIES = 5;

function loadQueue() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveQueue(queue) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(queue)); }
  catch { /* quota exceeded — queue is best-effort */ }
}

// Dedup key: url (without query params) + date from body
function dedupKey(url, body) {
  const base = url.replace(/\?.*/, '');
  const date = body?.date || '';
  const type = body?.type || '';
  return `${base}:${date}:${type}`;
}

export function enqueue(url, body, token) {
  const queue = loadQueue();
  const key = dedupKey(url, body);
  // Remove older entry for same endpoint+date+type
  const filtered = queue.filter(item => dedupKey(item.url, item.body) !== key);
  filtered.push({
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    url, body, token,
    timestamp: Date.now(),
    retryCount: 0,
  });
  saveQueue(filtered);
  // Emit event so OfflineBanner can update count
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('daylab:queue-change', { detail: { length: filtered.length } }));
  }
}

export function getQueueLength() {
  return loadQueue().length;
}

export function clearQueue() {
  saveQueue([]);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('daylab:queue-change', { detail: { length: 0 } }));
  }
}

let _replaying = false;

export async function replayQueue() {
  if (_replaying) return;
  _replaying = true;
  try {
    const queue = loadQueue();
    if (!queue.length) return;

    const remaining = [];
    for (const item of queue) {
      // Skip malformed items (no date)
      if (!item.body?.date) continue;

      try {
        const res = await fetch(item.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(item.token ? { Authorization: `Bearer ${item.token}` } : {}),
          },
          body: JSON.stringify(item.body),
        });
        if (res.ok) continue; // success — drop from queue
        if (res.status === 401) {
          // Try session refresh
          try {
            const { createClient } = await import('@/lib/supabase');
            await createClient().auth.refreshSession();
          } catch {}
          // Keep in queue for next attempt
        }
        item.retryCount++;
        if (item.retryCount <= MAX_RETRIES) remaining.push(item);
        // else: exceeded max retries — discard and notify
        else if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('daylab:toast', {
            detail: { message: 'Some offline changes could not be saved', type: 'error' },
          }));
        }
      } catch {
        // Network still down — keep all remaining items
        remaining.push(item);
        remaining.push(...queue.slice(queue.indexOf(item) + 1));
        break;
      }
    }
    saveQueue(remaining);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('daylab:queue-change', { detail: { length: remaining.length } }));
    }
  } finally {
    _replaying = false;
  }
}

// Auto-replay on reconnect (delay lets connection stabilize)
if (typeof window !== 'undefined') {
  onOnline(() => setTimeout(replayQueue, 1500));
}

// Replay after auth is ready — called from Dashboard once token is available
export function replayIfNeeded(token) {
  if (!token) return;
  const queue = loadQueue();
  if (!queue.length) return;
  // Update stale tokens in queued items to current valid token
  const updated = queue.map(item => ({ ...item, token }));
  saveQueue(updated);
  setTimeout(replayQueue, 500);
}
