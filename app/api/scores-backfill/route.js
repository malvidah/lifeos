import { createClient } from '@supabase/supabase-js';
import { batchComputeScores } from '@/lib/scoreCalc.js';
import { persistScores } from '@/lib/persistScores.js';

export const maxDuration = 60; // seconds — 730+ dates × score computation needs time

// Finds all dates with health_metrics data but no health_scores entry,
// computes scores for those gaps, and upserts them.
// Safe to run multiple times — upsert is idempotent.
// Also accepts force=true to recompute ALL dates (full recalculation).

const SOURCE_PRIORITY = ['oura', 'apple', 'garmin'];

function metricsToLegacy(row) {
  const out = {};
  if (row.hrv        != null) out.hrv          = String(row.hrv);
  if (row.rhr        != null) out.rhr          = String(row.rhr);
  if (row.sleep_hrs  != null) out.sleepHrs     = String(row.sleep_hrs);
  if (row.sleep_eff  != null) out.sleepEff     = String(row.sleep_eff);
  if (row.steps      != null) out.steps        = String(row.steps);
  if (row.active_min != null) out.activeMinutes = String(row.active_min);
  if (row.raw?.stressMins   != null) out.stressMins   = String(row.raw.stressMins);
  if (row.raw?.recoveryMins != null) out.recoveryMins = String(row.raw.recoveryMins);
  return out;
}

export async function POST(request) {
  const authHeader = request.headers.get('authorization') || '';
  const jwt = authHeader.replace('Bearer ', '').trim();
  if (!jwt) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const force = body.force === true;

  const now = new Date();
  const today = [now.getFullYear(), String(now.getMonth()+1).padStart(2,'0'), String(now.getDate()).padStart(2,'0')].join('-');

  // Fetch all health_metrics rows (all sources), all time
  // Supabase defaults to 1000 rows; raise limit for multi-year history
  const { data: metricRows, error: hErr } = await supabase
    .from('health_metrics')
    .select('date, source, hrv, rhr, sleep_hrs, sleep_eff, steps, active_min, raw')
    .eq('user_id', user.id)
    .lte('date', today)
    .order('date', { ascending: true })
    .limit(5000);

  if (hErr) return Response.json({ error: hErr.message }, { status: 500 });
  if (!metricRows?.length) return Response.json({ ok: true, scored: 0, message: 'no health data found' });

  // Best source per date, convert to legacy format for scoreCalc.js
  const bestByDate = {};
  for (const r of metricRows) {
    const cur = bestByDate[r.date];
    if (!cur || SOURCE_PRIORITY.indexOf(r.source) < SOURCE_PRIORITY.indexOf(cur.source)) {
      bestByDate[r.date] = r;
    }
  }
  const legacyByDate = Object.fromEntries(
    Object.entries(bestByDate).map(([d, r]) => [d, metricsToLegacy(r)])
  );

  let datesToScore = Object.keys(legacyByDate).sort();

  if (!force) {
    // Only score dates that don't already have a health_scores entry
    const { data: existingScores } = await supabase
      .from('health_scores')
      .select('date')
      .eq('user_id', user.id)
      .in('date', datesToScore);

    const scoredSet = new Set((existingScores || []).map(r => r.date));
    datesToScore = datesToScore.filter(d => !scoredSet.has(d));
  }

  if (!datesToScore.length) {
    return Response.json({ ok: true, scored: 0, message: 'all dates already scored' });
  }

  const allScored = batchComputeScores(legacyByDate, metricRows.length);
  const count = await persistScores(supabase, user.id, allScored, bestByDate, datesToScore);

  return Response.json({ ok: true, scored: count, total: Object.keys(legacyByDate).length });
}
