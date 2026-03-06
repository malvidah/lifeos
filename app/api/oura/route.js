import { createClient } from '@supabase/supabase-js';

// Helper: compute local date string from a Date object using a UTC offset in minutes
// e.g. offset = -480 for PST (UTC-8), -420 for PDT (UTC-7)
function localDateStr(date, tzOffset = 0) {
  const adjusted = new Date(date.getTime() + tzOffset * 60000);
  return adjusted.toISOString().split('T')[0];
}

// Date arithmetic that stays timezone-safe
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  // Client passes tzOffset (minutes, e.g. -480 for PST) so server computes correct local date
  const tzOffset = parseInt(searchParams.get('tzOffset') ?? '0', 10);
  const defaultDate = localDateStr(new Date(), tzOffset);
  const date = searchParams.get('date') || defaultDate;

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

  const { data: settingsRow } = await supabase
    .from('entries').select('data')
    .eq('type', 'settings').eq('date', 'global').eq('user_id', user.id)
    .maybeSingle();

  const ouraToken = settingsRow?.data?.ouraToken;
  if (!ouraToken) return Response.json({ error: 'no_token' });

  try {
    // Date window for API queries
    const nextDay  = addDays(date, 1);
    // Sleep sessions: Oura records day = night sleep STARTED (= date - 1 for normal sleep)
    // We only need date-1 and date in the session window (not date-2)
    const prevDay  = addDays(date, -1);
    const prev2Day = addDays(date, -2);

    const h = { Authorization: `Bearer ${ouraToken}` };
    const [sleepRes, readinessRes, sessionRes, activityRes, stressRes, workoutRes] = await Promise.all([
      fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${date}&end_date=${nextDay}`,       { headers: h }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${date}&end_date=${nextDay}`,   { headers: h }),
      fetch(`https://api.ouraring.com/v2/usercollection/sleep?start_date=${prev2Day}&end_date=${nextDay}`,         { headers: h }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_activity?start_date=${date}&end_date=${nextDay}`,    { headers: h }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_stress?start_date=${date}&end_date=${nextDay}`,      { headers: h }),
      fetch(`https://api.ouraring.com/v2/usercollection/workout?start_date=${date}&end_date=${nextDay}`,           { headers: h }),
    ]);

    const [sleepData, readinessData, sessionData, activityData, stressData, workoutData] = await Promise.all([
      sleepRes.json(), readinessRes.json(), sessionRes.json(),
      activityRes.json(), stressRes.json(), workoutRes.json(),
    ]);

    // ── Daily summaries (day field = wakeup/calendar day — always matches `date`) ──
    const daily    = (sleepData.data    ?? []).find(d => d.day === date) ?? null;
    const activity = (activityData.data ?? []).find(d => d.day === date) ?? null;
    const stress   = (stressData.data   ?? []).find(d => d.day === date) ?? null;

    // ── Sleep session (day field = night sleep STARTED, so look in prevDay only) ──
    // We always want the longest non-nap session that started the previous night.
    // We do NOT include `date` itself (would be a same-day nap/rest) or `prev2Day`
    // (that's 2 nights ago — only a fallback if genuinely nothing on prevDay).
    const SLEEP_TYPES = new Set(['long_sleep', 'sleep']); // exclude 'rest' (nap), 'nap'
    const sessions = (sessionData.data ?? []);

    let mainSession =
      sessions
        .filter(s => SLEEP_TYPES.has(s.type) && s.day === prevDay)
        .sort((a, b) => (b.total_sleep_duration ?? 0) - (a.total_sleep_duration ?? 0))[0]
      // Fallback: session recorded on same date (edge: went to sleep after midnight)
      ?? sessions
        .filter(s => SLEEP_TYPES.has(s.type) && s.day === date)
        .sort((a, b) => (b.total_sleep_duration ?? 0) - (a.total_sleep_duration ?? 0))[0]
      ?? null;

    // ── Assemble result ───────────────────────────────────────────────────────
    const result = {};

    // Sleep quality: prefer daily_sleep efficiency contributor
    if (daily?.contributors?.sleep_efficiency != null)
      result.sleepQuality = String(daily.contributors.sleep_efficiency);

    // HRV, RHR, sleep duration from the main session
    if (mainSession) {
      if (mainSession.lowest_heart_rate != null)
        result.rhr = String(Math.round(mainSession.lowest_heart_rate));
      if (mainSession.average_hrv != null)
        result.hrv = String(Math.round(mainSession.average_hrv));
      if (mainSession.total_sleep_duration)
        result.sleepHrs = (mainSession.total_sleep_duration / 3600).toFixed(1);
      // Fallback efficiency from session if daily didn't have it
      if (!result.sleepQuality && mainSession.efficiency)
        result.sleepQuality = String(mainSession.efficiency);
    }

    // Activity
    if (activity) {
      if (activity.total_calories  != null) result.totalCalories  = String(Math.round(activity.total_calories));
      if (activity.active_calories != null) result.activeCalories = String(Math.round(activity.active_calories));
      if (activity.steps           != null) result.steps          = String(activity.steps);
      const activeSecs = (activity.medium_activity_time ?? 0) + (activity.high_activity_time ?? 0);
      if (activeSecs > 0) result.activeMinutes = String(Math.round(activeSecs / 60));
    }

    // Stress / recovery
    if (stress) {
      const stressHigh   = stress.stress_high   ?? null;
      const recoveryHigh = stress.recovery_high ?? null;
      if (stressHigh   != null) result.stressMins   = String(Math.round(stressHigh / 60));
      if (recoveryHigh != null) result.recoveryMins = String(Math.round(recoveryHigh / 60));
      const total = (recoveryHigh ?? 0) + (stressHigh ?? 0);
      if (total > 0) result.resilienceScore = String(Math.round(((recoveryHigh ?? 0) / total) * 100));
    }

    // Workouts
    const workouts = (workoutData.data ?? []).filter(w => w.day === date);
    if (workouts.length > 0) {
      result.workouts = workouts.map(w => ({
        source:       'oura',
        activity:     (w.activity || 'workout').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        durationMins: Math.round((w.duration ?? 0) / 60),
        calories:     w.calories != null ? Math.round(w.calories) : null,
        distance:     w.distance != null ? +(w.distance / 1000).toFixed(2) : null,
        startTime:    w.start_datetime || null,
      }));
    }

    // ── Auto-save to Supabase (only if we have meaningful data) ──────────────
    const saveData = { ...result };
    delete saveData.workouts;
    if (Object.keys(saveData).length > 0) {
      supabase.from('entries').upsert({
        user_id: user.id, date, type: 'health', data: saveData,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,date,type' }).then(() => {});
    }

    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
