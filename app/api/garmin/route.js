import { withAuth } from '../_lib/auth.js';
import { GarminConnect } from 'garmin-connect';

export const runtime = 'nodejs';
export const maxDuration = 20;

export const GET = withAuth(async (req, { supabase, user }) => {
  const date = new URL(req.url).searchParams.get('date') || new Date().toISOString().split('T')[0];

  const { data: settingsRow } = await supabase.from('entries').select('data')
    .eq('type', 'settings').eq('date', 'global').eq('user_id', user.id).maybeSingle();

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

    // Persist refreshed tokens if changed
    try {
      const newTokens = GCClient.exportToken();
      if (newTokens?.oauth2?.access_token !== tokens?.oauth2?.access_token) {
        const { data: settRow } = await supabase.from('entries').select('data')
          .eq('type', 'settings').eq('date', 'global').eq('user_id', user.id).maybeSingle();
        supabase.from('entries').upsert({
          user_id: user.id, date: 'global', type: 'settings',
          data: { ...(settRow?.data || {}), garminTokens: newTokens },
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,date,type' }).then(() => {});
      }
    } catch { /* safe to ignore */ }

    // Auto-save health data
    if (Object.keys(result).length > 0) {
      const saveData = { ...result };
      delete saveData.workouts;
      supabase.from('entries').upsert({
        user_id: user.id, date, type: 'health', data: saveData,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,date,type' }).then(() => {});
    }

    return Response.json(result);
  } catch (e) {
    const msg = e?.message || String(e);
    if (msg.includes('401') || msg.includes('Unauthorized')) return Response.json({ error: 'token_expired' });
    throw e;
  }
});
