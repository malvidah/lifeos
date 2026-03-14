// ─── Authenticated API helper ─────────────────────────────────────────────────
// Usage:
//   import { api } from "@/lib/api";
//   const data = await api.get("/api/entries?date=2024-01-01", token);
//   const data = await api.post("/api/entries", { date, type, value }, token);
//   const data = await api.delete("/api/garmin-auth", token);

const authHeaders = (token) => ({
  "Content-Type": "application/json",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

// Emit a toast on write failures so the user sees feedback.
// Reads (GET) fail silently since stale data is low-stakes.
let _refreshingSession = false;
function notifyError(method, url, status, detail) {
  if (typeof window === 'undefined') return;
  // On 401, try refreshing the Supabase session before showing the toast
  if (status === 401 && !_refreshingSession) {
    _refreshingSession = true;
    import('@/lib/supabase').then(({ createClient }) => {
      createClient().auth.refreshSession().finally(() => { _refreshingSession = false; });
    });
  }
  const endpoint = url.replace(/\?.*/, '').replace(/^\/api\//, '');
  const message = status === 401 ? 'Session expired — please reload'
    : detail ? `${endpoint}: ${detail}` : `Save failed (${endpoint})`;
  window.dispatchEvent(new CustomEvent('daylab:toast', { detail: { message, type: 'error' } }));
}

export const api = {
  async get(url, token) {
    const res = await fetch(url, { headers: authHeaders(token) });
    if (!res.ok) {
      if (res.status === 401) notifyError('GET', url, 401);
      return null;
    }
    return res.json().catch(() => null);
  },

  async post(url, body, token) {
    const res = await fetch(url, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      notifyError('POST', url, res.status, errBody?.error);
      return { ok: false, status: res.status };
    }
    return res.json().catch(() => null);
  },

  async patch(url, body, token) {
    const res = await fetch(url, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    if (!res.ok) { notifyError('PATCH', url, res.status); return null; }
    return res.json().catch(() => null);
  },

  async delete(url, token, body) {
    const opts = { method: "DELETE", headers: authHeaders(token) };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) { notifyError('DELETE', url, res.status); return null; }
    return res.json().catch(() => null);
  },
};
