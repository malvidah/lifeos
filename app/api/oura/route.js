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

    const [sleepRes, readinessRes, sessionRes, activityRes, stressRes] = await Promise.all([
      fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${date}&end_date=${date}`, { headers: { Authorization: `Bearer ${ouraToken}` } }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${date}&end_date=${date}`, { headers: { Authorization: `Bearer ${ouraToken}` } }),
      fetch(`https://api.ouraring.com/v2/usercollection/sleep?start_date=${prevDate2}&end_date=${date}`, { headers: { Authorization: `Bearer ${ouraToken}` } }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_activity?start_date=${date}&end_date=${date}`, { headers: { Authorization: `Bearer ${ouraToken}` } }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_stress?start_date=${date}&end_date=${date}`, { headers: { Authorization: `Bearer ${ouraToken}` } }),
    ]);

    const sleepData     = await sleepRes.json();
    const readinessData = await readinessRes.json();
    const sessionData   = await sessionRes.json();
    const activityData  = await activityRes.json();
    const stressData    = await stressRes.json();

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
    }
    const activity = activityData.data?.[0];
    if (activity) {
      if (activity.score != null)           result.activityScore   = String(activity.score);
      if (activity.active_calories != null) result.activeCalories  = String(Math.round(activity.active_calories));
      if (activity.steps != null)           result.steps           = String(activity.steps.toLocaleString());
    }

    // Calm score: derived from Oura daily stress
    // Oura daily_stress has stress_high (minutes stressed) and recovery_high (minutes in recovery)
    // We compute calm as 100 - stress_score where stress_score maps stress_high minutes to 0-100
    // Alternatively use the day_summary for a rough score
    const stress = stressData.data?.[0];
    if (stress != null) {
      // stress_high: minutes with high stress (0 = very calm, ~240+ = very stressed)
      // recovery_high: minutes in recovery state
      // We create a 0-100 calm score: max stress is ~480 mins (8h of high stress in a day)
      const stressHigh = stress.stress_high ?? null;
      const recoveryHigh = stress.recovery_high ?? null;
      if (stressHigh != null) {
        // Calm = inverse of stress. 0 stress_high mins = 100 calm; 480+ mins = 0 calm
        const calmScore = Math.max(0, Math.round(100 - (stressHigh / 4.8)));
        result.calmScore = String(calmScore);
      }
      if (recoveryHigh != null) result.recoveryMins = String(recoveryHigh);
    }

    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
