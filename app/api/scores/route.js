import { createClient } from '@supabase/supabase-js';
import {
  CALIBRATION_DAYS, n, avg, weightedAvg, stdDev,
  calcSleepScore, calcReadinessScore, calcActivityScore, calcRecoveryScore,
} from '../../../../lib/scoreCalc.js';

// ─── Route ────────────────────────────────────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  // Always use local date from client — toISOString() would give UTC which is wrong after 4pm PST
  const now = new Date();
  const localToday = [now.getFullYear(), String(now.getMonth()+1).padStart(2,'0'), String(now.getDate()).padStart(2,'0')].join('-');
  const date = searchParams.get('date') || localToday;

  // Refuse to compute or store scores for future dates
  if (date > localToday) {
    return Response.json({ error: 'future_date', message: 'Scores unavailable for future dates' }, { status: 400 });
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

  // Fetch 90 days of health data (both Oura and Apple Health)
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

  // Get total historical count (all time) to determine calibration status
  const { count: totalHealthRows } = await supabase
    .from('entries')
    .select('date', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .in('type', ['health', 'health_apple'])
    .lte('date', date);

  // Merge health + health_apple by date (Oura wins per-field if both present)
  const byDate = {};
  for (const row of rows ?? []) {
    if (!byDate[row.date]) byDate[row.date] = {};
    const d = row.data || {};
    // Oura (type=health) wins; Apple Health fills gaps
    if (row.type === 'health') {
      Object.assign(byDate[row.date], d);
    } else {
      // Only fill fields that aren't already set
      for (const [k, v] of Object.entries(d)) {
        if (!byDate[row.date][k]) byDate[row.date][k] = v;
      }
    }
  }

  const dates = Object.keys(byDate).sort();
  const todayData = byDate[date] || {};
  // Merge in any params passed directly from client (avoids debounce race condition)
  const overrides = {};
  ['sleepHrs','sleepEff','hrv','rhr','steps','activeMinutes'].forEach(k => {
    const v = searchParams.get(k);
    if (v != null && v !== '') overrides[k] = v;
  });
  const todayMerged = { ...todayData, ...overrides };
  const calibrationDays = totalHealthRows ?? dates.length;
  const calibrated = calibrationDays >= CALIBRATION_DAYS;

  // Build history arrays (chronological, excluding today)
  const histDates = dates.filter(d => d < date);
  const history = {
    hrv:      histDates.map(d => n(byDate[d].hrv)),
    rhr:      histDates.map(d => n(byDate[d].rhr)),
    sleepHrs: histDates.map(d => n(byDate[d].sleepHrs)),
    steps:    histDates.map(d => n(byDate[d].steps)),
    activeMinutes: histDates.map(d => n(byDate[d].activeMinutes)),
  };

  // 7-day history for activity
  const last7Dates = histDates.slice(-7);
  const history7d  = last7Dates.map(d => byDate[d]);

  // Compute scores
  const sleep    = calcSleepScore(todayMerged, history);
  const readiness= calcReadinessScore(todayMerged, history, calibrated);
  const activity = calcActivityScore(todayMerged, history7d);
  const recovery = calcRecoveryScore(todayMerged, history, calibrated);

  // Build sparkline data for all scores (last 7 days of raw values)
  const spark7 = last7Dates.map(d => ({
    hrv:      n(byDate[d].hrv),
    rhr:      n(byDate[d].rhr),
    sleepHrs: n(byDate[d].sleepHrs),
    steps:    n(byDate[d].steps),
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

  // Store scores in Supabase for insights to reference (non-blocking)
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
        sleep:    sleep.contributors,
        readiness: readiness.contributors,
        activity: activity.contributors,
        recovery: recovery.contributors,
      },
      computedAt: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,date,type' }).then(() => {});

  return Response.json(result);
}
