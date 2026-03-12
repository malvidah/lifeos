import { withAuth } from '../_lib/auth.js';
import {
  CALIBRATION_DAYS, n,
  calcSleepScore, calcReadinessScore, calcActivityScore, calcRecoveryScore,
} from '@/lib/scoreCalc.js';

export const GET = withAuth(async (req, { supabase, user }) => {
  const { searchParams } = new URL(req.url);
  const now = new Date();
  const tzOffset = parseInt(searchParams.get('tzOffset') ?? '0', 10);
  const adjustedNow = new Date(now.getTime() + tzOffset * 60000);
  const localToday = adjustedNow.toISOString().split('T')[0];
  const date = searchParams.get('date') || localToday;
  const isToday = date === localToday;

  if (date > localToday) return Response.json({ error: 'future_date' }, { status: 400 });

  // For past dates: return cached scores if available
  if (!isToday) {
    const hasOverrides = ['sleepHrs','sleepEff','hrv','rhr','steps','activeMinutes']
      .some(k => searchParams.get(k) != null && searchParams.get(k) !== '');

    if (!hasOverrides) {
      const { data: stored } = await supabase
        .from('entries').select('data')
        .eq('user_id', user.id).eq('type', 'scores').eq('date', date).maybeSingle();

      if (stored?.data?.sleepScore != null || stored?.data?.activityScore != null) {
        const d = stored.data;
        const spark7Since = new Date(date);
        spark7Since.setDate(spark7Since.getDate() - 7);
        const { data: sparkRows } = await supabase
          .from('entries').select('date, data')
          .eq('user_id', user.id).eq('type', 'scores')
          .gte('date', spark7Since.toISOString().split('T')[0]).lte('date', date)
          .order('date', { ascending: true });

        const sparkByDate = Object.fromEntries((sparkRows ?? []).map(r => [r.date, r.data || {}]));
        const sparkDates = (sparkRows ?? []).map(r => r.date).sort().slice(-7);
        const nv = v => (v != null && !isNaN(+v)) ? +v : null;
        const spark7 = sparkDates.map(sd => sparkByDate[sd] || {});

        return Response.json({
          date, calibrationDays: d.calibrationDays ?? CALIBRATION_DAYS, calibrated: d.calibrated ?? true,
          sleep:     { score: d.sleepScore,     contributors: d.contributors?.sleep,     sparkline: spark7.map(sd => nv(sd.sleepScore)) },
          readiness: { score: d.readinessScore, contributors: d.contributors?.readiness, sparkline: spark7.map(sd => nv(sd.readinessScore)) },
          activity:  { score: d.activityScore,  contributors: d.contributors?.activity,  sparkline: spark7.map(sd => nv(sd.activityScore)) },
          recovery:  { score: d.recoveryScore,  contributors: d.contributors?.recovery,  sparkline: spark7.map(sd => nv(sd.recoveryScore)) },
          _cached: true,
        });
      }
    }
  }

  // Full compute path
  const since = new Date(date);
  since.setDate(since.getDate() - 90);
  const { data: rows, error: rowErr } = await supabase
    .from('entries').select('date, type, data')
    .eq('user_id', user.id).in('type', ['health', 'health_apple'])
    .gte('date', since.toISOString().split('T')[0]).lte('date', date)
    .order('date', { ascending: true });
  if (rowErr) throw rowErr;

  const { count: totalHealthRows } = await supabase
    .from('entries').select('date', { count: 'exact', head: true })
    .eq('user_id', user.id).in('type', ['health', 'health_apple']).lte('date', date);

  // Merge Oura + Apple Health (Oura wins per-field)
  const byDate = {};
  for (const row of rows ?? []) {
    if (!byDate[row.date]) byDate[row.date] = {};
    if (row.type === 'health') Object.assign(byDate[row.date], row.data || {});
    else for (const [k, v] of Object.entries(row.data || {})) if (!byDate[row.date][k]) byDate[row.date][k] = v;
  }

  const dates = Object.keys(byDate).sort();
  const todayData = byDate[date] || {};
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
  const history7d = histDates.slice(-7).map(d => byDate[d]);

  const sleep     = calcSleepScore(todayMerged, history);
  const readiness = calcReadinessScore(todayMerged, history, calibrated);
  const activity  = calcActivityScore(todayMerged, history7d);
  const recovery  = calcRecoveryScore(todayMerged, history, calibrated);

  // Build sparklines
  const last7Dates = histDates.slice(-7);
  const { data: sparkScoreRows } = await supabase
    .from('entries').select('date, data')
    .eq('user_id', user.id).eq('type', 'scores')
    .gte('date', last7Dates[0]).lt('date', date)
    .order('date', { ascending: true });
  const sparkScoreByDate = Object.fromEntries((sparkScoreRows ?? []).map(r => [r.date, r.data || {}]));
  const allSparkDates = [...last7Dates.slice(0, -1).filter(d => sparkScoreByDate[d]), date];
  const spark7 = allSparkDates.slice(-7).map(dd => dd === date
    ? { sleepScore: sleep.score, readinessScore: readiness.score, activityScore: activity.score, recoveryScore: recovery.score }
    : sparkScoreByDate[dd] || {}
  );

  const result = {
    date, calibrationDays, calibrated,
    sleep:     { ...sleep,     sparkline: spark7.map(d => n(d.sleepScore)) },
    readiness: { ...readiness, sparkline: spark7.map(d => n(d.readinessScore)) },
    activity:  { ...activity,  sparkline: spark7.map(d => n(d.activityScore)) },
    recovery:  { ...recovery,  sparkline: spark7.map(d => n(d.recoveryScore)) },
  };

  // Persist scores
  supabase.from('entries').upsert({
    user_id: user.id, date, type: 'scores',
    data: {
      sleepScore: sleep.score, readinessScore: readiness.score,
      activityScore: activity.score, recoveryScore: recovery.score,
      calibrationDays, calibrated,
      contributors: { sleep: sleep.contributors, readiness: readiness.contributors, activity: activity.contributors, recovery: recovery.contributors },
      computedAt: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,date,type' }).then(() => {});

  return Response.json(result);
});
