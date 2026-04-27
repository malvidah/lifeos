// ─── Client-side routing wrapper ─────────────────────────────────────────────
// Calls our server proxy (which talks to OpenRouteService) and caches results
// keyed by (from, to, via, profile) so reordering stops or rerendering doesn't
// re-fetch unchanged segments.
//
// "transit" segments are NOT routed — we synthesize a straight-line geometry
// directly. The caller renders these with a dotted style.

// Routing uses plain fetch (not the api helper) so a routing failure on one
// segment doesn't fire the global error toast — we already gracefully degrade
// to a straight line when the engine refuses a segment.
async function postSegment(body, token) {
  try {
    const res = await fetch('/api/routes/segment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { error: `engine_${res.status}` };
    return res.json();
  } catch {
    return { error: 'network' };
  }
}

// In-memory cache shared across components. Cleared on page reload, which is
// fine — segments are cheap and the user's first paint wins.
const cache = new Map();

const COORD_PRECISION = 5; // ~1m at the equator. Good enough to dedupe nudges.
function roundCoord(n) { return Number(n.toFixed(COORD_PRECISION)); }

function segmentKey(from, to, via, profile) {
  const v = (via || []).map(p => `${roundCoord(p.lat)},${roundCoord(p.lng)}`).join('|');
  return `${profile}:${roundCoord(from.lat)},${roundCoord(from.lng)}>${roundCoord(to.lat)},${roundCoord(to.lng)}@${v}`;
}

// Haversine distance in metres — used for transit "straight line" segments
// so the trip totals still reflect something sensible.
function haversine(a, b) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Resolve a segment between two points.
 * Returns { coordinates: [[lng,lat], ...], distance_m, duration_s, ascent_m, mode, synthetic? }.
 * `synthetic` is true for transit segments (no real routing performed).
 */
export async function resolveSegment(from, to, via, profile, token) {
  if (!from || !to || !profile) return null;

  // Transit: skip the API entirely. A two-point straight line is the geometry;
  // distance is haversine; duration is unknown (null).
  if (profile === 'transit') {
    return {
      coordinates: [[from.lng, from.lat], [to.lng, to.lat]],
      distance_m:  haversine(from, to),
      duration_s:  null,
      ascent_m:    null,
      mode:        'transit',
      synthetic:   true,
    };
  }

  const key = segmentKey(from, to, via, profile);
  if (cache.has(key)) return cache.get(key);

  // De-dupe in-flight requests for the same key (keep the Promise in cache).
  const promise = postSegment({ from, to, via, profile }, token).then(res => {
    if (!res || res.error || !Array.isArray(res.coordinates)) {
      // Fall back to a straight line if the engine fails — better than blank.
      // Evict the cache so transient failures (401 during token boot, ORS
      // hiccup, network blip) get retried on the next render instead of
      // locking in a straight line for the rest of the session.
      cache.delete(key);
      return {
        coordinates: [[from.lng, from.lat], [to.lng, to.lat]],
        distance_m:  haversine(from, to),
        duration_s:  null,
        ascent_m:    null,
        mode:        profile,
        synthetic:   true,
        error:       res?.error || 'unknown',
      };
    }
    return { ...res, mode: profile };
  });

  cache.set(key, promise);
  return promise;
}

/**
 * Resolve every segment of a trip in parallel. Returns an array aligned with
 * stops[0..n-1] (one entry per consecutive pair). The last stop has no
 * outbound segment.
 */
export async function resolveTripSegments(stops, defaultProfile, token) {
  if (!stops || stops.length < 2) return [];
  // Stops own their own lat/lng directly. Older rows that only carried a
  // place_id have the linked place's coords as a fallback.
  const coords = (s) => ({
    lat: s.lat ?? s.place?.lat,
    lng: s.lng ?? s.place?.lng,
  });
  const segments = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const from    = coords(stops[i]);
    const to      = coords(stops[i + 1]);
    if (from.lat == null || to.lat == null) { segments.push(Promise.resolve(null)); continue; }
    const profile = stops[i].profile_to_next || defaultProfile || 'walk';
    const via     = Array.isArray(stops[i].via_waypoints) ? stops[i].via_waypoints : [];
    segments.push(resolveSegment(from, to, via, profile, token));
  }
  return Promise.all(segments);
}

// Visual style per travel mode — used by the map renderer.
export const MODE_STYLE = {
  walk:    { color: '#D08828', weight: 3, dashArray: null,    opacity: 0.85 },
  bike:    { color: '#4A9A68', weight: 4, dashArray: null,    opacity: 0.9  },
  drive:   { color: '#4878A8', weight: 4, dashArray: '8 6',   opacity: 0.85 },
  transit: { color: '#8860B8', weight: 3, dashArray: '2 6',   opacity: 0.85 },
};
