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

export const api = {
  async get(url, token) {
    const res = await fetch(url, { headers: authHeaders(token) });
    if (!res.ok) return null;
    return res.json().catch(() => null);
  },

  async post(url, body, token) {
    const res = await fetch(url, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return res.json().catch(() => null);
  },

  async patch(url, body, token) {
    const res = await fetch(url, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return res.json().catch(() => null);
  },

  async delete(url, token, body) {
    const opts = { method: "DELETE", headers: authHeaders(token) };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) return null;
    return res.json().catch(() => null);
  },
};
