const _ouraCache = {};
function ouraKey(userId, date) { return `${userId}|${date}`; }
function cachedOuraFetch(date, token, userId) {
  const k = ouraKey(userId, date);
  if (_ouraCache[k]) return _ouraCache[k];
  // Pass timezone offset so server computes the correct local "today"
  const tzOffset = new Date().getTimezoneOffset() * -1; // minutes, e.g. -480 for PST
  const p = fetch(`/api/oura?date=${date}&tzOffset=${tzOffset}`,{headers:{Authorization:`Bearer ${token}`}})
    .then(r=>r.json())
    .then(data => {
      // Don't cache error or empty responses — retry on next access
      const hasData = data && !data.error && Object.keys(data).length > 0;
      if (!hasData) delete _ouraCache[k];
      return data;
    })
    .catch(()=>{ delete _ouraCache[k]; return {}; });
  _ouraCache[k] = p;
  // Expire after 5 minutes
  setTimeout(()=>{ delete _ouraCache[k]; }, 5 * 60 * 1000);
  return p;
}

export function bustOuraCache(userId, date) { delete _ouraCache[userId+'|'+date]; }
export { _ouraCache };
