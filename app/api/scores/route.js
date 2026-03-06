import { createClient } from '@supabase/supabase-js';

// ─── Constants ────────────────────────────────────────────────────────────────
const CALIBRATION_DAYS = 14;

// Population/guideline baselines (used before calibration)
const POP = {
  hrv: 55,          // ms RMSSD, roughly 30s-40s adult average
  rhr: 60,          // bpm
  sleepHrs: 8,      // hours
  sleepEff: 85,     // %
  remPct: 22,       // % of total sleep
  deepPct: 17,      // % of total sleep
  steps: 8000,
  activeMinutes: 22, // WHO 150/week ÷ 7
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function clamp(v, min = 0, max = 100) { return Math.max(min, Math.min(max, v)); }
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }

// Weighted average of recent days (exponential decay, recent = more weight)
function weightedAvg(arr) {
  if (!arr.length) return null;
  let sum = 0, wSum = 0;
  arr.forEach((v, i) => {
    const w = Math.pow(1.5, i); // more recent = higher index = higher weight
    sum += v * w; wSum += w;
  });
  return sum / wSum;
}

// Score a value relative to a target, with a tolerance band
// optimal range: [targetLow, targetHigh] → 100
// penalty outside range is linear, floored at 0
function rangeScore(value, targetLow, targetHigh, floorLow = null, ceilHigh = null) {
  if (value == null) return null;
  if (value >= targetLow && value <= targetHigh) return 100;
  if (value < targetLow) {
    const floor = floorLow ?? targetLow - (targetHigh - targetLow) * 2;
    return clamp(((value - floor) / (targetLow - floor)) * 100);
  }
  const ceil = ceilHigh ?? targetHigh + (targetHigh - targetLow) * 2;
  return clamp(((ceil - value) / (ceil - targetHigh)) * 100);
}

// Score a deviation from baseline (z-score style)
// deviation of 0 = 100, ±1 SD = ~70, ±2 SD = ~40
function deviationScore(value, baseline, sd, higherIsBetter = true) {
  if (value == null || baseline == null) return null;
  const diff = higherIsBetter ? (value - baseline) : (baseline - value);
  const z = sd > 0 ? diff / sd : 0;
  // sigmoid-like: 100 at z=0, 85 at z=0.5, 70 at z=1, 50 at z=1.5, 30 at z=2
  return clamp(50 + 50 * Math.tanh(z * 1.2));
}

