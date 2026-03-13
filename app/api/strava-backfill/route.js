import { withAuth } from '../_lib/auth.js';

export const POST = withAuth(async (request, { supabase, user }) => {
  // Get client creds: prefer user_settings, fall back to env
  const { data: settingsRow } = await supabase
    .from('user_settings').select('data').eq('user_id', user.id).single();
  const s = settingsRow?.data ?? {};
  const clientId     = s.stravaClientId     || process.env.STRAVA_CLIENT_ID;
  const clientSecret = s.stravaClientSecret || process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return Response.json({ error: 'no_strava_creds' }, { status: 404 });

  // Strava token still stored in entries (strava-connect not yet migrated)
  const { data: tokenRow } = await supabase.from('entries').select('data')
    .eq('type', 'strava_token').eq('date', '0000-00-00').eq('user_id', user.id).maybeSingle();
  if (!tokenRow?.data?.access_token) return Response.json({ error: 'not_connected' }, { status: 404 });

  let { access_token, refresh_token, expires_at } = tokenRow.data;

  // Refresh token if expired
  if (Date.now() / 1000 > expires_at - 300) {
    const r = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret,
        grant_type: 'refresh_token', refresh_token }),
    });
    const refreshed = await r.json();
    if (refreshed.access_token) {
      access_token    = refreshed.access_token;
      refresh_token   = refreshed.refresh_token;
      expires_at      = refreshed.expires_at;
      await supabase.from('entries').upsert(
        { date: '0000-00-00', type: 'strava_token', user_id: user.id,
          data: { access_token, refresh_token, expires_at }, updated_at: new Date().toISOString() },
        { onConflict: 'date,type,user_id' }
      );
    }
  }

  // Fetch all activities paginated (up to 2 years)
  const since = Math.floor(Date.now() / 1000) - 2 * 365 * 24 * 3600;
  let page = 1, totalUpserted = 0;

  while (true) {
    const res = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?after=${since}&per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    const activities = await res.json();
    if (!Array.isArray(activities) || activities.length === 0) break;

    // Upsert each activity as an individual row in the workouts table
    const rows = activities
      .filter(a => a.start_date_local && a.id)
      .map(a => ({
        user_id:     user.id,
        date:        a.start_date_local.split('T')[0],
        source:      'strava',
        type:        a.type || null,
        title:       a.name || a.type || 'Workout',
        duration_min: a.moving_time ? Math.round(a.moving_time / 60) : null,
        distance_m:  a.distance || null,
        calories:    a.calories || null,
        external_id: String(a.id),
        raw: {
          elevGain:  a.total_elevation_gain ? Math.round(a.total_elevation_gain) : null,
          startTime: a.start_date_local || null,
        },
      }));

    if (rows.length > 0) {
      const { error } = await supabase.from('workouts')
        .upsert(rows, { onConflict: 'user_id,source,external_id' });
      if (!error) totalUpserted += rows.length;
    }

    if (activities.length < 100) break;
    page++;
    if (page > 20) break; // safety limit: 2000 activities
  }

  return Response.json({ ok: true, totalUpserted });
});
