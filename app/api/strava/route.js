import { withAuth } from '../_lib/auth.js';

async function getStravaTokens(supabase, userId) {
  const { data } = await supabase.from('user_settings').select('data')
    .eq('user_id', userId).maybeSingle();
  return data?.data?.stravaToken || null;
}

async function saveStravaTokens(supabase, userId, tokens) {
  // Merge into user_settings.data.stravaToken
  const { data: existing } = await supabase.from('user_settings').select('data')
    .eq('user_id', userId).maybeSingle();
  await supabase.from('user_settings').upsert(
    { user_id: userId, data: { ...(existing?.data || {}), stravaToken: tokens } },
    { onConflict: 'user_id' }
  );
}

async function refreshStravaToken(clientId, clientSecret, refreshToken) {
  const r = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  return r.json();
}

export const GET = withAuth(async (req, { supabase, user }) => {
  const date = new URL(req.url).searchParams.get('date') || new Date().toISOString().split('T')[0];

  const { data: settingsRow } = await supabase.from('user_settings').select('data')
    .eq('user_id', user.id).maybeSingle();
  const settings = settingsRow?.data || {};
  const clientId = settings.stravaClientId || process.env.STRAVA_CLIENT_ID;
  const clientSecret = settings.stravaClientSecret || process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return Response.json({ activities: [] });

  let tokens = await getStravaTokens(supabase, user.id);
  if (!tokens) return Response.json({ activities: [] });

  // Refresh if expired (5min buffer)
  if (tokens.expires_at && Date.now() / 1000 > tokens.expires_at - 300) {
    try {
      const fresh = await refreshStravaToken(clientId, clientSecret, tokens.refresh_token);
      if (fresh.access_token) {
        tokens = { ...tokens, access_token: fresh.access_token, refresh_token: fresh.refresh_token || tokens.refresh_token, expires_at: fresh.expires_at };
        await saveStravaTokens(supabase, user.id, tokens);
      }
    } catch (e) {
      console.error('[strava] token refresh failed:', e.message);
      return Response.json({ activities: [] });
    }
  }

  // Span ±14h from noon to cover any local timezone
  const noon = Math.floor(new Date(date + 'T12:00:00Z').getTime() / 1000);
  const r = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${noon - 14*3600}&before=${noon + 14*3600}&per_page=20`,
    { headers: { Authorization: `Bearer ${tokens.access_token}` } }
  );
  if (!r.ok) return Response.json({ activities: [], error: `strava ${r.status}` });
  const activities = await r.json().catch(() => []);
  if (!Array.isArray(activities)) return Response.json({ activities: [] });

  const result = activities.map(a => ({
    id: a.id, name: a.name, type: a.type, sport: a.sport_type,
    duration: a.moving_time, distance: a.distance ? +(a.distance / 1000).toFixed(2) : null,
    calories: a.calories || null, elevGain: a.total_elevation_gain ? Math.round(a.total_elevation_gain) : null,
    avgHr: a.average_heartrate ? Math.round(a.average_heartrate) : null,
    avgSpeed: a.average_speed || null, maxHr: a.max_heartrate ? Math.round(a.max_heartrate) : null,
    kudos: a.kudos_count, startTime: a.start_date_local,
  })).filter(a => !a.startTime || a.startTime.slice(0, 10) === date);

  // ── Persist to workouts table ─────────────────────────────────────────────
  await Promise.all(result.map(a =>
    supabase.from('workouts').upsert({
      user_id:      user.id,
      date:         a.startTime ? a.startTime.slice(0, 10) : date,
      source:       'strava',
      type:         a.sport || a.type || 'workout',
      title:        a.name || null,
      duration_min: a.duration != null ? Math.round(a.duration / 60) : null,
      distance_m:   a.distance != null ? Math.round(a.distance * 1000) : null,
      calories:     a.calories || null,
      avg_hr:       a.avgHr || null,
      external_id:  String(a.id),
      raw:          a,
    }, { onConflict: 'user_id,source,external_id' })
  ));

  return Response.json({ activities: result });
});
