import { createClient } from '@supabase/supabase-js';
import {
  CALIBRATION_DAYS, n, avg, weightedAvg, stdDev,
  calcSleepScore, calcReadinessScore, calcActivityScore, calcRecoveryScore,
} from '@/lib/scoreCalc.js';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const now = new Date();
  const localToday = [now.getFullYear(), String(now.getMonth()+1).padStart(2,'0'), String(now.getDate()).padStart(2,'0')].join('-');
  const date = searchParams.get('date') || localToday;
  const isToday = date === localToday;

  if (date > localToday) {
    return Response.json({ error: 'future_date' }, { status: 400 });
  }

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

  // ── For past dates: check if stored scores row already exists ─────────────
  // If yes, return it directly — no 90-day health fetch, no recompute, no write.
  // The backfill route handles computing scores for gap dates.
  // Only today's scores get recomputed live (health data may have changed).
  if (!isToday) {
    const hasOverrides = ['sleepHrs','sleepEff','hrv','rhr','steps','activeMinutes']
      .some(k => searchParams.get(k) != null && searchParams.get(k) !== '');

    if (!hasOverrides) {
      const { data: stored } = await supabase
        .from('entries').select('data')
        .eq('user_id', user.id).eq('type', 'scores').eq('date', date)
        .maybeSingle();

      if (stored?.data?.sleepScore != null || stored?.data?.activityScore != null) {
        // Return stored scores in the same shape the frontend expects
        const d = stored.data;
        return Response.json({
          date,
          calibrationDays: d.calibrationDays ?? CALIBRATION_DAYS,
          calibrated: d.calibrated ?? true,
          sleep:     { score: d.sleepScore,     contributors: d.contributors?.sleep,     sparkline: [] },
          readiness: { score: d.readinessScore, contributors: d.contributors?.readiness, sparkline: [] },
          activity:  { score: d.activityScore,  contributors: d.contributors?.activity,  sparkline: [] },
          recovery:  { score: d.recoveryScore,  contributors: d.contributors?.recovery,  sparkline: [] },
          _cached: true,
        });
      }
      // No stored row — fall through to compute (gap date, will be filled)
    }
  }

  // ── Full compute path (today, or past date with no stored scores) ──────────
  const since = new Date(date);
  since.setDate(since.getDate() - 90);
  const sinceStr = since.toISOString().split('T')[0];

  const { data: rows, error: rowErr } = await supabase
    .from('entries')
    .select('date, type, data')
    .eq('user_id', user.id)
    .in('type', ['health', 'health_apple'])
    .gte('date', sinceStr)
    .lte('date', date)
    .order('date', { ascending: true });

  if (rowErr) return Response.json({ error: rowErr.message }, { status: 500 });

  const { count: totalHealthRows } = await supabase
    .from('entries')
    .select('date', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .in('type', ['health', 'health_apple'])
    .lte('date', date);

  // Merge Oura + Apple Health (Oura wins per-field)
  const byDate = {};
  for (const row of rows ?? []) {
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

  const dates = Object.keys(byDate).sort();
  const todayData = byDate[date] || {};

  // Merge client-side overrides (avoids debounce race for today)
  const overrides = {};
  ['sleepHrs','sleepEff','hrv','rhr','steps','activeMinutes'].forEach(k => {
    const v = searchParams.get(k);
    if (v != null && v !== '') overrides[k] = v;
  });
  const todayMerged = { ...todayData, ...overrides };

  const calibrationDays = totalHealthRows ?? dates.length;
  const calibrated = calibrationDays >= CALIBRATION_DAYS;

  const histDates = dates.filter(d => d < date);
  const history = {
    hrv:           histDates.map(d => n(byDate[d].hrv)),
    rhr:           histDates.map(d => n(byDate[d].rhr)),
    sleepHrs:      histDates.map(d => n(byDate[d].sleepHrs)),
    steps:         histDates.map(d => n(byDate[d].steps)),
    activeMinutes: histDates.map(d => n(byDate[d].activeMinutes)),
  };

  const last7Dates = histDates.slice(-7);
  const history7d  = last7Dates.map(d => byDate[d]);

  const sleep     = calcSleepScore(todayMerged, history);
  const readiness = calcReadinessScore(todayMerged, history, calibrated);
  const activity  = calcActivityScore(todayMerged, history7d);
  const recovery  = calcRecoveryScore(todayMerged, history, calibrated);

  const spark7 = last7Dates.map(d => ({
    hrv:           n(byDate[d].hrv),
    rhr:           n(byDate[d].rhr),
    sleepHrs:      n(byDate[d].sleepHrs),
    steps:         n(byDate[d].steps),
    activeMinutes: n(byDate[d].activeMinutes),
  }));

  const result = {
    date,
    calibrationDays,
    calibrated,
    sleep:     { ...sleep,     sparkline: spark7.map(d => d.sleepHrs) },
    readiness: { ...readiness, sparkline: spark7.map(d => d.hrv) },
    activity:  { ...activity,  sparkline: spark7.map(d => d.steps) },
    recovery:  { ...recovery,  sparkline: spark7.map(d => d.hrv) },
  };

  // Store scores — always for today, only for gap past dates (not cached ones)
  supabase.from('entries').upsert({
    user_id: user.id,
    date,
    type: 'scores',
    data: {
      sleepScore:     sleep.score,
      readinessScore: readiness.score,
      activityScore:  activity.score,
      recoveryScore:  recovery.score,
      calibrationDays,
      calibrated,
      contributors: {
        sleep:     sleep.contributors,
        readiness: readiness.contributors,
        activity:  activity.contributors,
        recovery:  recovery.contributors,
      },
      computedAt: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,date,type' }).then(() => {});

  return Response.json(result);
}
