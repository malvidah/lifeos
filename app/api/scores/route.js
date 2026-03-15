import { withAuth } from '../_lib/auth.js';
import {
  CALIBRATION_DAYS, n,
  calcSleepScore, calcReadinessScore, calcActivityScore, calcRecoveryScore,
} from '@/lib/scoreCalc.js';

// Maps a health_metrics row (new schema) → the field names scoreCalc.js expects
// (which use camelCase string values from the old entries schema)
function metricsToLegacy(row) {
  if (!row) return {};
  return {
    hrv:          row.hrv        != null ? String(row.hrv)       : undefined,
    rhr:          row.rhr        != null ? String(row.rhr)       : undefined,
    sleepHrs:     row.sleep_hrs  != null ? String(row.sleep_hrs) : undefined,
    sleepEff:     row.sleep_eff  != null ? String(row.sleep_eff) : undefined,
    steps:        row.steps      != null ? String(row.steps)     : undefined,
    activeMinutes:row.active_min != null ? String(row.active_min): undefined,
    stressMins:   row.raw?.stressMins   != null ? String(row.raw.stressMins)   : undefined,
    recoveryMins: row.raw?.recoveryMins != null ? String(row.raw.recoveryMins) : undefined,
  };
}

const SOURCE_PRIORITY = ['oura', 'apple', 'garmin'];

