import { createClient } from '@supabase/supabase-js';
import { GarminConnect } from 'garmin-connect';

export const runtime = 'nodejs';
export const maxDuration = 20;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') || new Date().toISOString().split('T')[0];

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

  const { data: settingsRow } = await supabase.from('entries').select('data')
    .eq('type', 'settings').eq('date', 'global').eq('user_id', user.id).maybeSingle();

  const tokens = settingsRow?.data?.garminTokens;
  if (!tokens?.oauth1 || !tokens?.oauth2) return Response.json({ error: 'no_token' });

  const GCClient = new GarminConnect();

  // Track if tokens were refreshed so we can persist the new ones
  let refreshedTokens = null;
  const originalExport = GCClient.client?.oauth2Token?.access_token;

  try {
    GCClient.loadToken(tokens.oauth1, tokens.oauth2);

    // Parse date as local noon to avoid UTC boundary issues
    const [y, m, d] = date.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d, 12, 0, 0);

    // Fetch sleep + steps in parallel; activities separately to avoid blocking
    const [sleepData, stepsCount] = await Promise.all([
      GCClient.getSleepData(dateObj).catch(() => null),
      GCClient.getSteps(dateObj).catch(() => null),
    ]);

    // Activities for the day (limit 5 — enough for one day)
    const activities = await GCClient.getActivities(0, 5).catch(() => []);

    // Filter activities to this date (startTimeLocal is "YYYY-MM-DD HH:MM:SS")
    const dayActivities = (Array.isArray(activities) ? activities : []).filter(a => {
      const actDate = (a.startTimeLocal || a.startTimeGMT || '').slice(0, 10);
      return actDate === date;
    });

    // ── Normalize to Day Lab health shape ────────────────────────────────────
    const result = {};

    if (sleepData) {
      const dto = sleepData.dailySleepDTO;

      // Sleep hours — use sleepTimeSeconds (excludes naps)
      const sleepSecs = dto?.sleepTimeSeconds ?? 0;
      if (sleepSecs > 0) result.sleepHrs = (sleepSecs / 3600).toFixed(1);

      // Sleep efficiency = sleep time / (sleep time + awake time in bed)
      const awakeSecs = dto?.awakeSleepSeconds ?? 0;
      const totalBed = sleepSecs + awakeSecs;
      if (totalBed > 0) result.sleepQuality = String(Math.round((sleepSecs / totalBed) * 100));

      // HRV — avgOvernightHrv is top-level on SleepData (not inside dailySleepDTO)
      if (sleepData.avgOvernightHrv != null && sleepData.avgOvernightHrv > 0)
        result.hrv = String(Math.round(sleepData.avgOvernightHrv));

      // RHR — restingHeartRate is top-level on SleepData
      if (sleepData.restingHeartRate != null && sleepData.restingHeartRate > 0)
        result.rhr = String(sleepData.restingHeartRate);
    }

    // Steps — getSteps() returns a number for the day
    if (stepsCount != null && stepsCount > 0) result.steps = String(stepsCount);

    // Activities → workouts array
    if (dayActivities.length > 0) {
      result.workouts = dayActivities.map(a => {
        const typeKey = a.activityType?.typeKey || 'workout';
        return {
          source: 'garmin',
          activity: typeKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          durationMins: a.duration != null ? Math.round(a.duration / 60) : null,
          calories: a.calories != null ? Math.round(a.calories) : null,
          distance: a.distance != null ? +(a.distance / 1000).toFixed(2) : null,
          startTime: a.startTimeGMT || a.startTimeLocal || null,
        };
      });

      // Sum active calories from day's activities as a proxy for Garmin's activeKilocalories
      const totalActiveCals = dayActivities.reduce((s, a) => s + (a.calories ?? 0), 0);
      if (totalActiveCals > 0) result.activeCalories = String(Math.round(totalActiveCals));

      // Active minutes from activity durations
      const totalActiveMins = dayActivities.reduce((s, a) => s + (a.movingDuration ?? a.duration ?? 0) / 60, 0);
      if (totalActiveMins > 0) result.activeMinutes = String(Math.round(totalActiveMins));
    }

    // Persist refreshed tokens if the client refreshed them (access_token changed)
    try {
      const newTokens = GCClient.exportToken();
      if (newTokens?.oauth2?.access_token !== tokens?.oauth2?.access_token) {
        const { data: settRow } = await supabase.from('entries').select('data')
          .eq('type', 'settings').eq('date', 'global').eq('user_id', user.id).maybeSingle();
        supabase.from('entries').upsert({
          user_id: user.id, date: 'global', type: 'settings',
          data: { ...(settRow?.data || {}), garminTokens: newTokens },
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,date,type' }).then(() => {}); // fire-and-forget
      }
    } catch { /* exportToken throws if no tokens — safe to ignore */ }

    // Auto-save health snapshot to Supabase (same as Oura route)
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
    if (msg.includes('401') || msg.includes('Unauthorized')) {
      return Response.json({ error: 'token_expired' });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
