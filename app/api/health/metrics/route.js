import { withAuth } from '../../_lib/auth.js';

// POST /api/health/metrics
//   Upserts one health_metrics row. Called by Oura / Apple / Garmin sync routes.
//   Body: { date, source, hrv?, rhr?, sleep_hrs?, sleep_eff?, steps?, active_min?, raw? }

export const POST = withAuth(async (req, { supabase, user }) => {
  const {
    date, source, hrv = null, rhr = null, sleep_hrs = null,
    sleep_eff = null, steps = null, active_min = null, raw = null,
  } = await req.json();

  if (!date || !source) {
    return Response.json({ error: 'date and source required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('health_metrics')
    .upsert({
      user_id: user.id, date, source,
      hrv, rhr, sleep_hrs, sleep_eff, steps, active_min, raw,
      synced_at: new Date().toISOString(),
    }, { onConflict: 'user_id,date,source' })
    .select()
    .single();
  if (error) throw error;

  return Response.json({ metrics: data });
});
