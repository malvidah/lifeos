// ─── Shared score calculation logic ───────────────────────────────────────────
// Used by /api/scores (single date) and /api/scores-backfill (batch).
// All scores are computed from raw biometric metrics only — never from
// Oura's own score fields (sleepScore, readinessScore, activityScore).
//
// Data sources: Oura, Apple Health, Garmin. All provide the core 6 metrics
// (HRV, RHR, sleep hours, sleep efficiency, steps, active minutes).
// Oura additionally provides daytime stress/recovery minutes — used in
// the Recovery score when available, gracefully ignored otherwise.

export const CALIBRATION_DAYS = 14;

// Population/guideline baselines (used before personal calibration)
export const POP = {
  hrv: 55,
  rhr: 60,
  sleepHrs: 8,
  sleepEff: 85,
  steps: 10000,
  activeMinutes: 30,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function clamp(v, min = 0, max = 100) { return Math.max(min, Math.min(max, v)); }
export function avg(arr) { const v = arr.filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }

export function weightedAvg(arr) {
  if (!arr.length) return null;
  let sum = 0, wSum = 0;
  arr.forEach((v, i) => {
    if (v == null) return;
    const w = Math.pow(1.5, i);
    sum += v * w; wSum += w;
  });
  return wSum > 0 ? sum / wSum : null;
}

export function rangeScore(value, targetLow, targetHigh, floorLow = null, ceilHigh = null) {
  if (value == null) return null;
  if (value >= targetLow && value <= targetHigh) return 100;
  if (value < targetLow) {
    const floor = floorLow ?? targetLow - (targetHigh - targetLow) * 2;
    return clamp(((value - floor) / (targetLow - floor)) * 100);
  }
  const ceil = ceilHigh ?? targetHigh + (targetHigh - targetLow) * 2;
  return clamp(((ceil - value) / (ceil - targetHigh)) * 100);
}

export function deviationScore(value, baseline, sd, higherIsBetter = true) {
  if (value == null || baseline == null) return null;
  const diff = higherIsBetter ? (value - baseline) : (baseline - value);
  const z = sd > 0 ? diff / sd : 0;
  return clamp(50 + 50 * Math.tanh(z * 1.2));
}

// Hybrid deviation score: uses personal baseline for trend detection,
// but applies an absolute floor/ceiling so unhealthy baselines don't
// normalize to "fine". The absolute component blends in at 30%.
function hybridDeviationScore(value, baseline, sd, higherIsBetter, absLow, absHigh) {
  if (value == null) return null;
  const devScore = baseline != null ? deviationScore(value, baseline, sd, higherIsBetter) : null;
  const absScore = rangeScore(value, absLow, absHigh);
  if (devScore != null && absScore != null) {
    return devScore * 0.7 + absScore * 0.3;
  }
  return devScore ?? absScore;
}

export function stdDev(arr) {
  const v = arr.filter(x => x != null);
  if (v.length < 2) return v.length === 1 ? v[0] * 0.15 : 10;
  const m = avg(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
}

// Parse numeric from stored string
export function n(v) { const x = parseFloat(v); return isNaN(x) ? null : x; }

// ─── Score calculators ────────────────────────────────────────────────────────

// ── SLEEP ─────────────────────────────────────────────────────────────────────
// Absolute score based on AASM guidelines. Not personalized — everyone needs
// 7-10h of sleep regardless of their baseline.
//
// Hours (75% weight): 7-10h = 100, below 7h caps at 80 with ^1.5 curve,
//   above 10h tapers linearly. Sub-7h can never push total above ~82.
// Efficiency (25% weight): 85-100% = 100, drops to 0 at 50%.
export function calcSleepScore(today, history) {
  const hrs = n(today.sleepHrs);
  const eff = n(today.sleepEff);

  let sleepHrsScore = null;
  if (hrs != null) {
    if (hrs >= 7 && hrs <= 10) sleepHrsScore = 100;
    else if (hrs > 10) sleepHrsScore = clamp(100 - (hrs - 10) * 50);
    else sleepHrsScore = clamp(80 * Math.pow(Math.max(hrs - 4, 0) / 3, 1.5));
  }
  const effScore = eff != null ? rangeScore(eff, 85, 100, 50, 100) : null;

  const contributors = [sleepHrsScore, effScore].filter(v => v != null);
  if (!contributors.length) return { score: null, contributors: { sleepHrs: null, efficiency: null } };

  const weights = [], weighted = [];
  if (sleepHrsScore != null) { weights.push(0.75); weighted.push(sleepHrsScore * 0.75); }
  if (effScore != null)       { weights.push(0.25); weighted.push(effScore * 0.25); }

  const totalW = weights.reduce((a, b) => a + b, 0);
  const score = Math.round(weighted.reduce((a, b) => a + b, 0) / totalW);
  return {
    score,
    contributors: {
      sleepHrs:   sleepHrsScore != null ? Math.round(sleepHrsScore) : null,
      efficiency: effScore      != null ? Math.round(effScore)      : null,
    },
  };
}

// ── READINESS ─────────────────────────────────────────────────────────────────
// Hybrid score: personal baseline for HRV/RHR trend detection, with absolute
// floor so a consistently low HRV doesn't normalize to "fine".
//
// HRV (40%): higher is better. Personal trend weighted with absolute range
//   (population healthy: 40-80ms).
// RHR (30%): lower is better. Personal trend weighted with absolute range
//   (healthy: 45-65bpm).
// Sleep (30%): absolute score (from calcSleepScore).
export function calcReadinessScore(today, history, calibrated) {
  const hrv = n(today.hrv);
  const rhr = n(today.rhr);

  let hrvScore = null, rhrScore = null;
  let baselineHrv = null, baselineRhr = null;

  if (calibrated && history.hrv.length >= 7) {
    baselineHrv = avg(history.hrv.slice(-90));
    const sdHrv = stdDev(history.hrv.slice(-30));
    const recentHrv = weightedAvg([...history.hrv.slice(-14)]);
    const trendHrv = recentHrv ?? hrv;
    // Hybrid: 70% personal trend + 30% absolute (40-80ms healthy range)
    hrvScore = hybridDeviationScore(trendHrv ?? hrv, baselineHrv, sdHrv, true, 40, 80);

    baselineRhr = avg(history.rhr.slice(-60));
    const sdRhr = stdDev(history.rhr.slice(-30));
    // Hybrid: 70% personal trend + 30% absolute (45-65bpm healthy range)
    rhrScore = hybridDeviationScore(rhr, baselineRhr, sdRhr, false, 45, 65);
  } else {
    // Pre-calibration: pure absolute scoring
    if (hrv != null) hrvScore = rangeScore(hrv, 40, 80, 10, 120);
    if (rhr != null) rhrScore = rangeScore(rhr, 45, 65, 30, 110);
  }

  const sleepScore = calcSleepScore(today, history).score;
  const parts = [], wts = [];
  if (hrvScore   != null) { parts.push(hrvScore   * 0.40); wts.push(0.40); }
  if (rhrScore   != null) { parts.push(rhrScore   * 0.30); wts.push(0.30); }
  if (sleepScore != null) { parts.push(sleepScore * 0.30); wts.push(0.30); }

  if (!parts.length) return { score: null, contributors: { hrv: null, rhr: null } };
  const totalW = wts.reduce((a, b) => a + b, 0);
  return {
    score: Math.round(parts.reduce((a, b) => a + b, 0) / totalW),
    contributors: {
      hrv: hrvScore != null ? Math.round(hrvScore) : null,
      rhr: rhrScore != null ? Math.round(rhrScore) : null,
    },
    baselines: {
      hrv: baselineHrv != null ? Math.round(baselineHrv) : null,
      rhr: baselineRhr != null ? Math.round(baselineRhr) : null,
    },
  };
}

// ── ACTIVITY ──────────────────────────────────────────────────────────────────
// Absolute score based on WHO/CDC guidelines.
//
// Steps (30%): 10,000-15,000 = 100 (WHO recommends ~10K).
// Active minutes (30%): 30-60 min = 100 (WHO: 150 min/week ≈ 22/day,
//   but we target 30+ for a meaningful daily session).
// Training frequency (25%): 3-7 active days in the past week.
// Rest days (15%): 1-3 rest days in the past week (recovery balance).
export function calcActivityScore(today, history7d) {
  const steps         = n(today.steps);
  const activeMinutes = n(today.activeMinutes);

  if (steps == null && activeMinutes == null) {
    return { score: null, contributors: { steps: null, activeMinutes: null, frequency: null, restDays: null } };
  }

  // More steps/active minutes is always good — no upper penalty
  const stepsScore  = steps         != null ? clamp(100 * Math.min(steps / 10000, 1))           : null;
  const activeScore = activeMinutes != null ? clamp(100 * Math.min(activeMinutes / 30, 1))      : null;

  const activeDays = history7d.filter(d => (n(d.activeMinutes) ?? 0) >= 20).length;
  const restDays   = history7d.filter(d => (n(d.activeMinutes) ?? 0) < 15).length;
  const freqScore  = rangeScore(activeDays, 3, 7, 0, 7);
  const restScore  = rangeScore(restDays,   1, 3, 0, 7);

  const parts = [], wts = [];
  if (stepsScore  != null) { parts.push(stepsScore  * 0.30); wts.push(0.30); }
  if (activeScore != null) { parts.push(activeScore * 0.30); wts.push(0.30); }
  parts.push(freqScore * 0.25); wts.push(0.25);
  parts.push(restScore * 0.15); wts.push(0.15);

  const totalW = wts.reduce((a, b) => a + b, 0);
  return {
    score: Math.round(parts.reduce((a, b) => a + b, 0) / totalW),
    contributors: {
      steps:         stepsScore  != null ? Math.round(stepsScore)  : null,
      activeMinutes: activeScore != null ? Math.round(activeScore) : null,
      frequency:     Math.round(freqScore),
      restDays:      Math.round(restScore),
    },
  };
}

// ── RECOVERY ──────────────────────────────────────────────────────────────────
// Tracks physiological recovery and stress balance. Designed to be useful
// for anxiety management — incorporates Oura's daytime stress/recovery
// minutes when available.
//
// With Oura data (stress/recovery minutes available):
//   HRV Trend (30%): 7d vs 30d average — are you recovering?
//   RHR Trend (20%): 7d vs 30d average — lower = more recovered
//   Stress/Recovery Ratio (25%): recovery/(stress+recovery) — direct ANS balance
//   Sleep Quality (25%): recent 7d sleep average
//
// Without Oura stress data (Apple Health / Garmin only):
//   Weights redistribute automatically — HRV 40%, RHR 30%, Sleep 30%
export function calcRecoveryScore(today, history, calibrated) {
  const hrv7  = history.hrv.slice(-7).filter(v => v != null);
  const hrv30 = history.hrv.slice(-30).filter(v => v != null);
  const rhr7  = history.rhr.slice(-7).filter(v => v != null);
  const rhr30 = history.rhr.slice(-30).filter(v => v != null);
  const hrv   = n(today.hrv);
  const rhr   = n(today.rhr);

  // HRV Trend: 7d average vs 30d average (higher = recovering)
  let hrvTrendScore = null;
  if (hrv7.length >= 3 && hrv30.length >= 7) {
    hrvTrendScore = hybridDeviationScore(avg(hrv7), avg(hrv30), stdDev(hrv30), true, 40, 80);
  } else if (hrv != null) {
    hrvTrendScore = rangeScore(hrv, 40, 80, 10, 120);
  }

  // RHR Trend: 7d average vs 30d average (lower = more recovered)
  let rhrTrendScore = null;
  if (rhr7.length >= 3 && rhr30.length >= 7) {
    rhrTrendScore = hybridDeviationScore(avg(rhr7), avg(rhr30), stdDev(rhr30), false, 45, 65);
  } else if (rhr != null) {
    rhrTrendScore = rangeScore(rhr, 45, 65, 30, 110);
  }

  // Stress/Recovery Ratio: recovery_mins / (stress_mins + recovery_mins)
  // Only available from Oura. Directly reflects autonomic nervous system balance.
  // Ratio 0.5+ (equal or more recovery than stress) = 100
  // Ratio 0.3 = ~60, Ratio 0.1 = ~20, Ratio 0 = 0
  const stressMins   = n(today.stressMins);
  const recoveryMins = n(today.recoveryMins);
  let stressRatioScore = null;
  if (stressMins != null && recoveryMins != null) {
    const total = stressMins + recoveryMins;
    if (total > 0) {
      const ratio = recoveryMins / total; // 0 to 1
      stressRatioScore = rangeScore(ratio * 100, 40, 60, 0, 100);
    }
  }

  // Sleep Quality: recent 7-day average sleep hours
  const sleep7 = history.sleepHrs.slice(-7).filter(v => v != null);
  let sleepQualityScore = null;
  if (sleep7.length >= 3) {
    sleepQualityScore = rangeScore(avg(sleep7), 7, 10, 3, 12);
  }

  // Dynamic weighting: stress ratio gets 25% when available,
  // otherwise its weight redistributes to other contributors
  const parts = [], wts = [];
  if (hrvTrendScore     != null) { parts.push(hrvTrendScore     * 0.30); wts.push(0.30); }
  if (rhrTrendScore     != null) { parts.push(rhrTrendScore     * 0.20); wts.push(0.20); }
  if (stressRatioScore  != null) { parts.push(stressRatioScore  * 0.25); wts.push(0.25); }
  if (sleepQualityScore != null) { parts.push(sleepQualityScore * 0.25); wts.push(0.25); }

  if (!parts.length) return { score: null, contributors: { hrvTrend: null, rhrTrend: null, stressRatio: null, sleepQuality: null } };
  const totalW = wts.reduce((a, b) => a + b, 0);
  return {
    score: Math.round(parts.reduce((a, b) => a + b, 0) / totalW),
    contributors: {
      hrvTrend:     hrvTrendScore     != null ? Math.round(hrvTrendScore)     : null,
      rhrTrend:     rhrTrendScore     != null ? Math.round(rhrTrendScore)     : null,
      stressRatio:  stressRatioScore  != null ? Math.round(stressRatioScore)  : null,
      sleepQuality: sleepQualityScore != null ? Math.round(sleepQualityScore) : null,
    },
    baselines: {
      hrv: hrv30.length >= 7 ? Math.round(avg(hrv30)) : null,
      rhr: rhr30.length >= 7 ? Math.round(avg(rhr30)) : null,
    },
  };
}

// ─── Batch compute scores for a sorted map of date→rawData ───────────────────
// rawData fields: sleepHrs, sleepEff, hrv, rhr, steps, activeMinutes, stressMins, recoveryMins
// Returns array of { date, sleepScore, readinessScore, activityScore, recoveryScore, calibrated }
export function batchComputeScores(byDate, totalHistoryDays) {
  const dates = Object.keys(byDate).sort(); // chronological
  const results = [];

  // Running history arrays (grow as we process each date)
  const history = { hrv: [], rhr: [], sleepHrs: [], steps: [], activeMinutes: [] };

  for (let i = 0; i < dates.length; i++) {
    const date    = dates[i];
    const today   = byDate[date];
    const calibrated = (totalHistoryDays ?? i) >= CALIBRATION_DAYS;

    // 7-day window for activity
    const history7d = dates.slice(Math.max(0, i - 7), i).map(d => byDate[d]);

    const sleep    = calcSleepScore(today, history);
    const readiness= calcReadinessScore(today, history, calibrated);
    const activity = calcActivityScore(today, history7d);
    const recovery = calcRecoveryScore(today, history, calibrated);

    if (sleep.score != null || readiness.score != null || activity.score != null || recovery.score != null) {
      results.push({
        date,
        sleepScore:     sleep.score,
        readinessScore: readiness.score,
        activityScore:  activity.score,
        recoveryScore:  recovery.score,
        calibrated,
        contributors: {
          sleep:    sleep.contributors,
          readiness: readiness.contributors,
          activity: activity.contributors,
          recovery: recovery.contributors,
        },
        computedAt: new Date().toISOString(),
      });
    }

    // Advance history
    if (n(today.hrv)          != null) history.hrv.push(n(today.hrv));
    if (n(today.rhr)          != null) history.rhr.push(n(today.rhr));
    if (n(today.sleepHrs)     != null) history.sleepHrs.push(n(today.sleepHrs));
    if (n(today.steps)        != null) history.steps.push(n(today.steps));
    if (n(today.activeMinutes)!= null) history.activeMinutes.push(n(today.activeMinutes));
  }

  return results;
}
