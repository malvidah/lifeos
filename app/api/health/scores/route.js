import { withAuth } from '../../_lib/auth.js';
import {
  CALIBRATION_DAYS, n,
  calcSleepScore, calcReadinessScore, calcActivityScore, calcRecoveryScore,
} from '@/lib/scoreCalc.js';

// GET /api/health/scores?start=YYYY-MM-DD&end=YYYY-MM-DD
//   Returns all health_scores rows in a date range for calendar dots.
//
// GET /api/health/scores?date=YYYY-MM-DD[&tzOffset=...&sleepHrs=...&...]
//   Computes scores for a single date (with optional manual overrides).
//   For past dates, returns cached scores if available.
//
// POST /api/health/scores
//   Upserts one health_scores row.
//   Body: { date, winning_source, sleep_score?, readiness_score?, activity_score?,
//           recovery_score?, contributors?, calibrated?, calibration_days? }

// Maps a health_metrics row → the field names scoreCalc.js expects
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
  const date  = searchParams.get('date');
  const start = searchParams.get('start');
  const end   = searchParams.get('end');

  // ── Range query: return rows for calendar dots ────────────────────────────
  if (start && end) {
    const { data, error } = await supabase
      .from('health_scores')
      .select('date, sleep_score, readiness_score, activity_score, recovery_score')
      .eq('user_id', user.id)
      .gte('date', start).lte('date', end)
      .order('date', { ascending: true })
      .limit(3000);
    if (error) throw error;

    const rows = data ?? [];

    // If today falls within the range and has no cached scores, compute them
    // so the habits card doesn't show stale data due to a race with the
    // single-date endpoint that the health card triggers.
    const now = new Date();
    const tzOffset = parseInt(searchParams.get('tzOffset') ?? '0', 10);
    const adjustedNow = new Date(now.getTime() + tzOffset * 60000);
    const localToday = adjustedNow.toISOString().split('T')[0];

    if (localToday >= start && localToday <= end) {
      const todayRow = rows.find(r => r.date === localToday);
      if (!todayRow || todayRow.sleep_score == null) {
        try {
          const since = new Date(localToday);
          since.setDate(since.getDate() - 90);
          const { data: metricsRows } = await supabase
            .from('health_metrics')
            .select('date, source, hrv, rhr, sleep_hrs, sleep_eff, steps, active_min, raw')
            .eq('user_id', user.id)
            .gte('date', since.toISOString().split('T')[0]).lte('date', localToday)
            .order('date', { ascending: true });

          if (metricsRows?.length) {
            const rowsByDate = {};
            for (const row of metricsRows) {
              if (!rowsByDate[row.date]) rowsByDate[row.date] = [];
              rowsByDate[row.date].push(row);
            }
            const byDate = {};
            for (const [d, dRows] of Object.entries(rowsByDate)) {
              byDate[d] = metricsToLegacy(pickBest(dRows));
            }
            const dates = Object.keys(byDate).sort();
            const todayData = byDate[localToday] || {};
            const { count: totalHealthRows } = await supabase
              .from('health_metrics')
              .select('date', { count: 'exact', head: true })
              .eq('user_id', user.id).lte('date', localToday);
            const calibrationDays = totalHealthRows ?? dates.length;
            const calibrated = calibrationDays >= CALIBRATION_DAYS;
            const histDates = dates.filter(d => d < localToday);
            const history = {
              hrv:           histDates.map(d => n(byDate[d].hrv)),
              rhr:           histDates.map(d => n(byDate[d].rhr)),
              sleepHrs:      histDates.map(d => n(byDate[d].sleepHrs)),
              steps:         histDates.map(d => n(byDate[d].steps)),
              activeMinutes: histDates.map(d => n(byDate[d].activeMinutes)),
            };
            const history7d = histDates.slice(-7).map(d => byDate[d]);

            const sleep     = calcSleepScore(todayData, history);
            const readiness = calcReadinessScore(todayData, history, calibrated);
            const activity  = calcActivityScore(todayData, history7d);
            const recovery  = calcRecoveryScore(todayData, history, calibrated);

            const freshRow = {
              date: localToday,
              sleep_score:     sleep.score,
              readiness_score: readiness.score,
              activity_score:  activity.score,
              recovery_score:  recovery.score,
            };

            // Upsert so next range query is fast
            supabase.from('health_scores').upsert({
              user_id: user.id, date: localToday,
              winning_source: pickBest(rowsByDate[localToday] ?? [])?.source ?? null,
              ...freshRow, calibration_days: calibrationDays, calibrated,
              contributors: { sleep: sleep.contributors, readiness: readiness.contributors, activity: activity.contributors, recovery: recovery.contributors },
            }, { onConflict: 'user_id,date' }).then(() => {});

            if (todayRow) {
              Object.assign(todayRow, freshRow);
            } else {
              rows.push(freshRow);
            }
          }
        } catch (e) {
          console.error('[scores] range: failed to compute today inline:', e.message);
        }
      }
    }

    return Response.json({ rows });
  }

  // ── Single-date computation ───────────────────────────────────────────────
  const now = new Date();
  const tzOffset = parseInt(searchParams.get('tzOffset') ?? '0', 10);
  const adjustedNow = new Date(now.getTime() + tzOffset * 60000);
  const localToday = adjustedNow.toISOString().split('T')[0];
  const effectiveDate = date || localToday;
  const isToday = effectiveDate === localToday;

  if (effectiveDate > localToday) return Response.json({ error: 'future_date' }, { status: 400 });

  // For past dates: return cached scores if available
  if (!isToday) {
    const hasOverrides = ['sleepHrs','sleepEff','hrv','rhr','steps','activeMinutes','stressMins','recoveryMins']
      .some(k => searchParams.get(k) != null && searchParams.get(k) !== '');

    if (!hasOverrides) {
      const { data: stored } = await supabase
        .from('health_scores')
        .select('sleep_score, readiness_score, activity_score, recovery_score, calibration_days, calibrated, contributors')
        .eq('user_id', user.id).eq('date', effectiveDate).maybeSingle();

      if (stored?.sleep_score != null || stored?.activity_score != null) {
        const spark7Since = new Date(effectiveDate);
        spark7Since.setDate(spark7Since.getDate() - 7);
        const { data: sparkRows } = await supabase
          .from('health_scores')
          .select('date, sleep_score, readiness_score, activity_score, recovery_score')
          .eq('user_id', user.id)
          .gte('date', spark7Since.toISOString().split('T')[0]).lte('date', effectiveDate)
          .order('date', { ascending: true });

        const sparkByDate = Object.fromEntries((sparkRows ?? []).map(r => [r.date, r]));
        const sparkDates = (sparkRows ?? []).map(r => r.date).sort().slice(-7);
        const nv = v => (v != null && !isNaN(+v)) ? +v : null;
        const spark7 = sparkDates.map(sd => sparkByDate[sd] || {});

        return Response.json({
          date: effectiveDate,
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
  const since = new Date(effectiveDate);
  since.setDate(since.getDate() - 90);
  const sinceStr = since.toISOString().split('T')[0];

  const { data: metricsRows, error: metricsErr } = await supabase
    .from('health_metrics')
    .select('date, source, hrv, rhr, sleep_hrs, sleep_eff, steps, active_min, raw')
    .eq('user_id', user.id)
    .gte('date', sinceStr).lte('date', effectiveDate)
    .order('date', { ascending: true });
  if (metricsErr) throw metricsErr;

  const { count: totalHealthRows } = await supabase
    .from('health_metrics')
    .select('date', { count: 'exact', head: true })
    .eq('user_id', user.id).lte('date', effectiveDate);

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
  const todayData = byDate[effectiveDate] || {};
  const overrides = {};
  ['sleepHrs','sleepEff','hrv','rhr','steps','activeMinutes','stressMins','recoveryMins'].forEach(k => {
    const v = searchParams.get(k);
    if (v != null && v !== '') overrides[k] = v;
  });
  const todayMerged = { ...todayData, ...overrides };

  const calibrationDays = totalHealthRows ?? dates.length;
  const calibrated = calibrationDays >= CALIBRATION_DAYS;

  const histDates = dates.filter(d => d < effectiveDate);
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
    .gte('date', spark7StartDate).lt('date', effectiveDate)
    .order('date', { ascending: true }) : { data: [] };

  const sparkScoreByDate = Object.fromEntries((sparkScoreRows ?? []).map(r => [r.date, r]));
  const allSparkDates = [...last7Dates.slice(0, -1).filter(d => sparkScoreByDate[d]), effectiveDate];
  const spark7 = allSparkDates.slice(-7).map(dd => dd === effectiveDate
    ? { sleep_score: sleep.score, readiness_score: readiness.score, activity_score: activity.score, recovery_score: recovery.score }
    : sparkScoreByDate[dd] || {}
  );

  const result = {
    date: effectiveDate, calibrationDays, calibrated,
    sleep:     { ...sleep,     sparkline: spark7.map(d => n(d.sleep_score)) },
    readiness: { ...readiness, sparkline: spark7.map(d => n(d.readiness_score)) },
    activity:  { ...activity,  sparkline: spark7.map(d => n(d.activity_score)) },
    recovery:  { ...recovery,  sparkline: spark7.map(d => n(d.recovery_score)) },
  };

  // ── Persist scores to health_scores ──────────────────────────────────────
  const scoreRow = {
    user_id: user.id, date: effectiveDate,
    winning_source: pickBest(rowsByDate[effectiveDate] ?? [])?.source ?? null,
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
      .eq('user_id', user.id).eq('date', effectiveDate);
    const { error: insErr } = await supabase.from('health_scores').insert(scoreRow);
    if (insErr) {
      console.error('[scores] insert also failed:', insErr.message);
    } else {
      upsertErr = null; // succeeded via fallback
    }
  }

  return Response.json(result);
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
    }, { onConflict: 'user_id,date' })
    .select()
    .single();
  if (error) throw error;

  return Response.json({ score: data });
});
