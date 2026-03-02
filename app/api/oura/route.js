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
    const prev2 = new Date(date);
    prev2.setDate(prev2.getDate() - 2);
    const prevDate2 = prev2.toISOString().split("T")[0];

    const [sleepRes, readinessRes, sessionRes, activityRes, stressRes, workoutRes] = await Promise.all([
      fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${date}&end_date=${date}`, { headers: { Authorization: `Bearer ${ouraToken}` } }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${date}&end_date=${date}`, { headers: { Authorization: `Bearer ${ouraToken}` } }),
      fetch(`https://api.ouraring.com/v2/usercollection/sleep?start_date=${prevDate2}&end_date=${date}`, { headers: { Authorization: `Bearer ${ouraToken}` } }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_activity?start_date=${date}&end_date=${date}`, { headers: { Authorization: `Bearer ${ouraToken}` } }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_stress?start_date=${date}&end_date=${date}`, { headers: { Authorization: `Bearer ${ouraToken}` } }),
      fetch(`https://api.ouraring.com/v2/usercollection/workout?start_date=${date}&end_date=${date}`, { headers: { Authorization: `Bearer ${ouraToken}` } }),
    ]);

    const sleepData     = await sleepRes.json();
    const readinessData = await readinessRes.json();
    const sessionData   = await sessionRes.json();
    const activityData  = await activityRes.json();
    const stressData    = await stressRes.json();
    const workoutData   = await workoutRes.json();

    const daily      = sleepData.data?.[0];
    const readiness  = readinessData.data?.[0];
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
      result.sleepStages = {
        deep:    Math.round((mainSession.deep_sleep_duration    ?? 0) / 60),
        rem:     Math.round((mainSession.rem_sleep_duration     ?? 0) / 60),
        light:   Math.round((mainSession.light_sleep_duration   ?? 0) / 60),
        awake:   Math.round((mainSession.awake_time             ?? 0) / 60),
        latency: Math.round((mainSession.sleep_latency          ?? 0) / 60),
        total:   Math.round((mainSession.total_sleep_duration   ?? 0) / 60),
      };
    }
    const activity = activityData.data?.[0];
    console.log("[oura-activity]", date, JSON.stringify(activityData).slice(0,300));
    if (activity) {
      if (activity.score != null)           result.activityScore   = String(activity.score);
      const cals = activity.active_calories ?? activity.total_calories ?? null;
      if (cals != null) result.activeCalories = String(Math.round(cals));
      if (activity.steps != null)           result.steps           = String(activity.steps); // plain number string, no commas
    }

    // Calm: inverted from Oura stress_high (minutes in high-stress HRV state)
    // stress_high = 0 → totally calm day → score 100
    // stress_high = 500 → very stressed day → score 0
    const stress = stressData.data?.[0];
    if (stress) {
      const stressHigh = stress.stress_high ?? null;   // seconds
      const recoveryHigh = stress.recovery_high ?? null; // seconds
      // Convert seconds → minutes for display
      if (stressHigh != null) result.stressMins = String(Math.round(stressHigh / 60));
      if (recoveryHigh != null) result.recoveryMins = String(Math.round(recoveryHigh / 60));
      if (stressHigh != null) {
        // 500 minutes (30000s) of stress = score 0; recalibrate using minutes
        const stressMins = stressHigh / 60;
        result.resilienceScore = String(Math.max(0, Math.min(100, Math.round(100 - stressMins / 5))));
      }
      // Time-series stress data: array of {timestamp, stress_level} at ~5-min intervals
      // stress_level: 0=unknown, 1=restored, 2=relaxed, 3=engaged, 4=stressed
      if (stress.stress_data && Array.isArray(stress.stress_data)) {
        result.stressTimeline = stress.stress_data.map(pt => ({
          t: pt.timestamp,    // ISO timestamp
          s: pt.stress_level, // 0-4
        }));
      }
    }

    // Workout sessions for Activity widget
    const workouts = workoutData.data ?? [];
    if (workouts.length > 0) {
      result.workouts = workouts.map(w => ({
        activity: w.activity || "workout",
        duration: Math.round((w.duration ?? 0) / 60), // minutes
        calories: w.calories != null ? Math.round(w.calories) : null,
        distance: w.distance != null ? +(w.distance / 1000).toFixed(2) : null, // km
      }));
    }

    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