function pickBest(rows) {
  if (!rows?.length) return null;
  for (const src of SOURCE_PRIORITY) {
    const r = rows.find(r => r.source === src);
    if (r) return r;
  }
  return rows[0];
}

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
    const hasOverrides = ['sleepHrs','sleepEff','hrv','rhr','steps','activeMinutes','stressMins','recoveryMins']
      .some(k => searchParams.get(k) != null && searchParams.get(k) !== '');

    if (!hasOverrides) {
      const { data: stored } = await supabase
        .from('health_scores')
        .select('sleep_score, readiness_score, activity_score, recovery_score, calibration_days, calibrated, contributors')
        .eq('user_id', user.id).eq('date', date).maybeSingle();

      if (stored?.sleep_score != null || stored?.activity_score != null) {
        const spark7Since = new Date(date);
        spark7Since.setDate(spark7Since.getDate() - 7);
        const { data: sparkRows } = await supabase
          .from('health_scores')
          .select('date, sleep_score, readiness_score, activity_score, recovery_score')
          .eq('user_id', user.id)
          .gte('date', spark7Since.toISOString().split('T')[0]).lte('date', date)
          .order('date', { ascending: true });

        const sparkByDate = Object.fromEntries((sparkRows ?? []).map(r => [r.date, r]));
        const sparkDates = (sparkRows ?? []).map(r => r.date).sort().slice(-7);
        const nv = v => (v != null && !isNaN(+v)) ? +v : null;
        const spark7 = sparkDates.map(sd => sparkByDate[sd] || {});

        return Response.json({
          date,
          calibrationDays: stored.calibration_days ?? CALIBRATION_DAYS,
          calibrated: stored.calibrated ?? true,
          sleep:     { score: stored.sleep_score,     contributors: stored.contributors?.sleep,     sparkline: spark7.map(sd => nv(sd.sleep_score)) },
          readiness: { score: stored.readiness_score, contributors: stored.contributors?.readiness, sparkline: spark7.map(sd => nv(sd.readiness_score)) },
          activity:  { score: stored.activity_score,  contributors: stored.contributors?.activity,  sparkline: spark7.map(sd => nv(sd.activity_score)) },
          recovery:  { score: stored.recovery_score,  contributors: stored.contributors?.recovery,  sparkline: spark7.map(sd => nv(sd.recovery_score)) },
          _cached: true,
        });
      }
    }
  }

  // ── Full compute path ─────────────────────────────────────────────────────
  const since = new Date(date);
  since.setDate(since.getDate() - 90);
  const sinceStr = since.toISOString().split('T')[0];

  const { data: metricsRows, error: metricsErr } = await supabase
    .from('health_metrics')
    .select('date, source, hrv, rhr, sleep_hrs, sleep_eff, steps, active_min, raw')
    .eq('user_id', user.id)
    .gte('date', sinceStr).lte('date', date)
    .order('date', { ascending: true });
  if (metricsErr) throw metricsErr;

  const { count: totalHealthRows } = await supabase
    .from('health_metrics')
    .select('date', { count: 'exact', head: true })
    .eq('user_id', user.id).lte('date', date);

  // Group by date, pick best source per date, convert to legacy format
  const rowsByDate = {};
  for (const row of metricsRows ?? []) {
    if (!rowsByDate[row.date]) rowsByDate[row.date] = [];
    rowsByDate[row.date].push(row);
  }

  const byDate = {};
  for (const [d, rows] of Object.entries(rowsByDate)) {
    byDate[d] = metricsToLegacy(pickBest(rows));
  }

  const dates = Object.keys(byDate).sort();
  const todayData = byDate[date] || {};
  const overrides = {};
  ['sleepHrs','sleepEff','hrv','rhr','steps','activeMinutes','stressMins','recoveryMins'].forEach(k => {
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

  // ── Build sparklines from health_scores ───────────────────────────────────
  const last7Dates = histDates.slice(-7);
  const spark7StartDate = last7Dates[0];
  const { data: sparkScoreRows } = spark7StartDate ? await supabase
    .from('health_scores')
    .select('date, sleep_score, readiness_score, activity_score, recovery_score')
    .eq('user_id', user.id)
    .gte('date', spark7StartDate).lt('date', date)
    .order('date', { ascending: true }) : { data: [] };

  const sparkScoreByDate = Object.fromEntries((sparkScoreRows ?? []).map(r => [r.date, r]));
  const allSparkDates = [...last7Dates.slice(0, -1).filter(d => sparkScoreByDate[d]), date];
  const spark7 = allSparkDates.slice(-7).map(dd => dd === date
    ? { sleep_score: sleep.score, readiness_score: readiness.score, activity_score: activity.score, recovery_score: recovery.score }
    : sparkScoreByDate[dd] || {}
  );

  const result = {
    date, calibrationDays, calibrated,
    sleep:     { ...sleep,     sparkline: spark7.map(d => n(d.sleep_score)) },
    readiness: { ...readiness, sparkline: spark7.map(d => n(d.readiness_score)) },
    activity:  { ...activity,  sparkline: spark7.map(d => n(d.activity_score)) },
    recovery:  { ...recovery,  sparkline: spark7.map(d => n(d.recovery_score)) },
  };

  // ── Persist scores to health_scores ──────────────────────────────────────
  const scoreRow = {
    user_id: user.id, date,
    winning_source: pickBest(rowsByDate[date] ?? [])?.source ?? null,
    sleep_score:     sleep.score,
    readiness_score: readiness.score,
    activity_score:  activity.score,
    recovery_score:  recovery.score,
    calibration_days: calibrationDays,
    calibrated,
    contributors: {
      sleep:     sleep.contributors,
      readiness: readiness.contributors,
      activity:  activity.contributors,
      recovery:  recovery.contributors,
    },
  };

  // Try upsert first, fall back to delete+insert if conflict handling fails
  let { error: upsertErr } = await supabase
    .from('health_scores').upsert(scoreRow, { onConflict: 'user_id,date' });

  if (upsertErr) {
    console.error('[scores] upsert failed, trying delete+insert:', upsertErr.message);
    await supabase.from('health_scores').delete()
      .eq('user_id', user.id).eq('date', date);
    const { error: insErr } = await supabase.from('health_scores').insert(scoreRow);
    if (insErr) {
      console.error('[scores] insert also failed:', insErr.message);
      result._persistError = insErr.message;
    } else {
      upsertErr = null; // succeeded via fallback
    }
  }

  result._persisted = !upsertErr;
  return Response.json(result);
});
