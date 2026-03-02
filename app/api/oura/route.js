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

    const [sleepRes, readinessRes, sessionRes] = await Promise.all([
      fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${date}&end_date=${date}`, { headers: { Authorization: `Bearer ${ouraToken}` } }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${date}&end_date=${date}`, { headers: { Authorization: `Bearer ${ouraToken}` } }),
      fetch(`https://api.ouraring.com/v2/usercollection/sleep?start_date=${prevDate2}&end_date=${date}`, { headers: { Authorization: `Bearer ${ouraToken}` } }),
    ]);

    const sleepData     = await sleepRes.json();
    const readinessData = await readinessRes.json();
    const sessionData   = await sessionRes.json();

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

    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
