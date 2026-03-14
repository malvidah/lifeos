import { withAuth } from '../_lib/auth.js';

export const GET = withAuth(async (req, { supabase, user }) => {
  const date = new URL(req.url).searchParams.get('date') || new Date().toISOString().split('T')[0];

  // Get this user's Oura token from user_settings
  const { data: settingsRow } = await supabase
    .from('user_settings').select('data').eq('user_id', user.id).maybeSingle();
  const ouraToken = settingsRow?.data?.ouraToken;
  if (!ouraToken) return Response.json({ error: 'no_token' });

  // Oura records sleep/readiness the morning AFTER — look ahead by 1 day
  const next1 = new Date(date); next1.setDate(next1.getDate() + 1);
  const nextDate = next1.toISOString().split('T')[0];
  const prev2 = new Date(date); prev2.setDate(prev2.getDate() - 2);
  const prevDate2 = prev2.toISOString().split('T')[0];

  const h = { Authorization: `Bearer ${ouraToken}` };
  const [sleepRes, readinessRes, sessionRes, activityRes, stressRes, workoutRes] = await Promise.all([
    fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${date}&end_date=${nextDate}`, { headers: h }),
    fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${date}&end_date=${nextDate}`, { headers: h }),
    fetch(`https://api.ouraring.com/v2/usercollection/sleep?start_date=${prevDate2}&end_date=${nextDate}`, { headers: h }),
    fetch(`https://api.ouraring.com/v2/usercollection/daily_activity?start_date=${date}&end_date=${nextDate}`, { headers: h }),
    fetch(`https://api.ouraring.com/v2/usercollection/daily_stress?start_date=${date}&end_date=${nextDate}`, { headers: h }),
    fetch(`https://api.ouraring.com/v2/usercollection/workout?start_date=${date}&end_date=${nextDate}`, { headers: h }),
  ]);

  const [sleepData, readinessData, sessionData, activityData, stressData, workoutData] = await Promise.all(
    [sleepRes, readinessRes, sessionRes, activityRes, stressRes, workoutRes].map(r => r.json())
  );

  const daily = (sleepData.data ?? []).find(d => d.day === date) ?? null;
  const sessions = sessionData.data ?? [];
  const prev1 = new Date(date); prev1.setDate(prev1.getDate() - 1);
  const prevDate1 = prev1.toISOString().split('T')[0];

  const NON_NAP = ['long_sleep', 'sleep', 'rest'];
  const mainSession = sessions
    .filter(s => {
      if (!NON_NAP.includes(s.type)) return false;
      if (!s.bedtime_end) return s.day === date || s.day === prevDate1;
      return s.bedtime_end.slice(0, 10) === date;
    })
    .sort((a, b) => (b.total_sleep_duration ?? 0) - (a.total_sleep_duration ?? 0))[0] ?? null;

  const result = {};
  if (daily) result.sleepEff = daily.contributors?.sleep_efficiency != null ? String(daily.contributors.sleep_efficiency) : '';
  if (mainSession) {
    if (mainSession.lowest_heart_rate != null)  result.rhr = String(Math.round(mainSession.lowest_heart_rate));
    if (mainSession.average_hrv != null)        result.hrv = String(Math.round(mainSession.average_hrv));
    if (mainSession.total_sleep_duration)       result.sleepHrs = (mainSession.total_sleep_duration / 3600).toFixed(1);
    if (!result.sleepEff && mainSession.efficiency) result.sleepEff = String(mainSession.efficiency);
  }

  const activity = (activityData.data ?? []).find(d => d.day === date) ?? null;
  if (activity) {
    if (activity.total_calories  != null) result.totalCalories  = String(Math.round(activity.total_calories));
    if (activity.active_calories != null) result.activeCalories = String(Math.round(activity.active_calories));
    if (activity.steps != null) result.steps = String(activity.steps);
    const activeSecs = (activity.medium_activity_time ?? 0) + (activity.high_activity_time ?? 0);
    if (activeSecs > 0) result.activeMinutes = String(Math.round(activeSecs / 60));
  }

  const stress = (stressData.data ?? []).find(d => d.day === date) ?? null;
  if (stress) {
    const stressHigh = stress.stress_high ?? null;
    const recoveryHigh = stress.recovery_high ?? null;
    if (stressHigh != null) result.stressMins = String(Math.round(stressHigh / 60));
    if (recoveryHigh != null) result.recoveryMins = String(Math.round(recoveryHigh / 60));
    const total = (recoveryHigh ?? 0) + (stressHigh ?? 0);
    if (total > 0) result.resilienceScore = String(Math.round(((recoveryHigh ?? 0) / total) * 100));
  }

  const workouts = (workoutData.data ?? []).filter(w => w.day === date);
  if (workouts.length > 0) {
    result.workouts = workouts.map(w => ({
      source: 'oura',
      activity: (w.activity || 'workout').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      durationMins: Math.round((w.duration ?? 0) / 60),
      calories: w.calories != null ? Math.round(w.calories) : null,
      distance: w.distance != null ? +(w.distance / 1000).toFixed(2) : null,
      startTime: w.start_datetime || null,
    }));
  }

  // ── Persist health metrics & Oura workouts ───────────────────────────────
  const persistPromises = [];

  const metricsPayload = {
    hrv:        result.hrv        ? Number(result.hrv)        : null,
    rhr:        result.rhr        ? Number(result.rhr)        : null,
    sleep_hrs:  result.sleepHrs   ? Number(result.sleepHrs)   : null,
    sleep_eff:  result.sleepEff ? Number(result.sleepEff) : null,
    steps:      result.steps      ? Number(result.steps)      : null,
    active_min: result.activeMinutes ? Number(result.activeMinutes) : null,
  };
  if (Object.values(metricsPayload).some(v => v != null)) {
    persistPromises.push(supabase.from('health_metrics').upsert({
      user_id: user.id, date, source: 'oura',
      ...metricsPayload,
      raw: { sleep: sleepData, readiness: readinessData, activity: activityData, stress: stressData },
      synced_at: new Date().toISOString(),
    }, { onConflict: 'user_id,date,source' }));
  }

  const ouraWorkouts = (workoutData.data ?? []).filter(w => w.day === date);
  for (const w of ouraWorkouts) {
    persistPromises.push(supabase.from('workouts').upsert({
      user_id:      user.id,
      date:         w.day,
      source:       'oura',
      type:         w.activity || 'workout',
      title:        (w.activity || 'workout').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      duration_min: w.duration != null ? Math.round(w.duration / 60) : null,
      distance_m:   w.distance != null ? Math.round(w.distance) : null,
      calories:     w.calories != null ? Math.round(w.calories) : null,
      external_id:  String(w.id),
      raw:          w,
    }, { onConflict: 'user_id,source,external_id' }));
  }

  await Promise.all(persistPromises);

  return Response.json(result);
});