function stdDev(arr) {
  if (arr.length < 2) return arr.length === 1 ? arr[0] * 0.15 : 10;
  const m = avg(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

// Parse numeric from stored string
function n(v) { const x = parseFloat(v); return isNaN(x) ? null : x; }

// ─── Score calculators ────────────────────────────────────────────────────────

function calcSleepScore(today, history) {
  const hrs     = n(today.sleepHrs);
  const eff     = n(today.sleepEff);
  const hrv     = n(today.hrv);
  const rhr     = n(today.rhr);

  // Total sleep: 7-9 = 100, <5 = 0
  const sleepHrsScore = hrs != null
    ? rangeScore(hrs, 7, 9, 3, 12)
    : null;

  // Efficiency: 85-100 = 100, <60 = 0
  const effScore = eff != null
    ? rangeScore(eff, 85, 100, 50, 100)
    : null;

  // Compute from available contributors
  const contributors = [sleepHrsScore, effScore].filter(v => v != null);
  if (!contributors.length) return { score: null, contributors: { sleepHrs: null, efficiency: null } };

  const weights = [];
  const weighted = [];
  if (sleepHrsScore != null) { weights.push(0.6); weighted.push(sleepHrsScore * 0.6); }
  if (effScore != null)       { weights.push(0.4); weighted.push(effScore * 0.4); }

  const totalW = weights.reduce((a, b) => a + b, 0);
  const score  = Math.round(weighted.reduce((a, b) => a + b, 0) / totalW);

  return {
    score,
    contributors: {
      sleepHrs:   sleepHrsScore != null ? Math.round(sleepHrsScore) : null,
      efficiency: effScore      != null ? Math.round(effScore)      : null,
    },
  };
}

function calcReadinessScore(today, history, calibrated) {
  const hrv = n(today.hrv);
  const rhr = n(today.rhr);

  let hrvScore = null, rhrScore = null;

  if (calibrated && history.hrv.length >= 7) {
    const baselineHrv = avg(history.hrv.slice(-90));
    const sdHrv       = stdDev(history.hrv.slice(-30));
    const recentHrv   = weightedAvg([...history.hrv.slice(-14)]);
    const trendHrv    = recentHrv != null && baselineHrv != null ? recentHrv : hrv;
    hrvScore = deviationScore(trendHrv ?? hrv, baselineHrv, sdHrv, true);

    const baselineRhr = avg(history.rhr.slice(-60));
    const sdRhr       = stdDev(history.rhr.slice(-30));
    rhrScore = deviationScore(rhr, baselineRhr, sdRhr, false);
  } else {
    // Guideline-based: HRV 50-70ms is good range for adults
    if (hrv != null) hrvScore = rangeScore(hrv, 40, 80, 10, 120);
    // RHR 50-70 is ideal
    if (rhr != null) rhrScore = rangeScore(rhr, 50, 70, 30, 110);
  }

  const sleepResult = calcSleepScore(today, history);
  const sleepScore  = sleepResult.score;

  const parts   = [];
  const wts     = [];

  if (hrvScore != null)  { parts.push(hrvScore  * 0.40); wts.push(0.40); }
  if (rhrScore != null)  { parts.push(rhrScore  * 0.30); wts.push(0.30); }
  if (sleepScore != null){ parts.push(sleepScore * 0.30); wts.push(0.30); }

  if (!parts.length) return { score: null, contributors: { hrv: null, rhr: null } };

  const totalW = wts.reduce((a, b) => a + b, 0);
  const score  = Math.round(parts.reduce((a, b) => a + b, 0) / totalW);

  return {
    score,
    contributors: {
      hrv: hrvScore != null ? Math.round(hrvScore) : null,
      rhr: rhrScore != null ? Math.round(rhrScore) : null,
    },
  };
}

function calcActivityScore(today, history7d) {
  const steps         = n(today.steps);
  const activeMinutes = n(today.activeMinutes);

  // Steps: 8000-12000 = 100
  const stepsScore = steps != null
    ? rangeScore(steps, 8000, 12000, 0, 20000)
    : null;

  // Active minutes: WHO 150/wk = ~22/day, 30+/day = 100
  const activeScore = activeMinutes != null
    ? rangeScore(activeMinutes, 22, 60, 0, 120)
    : null;

  // Training frequency: sessions in last 7 days with >20 active minutes
  const activeDays = history7d.filter(d => (n(d.activeMinutes) ?? 0) >= 20).length;
  const freqScore  = rangeScore(activeDays, 3, 7, 0, 7);

  // Recovery: at least 1 day in last 7 with <15 active minutes (rest day)
  const restDays   = history7d.filter(d => (n(d.activeMinutes) ?? 0) < 15).length;
  const recovScore = rangeScore(restDays, 1, 3, 0, 7);

  const parts = [], wts = [];
  if (stepsScore  != null){ parts.push(stepsScore  * 0.25); wts.push(0.25); }
  if (activeScore != null){ parts.push(activeScore * 0.35); wts.push(0.35); }
  parts.push(freqScore  * 0.25); wts.push(0.25);
  parts.push(recovScore * 0.15); wts.push(0.15);

  const totalW = wts.reduce((a, b) => a + b, 0);
  const score  = Math.round(parts.reduce((a, b) => a + b, 0) / totalW);

  return {
    score,
    contributors: {
      steps:         stepsScore  != null ? Math.round(stepsScore)  : null,
      activeMinutes: activeScore != null ? Math.round(activeScore) : null,
      frequency:     Math.round(freqScore),
      recovery:      Math.round(recovScore),
    },
  };
}

function calcRecoveryScore(today, history, calibrated) {
  const hrv = n(today.hrv);
  const rhr = n(today.rhr);

  // Build 7-day and 30-day trend arrays
  const hrv7  = history.hrv.slice(-7).filter(v => v != null);
  const hrv30 = history.hrv.slice(-30).filter(v => v != null);
  const rhr7  = history.rhr.slice(-7).filter(v => v != null);
  const rhr30 = history.rhr.slice(-30).filter(v => v != null);

  let hrvTrendScore = null, rhrTrendScore = null;

  if (hrv7.length >= 3 && hrv30.length >= 7) {
    const recent  = avg(hrv7);
    const baseline= avg(hrv30);
    const sd      = stdDev(hrv30);
    hrvTrendScore = deviationScore(recent, baseline, sd, true);
  } else if (hrv != null) {
    // Not enough history — use today vs guideline
    hrvTrendScore = rangeScore(hrv, 40, 80, 10, 120);
  }

  if (rhr7.length >= 3 && rhr30.length >= 7) {
    const recent  = avg(rhr7);
    const baseline= avg(rhr30);
    const sd      = stdDev(rhr30);
    rhrTrendScore = deviationScore(recent, baseline, sd, false);
  } else if (rhr != null) {
    rhrTrendScore = rangeScore(rhr, 50, 70, 30, 110);
  }

  // Sleep debt: average sleep over 14 days vs 7.5hr target
  const sleep14 = history.sleepHrs.slice(-14).filter(v => v != null);
  let sleepDebtScore = null;
  if (sleep14.length >= 3) {
    const avgSleep = avg(sleep14);
    sleepDebtScore = rangeScore(avgSleep, 7, 9, 3, 12);
  }

  const parts = [], wts = [];
  if (hrvTrendScore  != null){ parts.push(hrvTrendScore  * 0.50); wts.push(0.50); }
  if (rhrTrendScore  != null){ parts.push(rhrTrendScore  * 0.30); wts.push(0.30); }
  if (sleepDebtScore != null){ parts.push(sleepDebtScore * 0.20); wts.push(0.20); }

  if (!parts.length) return { score: null, contributors: { hrvTrend: null, rhrTrend: null } };

  const totalW = wts.reduce((a, b) => a + b, 0);
  const score  = Math.round(parts.reduce((a, b) => a + b, 0) / totalW);

  // Sparkline arrays (last 7 days, for UI)
  return {
    score,
    contributors: {
      hrvTrend: hrvTrendScore != null ? Math.round(hrvTrendScore) : null,
      rhrTrend: rhrTrendScore != null ? Math.round(rhrTrendScore) : null,
    },
    sparklines: {
      hrv: hrv7,
      rhr: rhr7,
    },
  };
}

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
