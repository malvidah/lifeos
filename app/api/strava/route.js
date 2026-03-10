import { createClient } from '@supabase/supabase-js';

function getUserClient(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return { supabase: null };
  return {
    supabase: createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    ), token
  };
}

async function getSettings(supabase, userId) {
  const { data } = await supabase.from('entries').select('data')
    .eq('type', 'settings').eq('date', 'global').eq('user_id', userId).maybeSingle();
  return data?.data || {};
}

async function getStravaTokens(supabase, userId) {
  const { data } = await supabase.from('entries').select('data')
    .eq('type', 'strava_token').eq('date', '0000-00-00').eq('user_id', userId).maybeSingle();
  return data?.data || null;
}

async function saveStravaTokens(supabase, userId, tokens) {
  await supabase.from('entries').upsert(
    { date: '0000-00-00', type: 'strava_token', data: tokens, user_id: userId, updated_at: new Date().toISOString() },
    { onConflict: 'date,type,user_id' }
  );
}

async function refreshToken(clientId, clientSecret, refreshToken) {
  const r = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  return r.json();
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') || new Date().toISOString().split('T')[0];

  const { supabase } = getUserClient(request);
  if (!supabase) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const settings = await getSettings(supabase, user.id);
  const clientId = settings.stravaClientId;
  const clientSecret = settings.stravaClientSecret;
  if (!clientId || !clientSecret) return Response.json({ activities: [] });

  let tokens = await getStravaTokens(supabase, user.id);
  if (!tokens) return Response.json({ activities: [] });

  // Refresh if expired (with 5min buffer)
  if (tokens.expires_at && Date.now() / 1000 > tokens.expires_at - 300) {
    const fresh = await refreshToken(clientId, clientSecret, tokens.refresh_token);
    if (fresh.access_token) {
      tokens = { ...tokens, access_token: fresh.access_token, refresh_token: fresh.refresh_token || tokens.refresh_token, expires_at: fresh.expires_at };
      await saveStravaTokens(supabase, user.id, tokens);
    }
  }

  try {
    // Anchor on noon of the requested date in UTC, then span ±14h to cover any local timezone.
    // This ensures the full calendar day is covered regardless of local offset (up to UTC±14).
    const noon = Math.floor(new Date(date + 'T12:00:00Z').getTime() / 1000);
    const dayStart = noon - 14 * 3600;
    const dayEnd   = noon + 14 * 3600;

    const r = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?after=${dayStart}&before=${dayEnd}&per_page=20`,
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );
    const activities = await r.json();
    console.log('[strava] date:', date, 'window:', new Date(dayStart*1000).toISOString(), '->', new Date(dayEnd*1000).toISOString());
    console.log('[strava] raw activities:', JSON.stringify(activities?.map?.(a => ({ id: a.id, name: a.name, start_date: a.start_date, start_date_local: a.start_date_local })) ?? activities));
    if (!Array.isArray(activities)) return Response.json({ error: activities.message || 'strava_error', raw: activities }, { status: 500 });

    const result = activities.map(a => ({
      id: a.id,
      name: a.name,
      type: a.type,
      sport: a.sport_type,
      duration: a.moving_time,          // seconds
      distance: a.distance ? +(a.distance / 1000).toFixed(2) : null,  // km
      calories: a.calories || null,
      elevGain: a.total_elevation_gain ? Math.round(a.total_elevation_gain) : null,
      avgHr: a.average_heartrate ? Math.round(a.average_heartrate) : null,
      avgSpeed: a.average_speed || null,   // m/s
      maxHr: a.max_heartrate ? Math.round(a.max_heartrate) : null,
      kudos: a.kudos_count,
      startTime: a.start_date_local,
    }));

    // Filter to only activities whose local date matches the requested date
    const filtered = result.filter(a => {
      if (!a.startTime) return true; // keep if no time info
      return a.startTime.slice(0, 10) === date;
    });
    return Response.json({ activities: filtered, _debug: { window: [new Date(dayStart*1000).toISOString(), new Date(dayEnd*1000).toISOString()], total: result.length, filtered: filtered.length, allDates: result.map(a => a.startTime) } });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
