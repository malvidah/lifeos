import { withAuth } from '../_lib/auth.js';

// GET /api/health?date=YYYY-MM-DD
//   Returns the best available health_metrics row (oura > apple > garmin)
//   plus the health_scores row for that date.
//   Response: { metrics: {...} | null, score: {...} | null, source: 'oura'|'apple'|'garmin'|null }
//
// GET /api/health?start=YYYY-MM-DD&end=YYYY-MM-DD
//   Returns an array of {date, metrics, score} for the range.
//   Used by month calendar and trend views.
//
// POST /api/health/metrics
//   { date, source, hrv?, rhr?, sleep_hrs?, sleep_eff?, steps?, active_min?, raw? }
//   Upserts one health_metrics row. Called by sync routes (oura, apple, garmin).
//
// POST /api/health/scores
//   { date, winning_source, sleep_score, readiness_score, activity_score,
//     recovery_score, contributors?, calibrated?, calibration_days? }
//   Upserts one health_scores row. Called by /api/scores after computing.
//
// DELETE /api/health?date=YYYY-MM-DD&source=oura   → remove one source row

const SOURCE_PRIORITY = ['oura', 'apple', 'garmin'];

function pickBestMetrics(rows) {
  if (!rows || rows.length === 0) return null;
  for (const src of SOURCE_PRIORITY) {
    const row = rows.find(r => r.source === src);
    if (row) return row;
  }
  return rows[0]; // fallback: whatever we have
}

// ── GET ───────────────────────────────────────────────────────────────────────

export const GET = withAuth(async (req, { supabase, user }) => {
  const { searchParams } = new URL(req.url);
  const date  = searchParams.get('date');
  const start = searchParams.get('start');
  const end   = searchParams.get('end');

  if (date) {
    // Single-day: fetch all sources + score in parallel
    const [metricsRes, scoreRes] = await Promise.all([
      supabase
        .from('health_metrics')
        .select('id, date, source, hrv, rhr, sleep_hrs, sleep_eff, steps, active_min, synced_at')
        .eq('user_id', user.id)
        .eq('date', date),
      supabase
        .from('health_scores')
        .select('id, date, winning_source, sleep_score, readiness_score, activity_score, recovery_score, contributors, calibrated, calibration_days, computed_at')
        .eq('user_id', user.id)
        .eq('date', date)
        .maybeSingle(),
    ]);

    if (metricsRes.error) throw metricsRes.error;
    if (scoreRes.error)   throw scoreRes.error;

    const best = pickBestMetrics(metricsRes.data);
    return Response.json({
      metrics: best ?? null,
      score:   scoreRes.data ?? null,
      source:  best?.source ?? null,
      all_sources: metricsRes.data ?? [],
    });
  }

  if (start && end) {
    // Range: efficient join-style parallel fetch
    const [metricsRes, scoresRes] = await Promise.all([
      supabase
        .from('health_metrics')
        .select('id, date, source, hrv, rhr, sleep_hrs, sleep_eff, steps, active_min, synced_at')
        .eq('user_id', user.id)
        .gte('date', start).lte('date', end),
      supabase
        .from('health_scores')
        .select('id, date, winning_source, sleep_score, readiness_score, activity_score, recovery_score, contributors, calibrated, calibration_days, computed_at')
        .eq('user_id', user.id)
        .gte('date', start).lte('date', end),
    ]);

    if (metricsRes.error) throw metricsRes.error;
    if (scoresRes.error)  throw scoresRes.error;

    // Group metrics by date, pick best per date
    const metricsByDate = {};
    for (const row of (metricsRes.data ?? [])) {
      if (!metricsByDate[row.date]) metricsByDate[row.date] = [];
      metricsByDate[row.date].push(row);
    }

    const scoresByDate = {};
    for (const row of (scoresRes.data ?? [])) {
      scoresByDate[row.date] = row;
    }

    // Build merged array covering all dates that have any data
    const allDates = [...new Set([
      ...Object.keys(metricsByDate),
      ...Object.keys(scoresByDate),
    ])].sort();

    const days = allDates.map(date => {
      const best = pickBestMetrics(metricsByDate[date]);
      return {
        date,
        metrics: best ?? null,
        score:   scoresByDate[date] ?? null,
        source:  best?.source ?? null,
      };
    });

    return Response.json({ days });
  }

  return Response.json({ error: 'date or start+end required' }, { status: 400 });
});

// ── POST /api/health/metrics ──────────────────────────────────────────────────
// Upserts a health_metrics row (called by sync routes)

export const POST = withAuth(async (req, { supabase, user }) => {
  const url     = new URL(req.url);
  const segment = url.pathname.split('/').pop(); // 'metrics' | 'scores' | 'health'

  if (segment === 'scores') {
    const {
      date, winning_source, sleep_score, readiness_score,
      activity_score, recovery_score, contributors = null,
      calibrated = false, calibration_days = null,
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
  }

  // Default: upsert metrics row
  const {
    date, source, hrv = null, rhr = null, sleep_hrs = null,
    sleep_eff = null, steps = null, active_min = null, raw = null,
  } = await req.json();

  if (!date || !source) return Response.json({ error: 'date and source required' }, { status: 400 });

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

// ── DELETE ────────────────────────────────────────────────────────────────────

export const DELETE = withAuth(async (req, { supabase, user }) => {
  const { searchParams } = new URL(req.url);
  const date   = searchParams.get('date');
  const source = searchParams.get('source');

  if (!date) return Response.json({ error: 'date required' }, { status: 400 });

  let query = supabase
    .from('health_metrics')
    .delete()
    .eq('user_id', user.id)
    .eq('date', date);

  if (source) query = query.eq('source', source);

  const { error } = await query;
  if (error) throw error;

  return Response.json({ ok: true });
});
