// ─── Authenticated API helper ─────────────────────────────────────────────────
// Usage:
//   import { api } from "@/lib/api";
//   const data = await api.get("/api/entries?date=2024-01-01", token);
//   const data = await api.post("/api/entries", { date, type, value }, token);
//   const data = await api.delete("/api/garmin-auth", token);

import { isOnline } from "@/lib/useOnlineStatus";

const authHeaders = (token) => ({
  "Content-Type": "application/json",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

// Emit a toast on write failures so the user sees feedback.
// Reads (GET) fail silently since stale data is low-stakes.
let _refreshPromise = null;
function notifyError(method, url, status, detail) {
  if (typeof window === 'undefined') return;
  if (status === 401) return; // handled by tryRefreshSession — don't toast immediately
  const endpoint = url.replace(/\?.*/, '').replace(/^\/api\//, '');
  const message = detail ? `${endpoint}: ${detail}` : `Save failed (${endpoint})`;
  window.dispatchEvent(new CustomEvent('daylab:toast', { detail: { message, type: 'error' } }));
}

/** Try to refresh the Supabase session once. Returns the new access token or null. */
async function tryRefreshSession() {
  if (typeof window === 'undefined') return null;
  // Coalesce concurrent refresh attempts into a single call
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = import('@/lib/supabase').then(async ({ createClient }) => {
    const { data, error } = await createClient().auth.refreshSession();
    if (error || !data?.session) {
      window.dispatchEvent(new CustomEvent('daylab:toast', {
        detail: { message: 'Session expired — please reload', type: 'error' },
      }));
      return null;
    }
    return data.session.access_token;
  }).finally(() => { _refreshPromise = null; });
  return _refreshPromise;
}

// ─── Retry with exponential backoff (write methods only) ─────────────────────
const RETRYABLE_STATUS = new Set([502, 503, 504]);

async function fetchWithRetry(url, opts, { retries = 2, baseDelay = 1000 } = {}) {
  if (!isOnline()) {
    return { _offline: true };
  }
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, opts);
      if (res.ok) return res;
      if (RETRYABLE_STATUS.has(res.status) && attempt < retries) {
        await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt)));
        continue;
      }
      return res; // non-retryable HTTP error — let caller handle
    } catch (err) {
      // Network error (offline, DNS failure, etc.)
      if (attempt < retries && isOnline()) {
        await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt)));
        continue;
      }
      return { _offline: true };
    }
  }
}

export const api = {
  async get(url, token) {
    try {
      let res = await fetch(url, { headers: authHeaders(token), cache: 'no-store' });
      if (res.status === 401) {
        const newToken = await tryRefreshSession();
        if (newToken) res = await fetch(url, { headers: authHeaders(newToken), cache: 'no-store' });
      }
      if (!res.ok) return null;
      return res.json().catch(() => null);
    } catch {
      return null; // network error on GET — silent
    }
  },

  async post(url, body, token) {
    let res = await fetchWithRetry(url, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    if (res._offline) return { ok: false, offline: true };
    if (res.status === 401) {
      const newToken = await tryRefreshSession();
      if (newToken) {
        res = await fetchWithRetry(url, {
          method: "POST",
          headers: authHeaders(newToken),
          body: JSON.stringify(body),
        });
        if (res._offline) return { ok: false, offline: true };
      }
    }
    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      notifyError('POST', url, res.status, errBody?.error);
      return { ok: false, status: res.status };
    }
    return res.json().catch(() => null);
  },

  async patch(url, body, token) {
    let res = await fetchWithRetry(url, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    if (res._offline) return { ok: false, offline: true };
    if (res.status === 401) {
      const newToken = await tryRefreshSession();
      if (newToken) {
        res = await fetchWithRetry(url, {
          method: "PATCH",
          headers: authHeaders(newToken),
          body: JSON.stringify(body),
        });
        if (res._offline) return { ok: false, offline: true };
      }
    }
    if (!res.ok) { notifyError('PATCH', url, res.status); return null; }
    return res.json().catch(() => null);
  },

  async delete(url, token, body) {
    let opts = { method: "DELETE", headers: authHeaders(token) };
    if (body) opts.body = JSON.stringify(body);
    let res = await fetchWithRetry(url, opts);
    if (res._offline) return { ok: false, offline: true };
    if (res.status === 401) {
      const newToken = await tryRefreshSession();
      if (newToken) {
        opts = { method: "DELETE", headers: authHeaders(newToken) };
        if (body) opts.body = JSON.stringify(body);
        res = await fetchWithRetry(url, opts);
        if (res._offline) return { ok: false, offline: true };
      }
    }
    if (!res.ok) { notifyError('DELETE', url, res.status); return null; }
    return res.json().catch(() => null);
  },
};
