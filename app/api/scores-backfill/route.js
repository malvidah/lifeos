import { createClient } from '@supabase/supabase-js';
import { batchComputeScores } from '@/lib/scoreCalc.js';

// Finds all dates with health/health_apple data but no scores entry,
// computes scores for those gaps, and upserts them.
// Safe to run multiple times — upsert is idempotent.
// Also accepts force=true to recompute ALL dates (full recalculation).

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
  const force = body.force === true; // recompute all, not just gaps

  const now = new Date();
  const today = [now.getFullYear(), String(now.getMonth()+1).padStart(2,'0'), String(now.getDate()).padStart(2,'0')].join('-');

  // Fetch all health rows (Oura + Apple Health), all time
  const { data: healthRows, error: hErr } = await supabase
    .from('entries')
    .select('date, type, data')
    .eq('user_id', user.id)
    .in('type', ['health', 'health_apple'])
    .lte('date', today)
    .order('date', { ascending: true });

  if (hErr) return Response.json({ error: hErr.message }, { status: 500 });
  if (!healthRows?.length) return Response.json({ ok: true, scored: 0, message: 'no health data found' });

  // Build byDate map (Oura wins per-field over Apple Health)
  const byDate = {};
  for (const row of healthRows) {
    if (!byDate[row.date]) byDate[row.date] = {};
    const d = row.data || {};
    if (row.type === 'health') {
      Object.assign(byDate[row.date], d);
    } else {
      for (const [k, v] of Object.entries(d)) {
        if (!byDate[row.date][k]) byDate[row.date][k] = v;
      }
    }
  }

  let datesToScore = Object.keys(byDate).sort();

  if (!force) {
    // Only score dates that don't already have a scores entry
    const { data: existingScores } = await supabase
      .from('entries')
      .select('date')
      .eq('user_id', user.id)
      .eq('type', 'scores')
      .in('date', datesToScore);

    const scoredSet = new Set((existingScores || []).map(r => r.date));
    datesToScore = datesToScore.filter(d => !scoredSet.has(d));
  }

  if (!datesToScore.length) {
    return Response.json({ ok: true, scored: 0, message: 'all dates already scored' });
  }

  // Compute scores for the gap dates (batchComputeScores needs full byDate for history context)
  const allScored = batchComputeScores(byDate, healthRows.length);
  const toUpsert = allScored.filter(s => datesToScore.includes(s.date));

  // Upsert in batches of 200
  const BATCH = 200;
  for (let i = 0; i < toUpsert.length; i += BATCH) {
    const chunk = toUpsert.slice(i, i + BATCH).map(s => ({
      user_id: user.id,
      date: s.date,
      type: 'scores',
      data: {
        sleepScore:     s.sleepScore,
        readinessScore: s.readinessScore,
        activityScore:  s.activityScore,
        recoveryScore:  s.recoveryScore,
        calibrated:     s.calibrated,
        contributors:   s.contributors,
        computedAt:     s.computedAt,
      },
      updated_at: new Date().toISOString(),
    }));
    const { error: uErr } = await supabase
      .from('entries')
      .upsert(chunk, { onConflict: 'user_id,date,type' });
    if (uErr) return Response.json({ error: uErr.message }, { status: 500 });
  }

  return Response.json({ ok: true, scored: toUpsert.length, total: Object.keys(byDate).length });
}
