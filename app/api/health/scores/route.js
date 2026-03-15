import { withAuth } from '../../_lib/auth.js';

// GET /api/health/scores?start=YYYY-MM-DD&end=YYYY-MM-DD
//   Returns all health_scores rows in a date range for calendar dots.
//
// POST /api/health/scores
//   Upserts one health_scores row. Called by /api/scores after computing.
//   Body: { date, winning_source, sleep_score?, readiness_score?, activity_score?,
//           recovery_score?, contributors?, calibrated?, calibration_days? }

export const GET = withAuth(async (req, { supabase, user }) => {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get('start');
  const end   = searchParams.get('end');
  if (!start || !end) return Response.json({ error: 'start and end required' }, { status: 400 });

  const { data, error } = await supabase
    .from('health_scores')
    .select('date, sleep_score, readiness_score, activity_score, recovery_score')
    .eq('user_id', user.id)
    .gte('date', start).lte('date', end)
    .order('date', { ascending: true })
    .limit(3000);
  if (error) throw error;

  return Response.json({ rows: data ?? [] });
});

export const POST = withAuth(async (req, { supabase, user }) => {
  const {
    date, winning_source = null,
    sleep_score = null, readiness_score = null,
    activity_score = null, recovery_score = null,
    contributors = null, calibrated = false, calibration_days = null,
  } = await req.json();

  if (!date) return Response.json({ error: 'date required' }, { status: 400 });

  const { data, error } = await supabase
    .from('health_scores')
    .upsert({
      user_id: user.id, date, winning_source,
      sleep_score, readiness_score, activity_score, recovery_score,
      contributors, calibrated, calibration_days,
      computed_at: new Date().toISOString(),
    }, { onConflict: 'user_id,date' })
    .select()
    .single();
  if (error) throw error;

  return Response.json({ score: data });
});
