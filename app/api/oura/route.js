import { createClient } from '@supabase/supabase-js';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") || new Date().toISOString().split("T")[0];

  const authHeader = request.headers.get("authorization") || "";
  const jwt = authHeader.replace("Bearer ", "").trim();
  if (!jwt) return Response.json({ error: "unauthorized" }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  );

  // Verify user first
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return Response.json({ error: "unauthorized" }, { status: 401 });

  // Get THIS user's Oura token from their settings — no env fallback
  const { data: settingsRow } = await supabase
    .from("entries")
    .select("data")
    .eq("type", "settings")
    .eq("date", "global")
    .eq("user_id", user.id)
    .maybeSingle();

  const ouraToken = settingsRow?.data?.ouraToken;
  if (!ouraToken) return Response.json({ error: "no_token" }, { status: 404 });

  try {
    // Oura records sleep/readiness the morning AFTER — so we need to look ahead by 1 day
    const next1 = new Date(date);
    next1.setDate(next1.getDate() + 1);
    const nextDate = next1.toISOString().split("T")[0];

    const prev2 = new Date(date);
    prev2.setDate(prev2.getDate() - 2);
    const prevDate2 = prev2.toISOString().split("T")[0];

    const h = { Authorization: `Bearer ${ouraToken}` };
    const [sleepRes, readinessRes, sessionRes, activityRes, stressRes, workoutRes] = await Promise.all([
      fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${date}&end_date=${nextDate}`, { headers: h }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${date}&end_date=${nextDate}`, { headers: h }),
      fetch(`https://api.ouraring.com/v2/usercollection/sleep?start_date=${prevDate2}&end_date=${nextDate}`, { headers: h }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_activity?start_date=${date}&end_date=${nextDate}`, { headers: h }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_stress?start_date=${date}&end_date=${nextDate}`, { headers: h }),
      fetch(`https://api.ouraring.com/v2/usercollection/workout?start_date=${date}&end_date=${nextDate}`, { headers: h }),
    ]);

    const sleepData     = await sleepRes.json();
    const readinessData = await readinessRes.json();
    const sessionData   = await sessionRes.json();
    const activityData  = await activityRes.json();
    const stressData    = await stressRes.json();
    const workoutData   = await workoutRes.json();

    // Sleep/readiness are recorded the next morning — find the record closest to our date
    const sleepRecords = sleepData.data ?? [];
    const daily = sleepRecords.find(d => d.day === date) || sleepRecords[0];
    const readinessRecords = readinessData.data ?? [];
    const readiness = readinessRecords.find(d => d.day === date) || readinessRecords[0];
    const sessions   = sessionData.data ?? [];
    const mainSession = sessions
      .filter(s => s.type === "long_sleep")
      .sort((a, b) => (b.total_sleep_duration ?? 0) - (a.total_sleep_duration ?? 0))[0];

    const result = {};
    if (daily) {
      result.sleepScore   = daily.score != null ? String(daily.score) : "";
      result.sleepQuality = daily.contributors?.sleep_efficiency != null ? String(daily.contributors.sleep_efficiency) : "";
    }
    if (readiness) result.readinessScore = readiness.score != null ? String(readiness.score) : "";
    if (mainSession) {
      if (mainSession.lowest_heart_rate != null)  result.rhr = String(Math.round(mainSession.lowest_heart_rate));
      if (mainSession.average_hrv != null)         result.hrv = String(Math.round(mainSession.average_hrv));
      if (mainSession.total_sleep_duration)        result.sleepHrs = (mainSession.total_sleep_duration / 3600).toFixed(1);
      if (!result.sleepQuality && mainSession.efficiency) result.sleepQuality = String(mainSession.efficiency);
      // Sleep stages in minutes
    }

    const activity = (activityData.data ?? []).find(d => d.day === date) || activityData.data?.[0];
    if (activity) {
      if (activity.score != null)           result.activityScore   = String(activity.score);
      // total_calories = full day burn (matches Oura "Total Burn")
      // active_calories = active-only portion
      const totalCals  = activity.total_calories  ?? null;
      const activeCals = activity.active_calories ?? null;
      if (totalCals  != null) result.totalCalories  = String(Math.round(totalCals));
      if (activeCals != null) result.activeCalories = String(Math.round(activeCals));
      // steps — Oura v2 uses "steps" directly
      if (activity.steps != null) result.steps = String(activity.steps);
      // Active minutes = medium + high activity time (in seconds → minutes)
      const activeSecs = (activity.medium_activity_time ?? 0) + (activity.high_activity_time ?? 0);
      if (activeSecs > 0) result.activeMinutes = String(Math.round(activeSecs / 60));
    }

    // Recovery score = recovery / (recovery + stress) × 100
    // Gives 100 when stress=0 and recovery>0, blank when no data yet
    const stress = (stressData.data ?? []).find(d => d.day === date) || stressData.data?.[0];
    if (stress) {
      const stressHigh = stress.stress_high ?? null;   // seconds
      const recoveryHigh = stress.recovery_high ?? null; // seconds
      // Convert seconds → minutes for display
      if (stressHigh != null) result.stressMins = String(Math.round(stressHigh / 60));
      if (recoveryHigh != null) result.recoveryMins = String(Math.round(recoveryHigh / 60));
      const recov = recoveryHigh ?? 0;
      const str   = stressHigh ?? 0;
      const total = recov + str;
      if (total > 0) {
        result.resilienceScore = String(Math.round((recov / total) * 100));
      }
      // If total === 0, no data yet — leave resilienceScore unset (ring shows "—")
    }


    // Workout sessions — filter to only the requested day
    const workouts = (workoutData.data ?? []).filter(w => w.day === date);
    if (workouts.length > 0) {
      result.workouts = workouts.map(w => ({
        source:   'oura',
        activity: (w.activity || 'workout').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        durationMins: Math.round((w.duration ?? 0) / 60),
        calories: w.calories != null ? Math.round(w.calories) : null,
        distance: w.distance != null ? +(w.distance / 1000).toFixed(2) : null,
        startTime: w.start_datetime || null,
      }));
    }

    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
