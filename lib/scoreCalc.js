// ─── Shared score calculation logic ───────────────────────────────────────────
// Used by /api/scores (single date) and /api/oura-backfill (batch).
// All scores are computed from raw biometric metrics only — never from
// Oura's own score fields (sleepScore, readinessScore, activityScore).

export const CALIBRATION_DAYS = 14;

// Population/guideline baselines (used before personal calibration)
export const POP = {
  hrv: 55,
  rhr: 60,
  sleepHrs: 8,
  sleepEff: 85,
  steps: 8000,
  activeMinutes: 22,
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

export function stdDev(arr) {
  const v = arr.filter(x => x != null);
  if (v.length < 2) return v.length === 1 ? v[0] * 0.15 : 10;
  const m = avg(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
}

// Parse numeric from stored string
export function n(v) { const x = parseFloat(v); return isNaN(x) ? null : x; }

// ─── Score calculators ────────────────────────────────────────────────────────

export function calcSleepScore(today, history) {
  const hrs = n(today.sleepHrs);
  const eff = n(today.sleepEff ?? today.sleepQuality); // sleepQuality is the stored efficiency field

  // 7–9h = 100. Floor at 5.5h — steep penalty below 7h (6.3h → ~53, 6.5h → ~67)
  const sleepHrsScore = hrs != null ? rangeScore(hrs, 7, 9, 5.5, 12) : null;
  // Efficiency: 85–100% = 100, <60% = 0
  const effScore = eff != null ? rangeScore(eff, 85, 100, 50, 100) : null;

  const contributors = [sleepHrsScore, effScore].filter(v => v != null);
  if (!contributors.length) return { score: null, contributors: { sleepHrs: null, efficiency: null } };

  const weights = [], weighted = [];
  if (sleepHrsScore != null) { weights.push(0.7); weighted.push(sleepHrsScore * 0.7); }
  if (effScore != null)       { weights.push(0.3); weighted.push(effScore * 0.3); }

  const totalW = weights.reduce((a, b) => a + b, 0);
  return {
    score: Math.round(weighted.reduce((a, b) => a + b, 0) / totalW),
    contributors: {
      sleepHrs:   sleepHrsScore != null ? Math.round(sleepHrsScore) : null,
      efficiency: effScore      != null ? Math.round(effScore)      : null,
    },
  };
}

export function calcReadinessScore(today, history, calibrated) {
  const hrv = n(today.hrv);
  const rhr = n(today.rhr);

  let hrvScore = null, rhrScore = null;

  let baselineHrv = null, baselineRhr = null;
  if (calibrated && history.hrv.length >= 7) {
    baselineHrv = avg(history.hrv.slice(-90));
    const sdHrv       = stdDev(history.hrv.slice(-30));
    const recentHrv   = weightedAvg([...history.hrv.slice(-14)]);
    const trendHrv    = recentHrv != null && baselineHrv != null ? recentHrv : hrv;
    hrvScore = deviationScore(trendHrv ?? hrv, baselineHrv, sdHrv, true);
    baselineRhr = avg(history.rhr.slice(-60));
    const sdRhr       = stdDev(history.rhr.slice(-30));
    rhrScore = deviationScore(rhr, baselineRhr, sdRhr, false);
  } else {
    if (hrv != null) hrvScore = rangeScore(hrv, 40, 80, 10, 120);
    if (rhr != null) rhrScore = rhr <= 65 ? 100 : rangeScore(rhr, 50, 65, 30, 110);
  }

  const sleepScore = calcSleepScore(today, history).score;
  const parts = [], wts = [];
  if (hrvScore  != null) { parts.push(hrvScore  * 0.40); wts.push(0.40); }
  if (rhrScore  != null) { parts.push(rhrScore  * 0.30); wts.push(0.30); }
  if (sleepScore != null){ parts.push(sleepScore * 0.30); wts.push(0.30); }

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

export function calcActivityScore(today, history7d) {
  const steps         = n(today.steps);
  const activeMinutes = n(today.activeMinutes);

  // If both primary activity metrics are absent, don't compute a score.
  // freq/recovery from 7d history alone inflate to ~100, which is misleading
  // whether it's today at 2 AM (no sync yet) or a past date with missing data.
  if (steps == null && activeMinutes == null) {
    return { score: null, contributors: { steps: null, activeMinutes: null, frequency: null, recovery: null } };
  }

  const stepsScore  = steps         != null ? rangeScore(steps,         8000, 12000, 0, 20000) : null;
  const activeScore = activeMinutes != null ? rangeScore(activeMinutes, 22,   60,    0, 120)   : null;

  const activeDays = history7d.filter(d => (n(d.activeMinutes) ?? 0) >= 20).length;
  const restDays   = history7d.filter(d => (n(d.activeMinutes) ?? 0) < 15).length;
  const freqScore  = rangeScore(activeDays, 3, 7, 0, 7);
  const recovScore = rangeScore(restDays,   1, 3, 0, 7);

  const parts = [], wts = [];
  if (stepsScore  != null) { parts.push(stepsScore  * 0.25); wts.push(0.25); }
  if (activeScore != null) { parts.push(activeScore * 0.35); wts.push(0.35); }
  parts.push(freqScore  * 0.25); wts.push(0.25);
  parts.push(recovScore * 0.15); wts.push(0.15);

  const totalW = wts.reduce((a, b) => a + b, 0);
  return {
    score: Math.round(parts.reduce((a, b) => a + b, 0) / totalW),
    contributors: {
      steps:         stepsScore  != null ? Math.round(stepsScore)  : null,
      activeMinutes: activeScore != null ? Math.round(activeScore) : null,
      frequency:     Math.round(freqScore),
      recovery:      Math.round(recovScore),
    },
  };
}

export function calcRecoveryScore(today, history, calibrated) {
  const hrv7  = history.hrv.slice(-7).filter(v => v != null);
  const hrv30 = history.hrv.slice(-30).filter(v => v != null);
  const rhr7  = history.rhr.slice(-7).filter(v => v != null);
  const rhr30 = history.rhr.slice(-30).filter(v => v != null);
  const hrv   = n(today.hrv);
  const rhr   = n(today.rhr);

  let hrvTrendScore = null, rhrTrendScore = null;
  if (hrv7.length >= 3 && hrv30.length >= 7) {
    hrvTrendScore = deviationScore(avg(hrv7), avg(hrv30), stdDev(hrv30), true);
  } else if (hrv != null) {
    hrvTrendScore = rangeScore(hrv, 40, 80, 10, 120);
  }
  if (rhr7.length >= 3 && rhr30.length >= 7) {
    rhrTrendScore = deviationScore(avg(rhr7), avg(rhr30), stdDev(rhr30), false);
  } else if (rhr != null) {
    rhrTrendScore = rhr <= 65 ? 100 : rangeScore(rhr, 50, 65, 30, 110);
  }

  const sleep14 = history.sleepHrs.slice(-14).filter(v => v != null);
  let sleepDebtScore = null;
  if (sleep14.length >= 3) {
    sleepDebtScore = rangeScore(avg(sleep14), 7, 9, 3, 12);
  }

  const parts = [], wts = [];
  if (hrvTrendScore  != null) { parts.push(hrvTrendScore  * 0.50); wts.push(0.50); }
  if (rhrTrendScore  != null) { parts.push(rhrTrendScore  * 0.30); wts.push(0.30); }
  if (sleepDebtScore != null) { parts.push(sleepDebtScore * 0.20); wts.push(0.20); }

  if (!parts.length) return { score: null, contributors: { hrvTrend: null, rhrTrend: null } };
  const totalW = wts.reduce((a, b) => a + b, 0);
  return {
    score: Math.round(parts.reduce((a, b) => a + b, 0) / totalW),
    contributors: {
      hrvTrend: hrvTrendScore != null ? Math.round(hrvTrendScore) : null,
      rhrTrend: rhrTrendScore != null ? Math.round(rhrTrendScore) : null,
    },
    baselines: {
      hrv: hrv30.length >= 7 ? Math.round(avg(hrv30)) : null,
      rhr: rhr30.length >= 7 ? Math.round(avg(rhr30)) : null,
    },
  };
}

// ─── Batch compute scores for a sorted map of date→rawData ───────────────────
// rawData fields: sleepHrs, sleepQuality, hrv, rhr, steps, activeMinutes, stressMins, recoveryMins
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
