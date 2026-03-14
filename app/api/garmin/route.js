import { withAuth } from '../_lib/auth.js';
import { GarminConnect } from 'garmin-connect';

export const runtime = 'nodejs';
export const maxDuration = 20;

export const GET = withAuth(async (req, { supabase, user }) => {
  const date = new URL(req.url).searchParams.get('date') || new Date().toISOString().split('T')[0];

  const { data: settingsRow } = await supabase.from('user_settings').select('data')
    .eq('user_id', user.id).maybeSingle();

  const tokens = settingsRow?.data?.garminTokens;
  if (!tokens?.oauth1 || !tokens?.oauth2) return Response.json({ error: 'no_token' });

  const GCClient = new GarminConnect();

  try {
    GCClient.loadToken(tokens.oauth1, tokens.oauth2);
    const [y, m, d] = date.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d, 12, 0, 0);

    const [sleepData, stepsCount] = await Promise.all([
      GCClient.getSleepData(dateObj).catch(() => null),
      GCClient.getSteps(dateObj).catch(() => null),
    ]);
    const activities = await GCClient.getActivities(0, 5).catch(() => []);
    const dayActivities = (Array.isArray(activities) ? activities : []).filter(a =>
      (a.startTimeLocal || a.startTimeGMT || '').slice(0, 10) === date
    );

    const result = {};
    if (sleepData) {
      const dto = sleepData.dailySleepDTO;
      const sleepSecs = dto?.sleepTimeSeconds ?? 0;
      if (sleepSecs > 0) result.sleepHrs = (sleepSecs / 3600).toFixed(1);
      const awakeSecs = dto?.awakeSleepSeconds ?? 0;
      const totalBed = sleepSecs + awakeSecs;
      if (totalBed > 0) result.sleepQuality = String(Math.round((sleepSecs / totalBed) * 100));
      if (sleepData.avgOvernightHrv > 0) result.hrv = String(Math.round(sleepData.avgOvernightHrv));
      if (sleepData.restingHeartRate > 0) result.rhr = String(sleepData.restingHeartRate);
    }
    if (stepsCount > 0) result.steps = String(stepsCount);

    if (dayActivities.length > 0) {
      result.workouts = dayActivities.map(a => ({
        source: 'garmin',
        activity: (a.activityType?.typeKey || 'workout').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        durationMins: a.duration != null ? Math.round(a.duration / 60) : null,
        calories: a.calories != null ? Math.round(a.calories) : null,
        distance: a.distance != null ? +(a.distance / 1000).toFixed(2) : null,
        startTime: a.startTimeGMT || a.startTimeLocal || null,
      }));
      const totalActiveCals = dayActivities.reduce((s, a) => s + (a.calories ?? 0), 0);
      if (totalActiveCals > 0) result.activeCalories = String(Math.round(totalActiveCals));
      const totalActiveMins = dayActivities.reduce((s, a) => s + (a.movingDuration ?? a.duration ?? 0) / 60, 0);
      if (totalActiveMins > 0) result.activeMinutes = String(Math.round(totalActiveMins));
    }

    // ── Persist refreshed tokens to user_settings ────────────────────────────
    try {
      const newTokens = GCClient.exportToken();
      if (newTokens?.oauth2?.access_token !== tokens?.oauth2?.access_token) {
        await supabase.from('user_settings').upsert({
          user_id: user.id,
          data: { ...(settingsRow?.data || {}), garminTokens: newTokens },
        }, { onConflict: 'user_id' });
      }
    } catch { /* safe to ignore */ }

    // ── Persist health metrics & Garmin workouts ──────────────────────────────
    const persistPromises = [];

    const metricsPayload = {
      hrv:        result.hrv        ? Number(result.hrv)        : null,
      rhr:        result.rhr        ? Number(result.rhr)        : null,
      sleep_hrs:  result.sleepHrs   ? Number(result.sleepHrs)   : null,
      sleep_eff:  result.sleepQuality ? Number(result.sleepQuality) : null,
      steps:      result.steps      ? Number(result.steps)      : null,
      active_min: result.activeMinutes ? Number(result.activeMinutes) : null,
    };
    if (Object.values(metricsPayload).some(v => v != null)) {
      persistPromises.push(supabase.from('health_metrics').upsert({
        user_id: user.id, date, source: 'garmin',
        ...metricsPayload,
        raw: { sleep: sleepData, steps: stepsCount },
        synced_at: new Date().toISOString(),
      }, { onConflict: 'user_id,date,source' }));
    }

    for (const a of dayActivities) {
      persistPromises.push(supabase.from('workouts').upsert({
        user_id:      user.id,
        date,
        source:       'garmin',
        type:         a.activityType?.typeKey || 'workout',
        title:        a.activityName || (a.activityType?.typeKey || 'workout').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        duration_min: a.duration != null ? Math.round(a.duration / 60) : null,
        distance_m:   a.distance != null ? Math.round(a.distance) : null,
        calories:     a.calories != null ? Math.round(a.calories) : null,
        avg_hr:       a.averageHR != null ? Math.round(a.averageHR) : null,
        external_id:  String(a.activityId || a.activityName || date),
        raw:          a,
      }, { onConflict: 'user_id,source,external_id' }));
    }

    await Promise.all(persistPromises);

    return Response.json(result);
  } catch (e) {
    const msg = e?.message || String(e);
    if (msg.includes('401') || msg.includes('Unauthorized')) return Response.json({ error: 'token_expired' });
    throw e;
  }
});
