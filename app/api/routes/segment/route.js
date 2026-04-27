// POST /api/routes/segment
// Body: { from: {lat, lng}, to: {lat, lng}, via?: [{lat, lng}], profile: 'walk'|'bike'|'drive' }
// Returns: { coordinates: [[lng,lat], ...], distance_m, duration_s, ascent_m }
//
// "transit" segments are NOT routed — clients draw a straight dotted line
// directly between stops, so this endpoint is not called for transit.
//
// We proxy OpenRouteService server-side so the API key stays out of the bundle
// and we can swap the engine later without touching client code.
//
// No `withAuth` wrapper — this endpoint doesn't read any user data, just
// forwards a coordinate pair to ORS. Required so the public profile (no
// session) can render real routes instead of straight-line fallbacks. ORS's
// per-key quota acts as the rate limit.

const PROFILE_MAP = {
  walk:  'foot-walking',
  bike:  'cycling-regular',
  drive: 'driving-car',
};

export async function POST(req) {
  try {
    const apiKey = process.env.ORS_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'routing_unavailable' }, { status: 503 });
    }

    let body;
    try { body = await req.json(); } catch { return Response.json({ error: 'invalid json' }, { status: 400 }); }

    const { from, to, via = [], profile } = body;
    const orsProfile = PROFILE_MAP[profile];
    if (!orsProfile) return Response.json({ error: 'invalid profile' }, { status: 400 });
    if (!coord(from) || !coord(to)) return Response.json({ error: 'invalid coords' }, { status: 400 });

    // ORS coordinates are [lng, lat] pairs.
    const coordinates = [
      [from.lng, from.lat],
      ...via.filter(coord).map(v => [v.lng, v.lat]),
      [to.lng, to.lat],
    ];

    const url = `https://api.openrouteservice.org/v2/directions/${orsProfile}/geojson`;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ coordinates, elevation: true }),
      });
    } catch {
      return Response.json({ error: 'routing_network_error' }, { status: 502 });
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return Response.json({ error: 'routing_engine_error', status: res.status, detail }, { status: 502 });
    }

    const data = await res.json();
    const feature = data?.features?.[0];
    if (!feature) return Response.json({ error: 'no_route' }, { status: 404 });

    const summary = feature.properties?.summary || {};
    const ascent  = feature.properties?.ascent ?? null;

    return Response.json({
      coordinates: feature.geometry?.coordinates ?? [],
      distance_m:  summary.distance ?? null,
      duration_s:  summary.duration ?? null,
      ascent_m:    ascent,
    });
  } catch (err) {
    console.error('[api] /api/routes/segment:', err);
    return Response.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}

function coord(p) {
  return p && typeof p.lat === 'number' && typeof p.lng === 'number';
}
