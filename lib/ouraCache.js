// ─── Oura data cache ──────────────────────────────────────────────────────────
import { api } from "@/lib/api";
export const _ouraCache = {};

function ouraKey(userId, date) { return `${userId}|${date}`; }

export function cachedOuraFetch(date, token, userId) {
  const k = ouraKey(userId, date);
  if (_ouraCache[k]) return _ouraCache[k];
  const tzOffset = new Date().getTimezoneOffset() * -1;
  const p = api.get(`/api/oura?date=${date}&tzOffset=${tzOffset}`, token)
    .then(data => {
      const hasData = data && !data.error && Object.keys(data).length > 0;
      if (!hasData) delete _ouraCache[k];
      return data ?? {};
    })
    .catch(() => { delete _ouraCache[k]; return {}; });
  _ouraCache[k] = p;
  setTimeout(() => { delete _ouraCache[k]; }, 5 * 60 * 1000);
  return p;
}

export function bustOuraCache(userId, date) {
  delete _ouraCache[`${userId}|${date}`];
}
