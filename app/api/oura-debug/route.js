import { createClient } from '@supabase/supabase-js';

// Debug endpoint — shows exactly what Oura returns for a date.
// Usage: GET /api/oura-debug?date=2026-03-06
// Remove or protect this route after debugging.

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') || new Date().toISOString().split('T')[0];

  const authHeader = request.headers.get('authorization') || '';
  // Also accept token as query param for browser-direct access
  const jwt = authHeader.replace('Bearer ', '').trim() 
    || searchParams.get('token') || '';
  if (!jwt) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { data: settingsRow } = await supabase.from('entries').select('data')
    .eq('type', 'settings').eq('date', 'global').eq('user_id', user.id).maybeSingle();

  const ouraToken = settingsRow?.data?.ouraToken;
  if (!ouraToken) return Response.json({ error: 'no_token' });

  const next1 = new Date(date); next1.setDate(next1.getDate() + 1);
  const nextDate = next1.toISOString().split('T')[0];
  const prev2 = new Date(date); prev2.setDate(prev2.getDate() - 2);
  const prevDate2 = prev2.toISOString().split('T')[0];

  const h = { Authorization: `Bearer ${ouraToken}` };

  const [sleepRes, sessionRes] = await Promise.all([
    fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${date}&end_date=${nextDate}`, { headers: h }),
    fetch(`https://api.ouraring.com/v2/usercollection/sleep?start_date=${prevDate2}&end_date=${nextDate}`, { headers: h }),
  ]);

  const sleepData   = await sleepRes.json();
  const sessionData = await sessionRes.json();

  // Show exactly what fields and day values come back
  return Response.json({
    requestedDate: date,
    queryWindow: { sessions: `${prevDate2} → ${nextDate}`, daily: `${date} → ${nextDate}` },
    daily_sleep: {
      count: sleepData.data?.length ?? 0,
      records: (sleepData.data ?? []).map(d => ({
        day: d.day,
        score: d.score,
        efficiency_contributor: d.contributors?.sleep_efficiency,
      })),
    },
    sleep_sessions: {
      count: sessionData.data?.length ?? 0,
      records: (sessionData.data ?? []).map(s => ({
        day: s.day,
        type: s.type,
        bedtime_start: s.bedtime_start,
        bedtime_end: s.bedtime_end,
        total_sleep_duration_hrs: s.total_sleep_duration ? +(s.total_sleep_duration / 3600).toFixed(2) : null,
        average_hrv: s.average_hrv,
        lowest_heart_rate: s.lowest_heart_rate,
        efficiency: s.efficiency,
      })),
    },
  });
}
