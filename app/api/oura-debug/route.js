import { createClient } from '@supabase/supabase-js';

export async function GET(request) {
  const authHeader = request.headers.get("authorization") || "";
  const jwt = authHeader.replace("Bearer ", "").trim();
  if (!jwt) return Response.json({ error: "unauthorized" }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { data: settingsRow } = await supabase
    .from("entries").select("data")
    .eq("type", "settings").eq("date", "global").eq("user_id", user.id)
    .maybeSingle();

  const ouraToken = settingsRow?.data?.ouraToken;
  if (!ouraToken) return Response.json({ error: "no_token" });

  const h = { Authorization: `Bearer ${ouraToken}` };

  // Fetch a wide window to see what dates actually have data
  const [activity, sleep, readiness] = await Promise.all([
    fetch(`https://api.ouraring.com/v2/usercollection/daily_activity?start_date=2026-02-01&end_date=2026-03-02`, {headers:h}).then(r=>r.json()),
    fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=2026-02-01&end_date=2026-03-02`, {headers:h}).then(r=>r.json()),
    fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=2026-02-01&end_date=2026-03-02`, {headers:h}).then(r=>r.json()),
  ]);

  return Response.json({
    activity_count: activity.data?.length,
    activity_dates: activity.data?.map(d => ({date:d.day, score:d.score})),
    sleep_count: sleep.data?.length,
    sleep_dates: sleep.data?.map(d => ({date:d.day, score:d.score})),
    readiness_count: readiness.data?.length,
    readiness_dates: readiness.data?.map(d => ({date:d.day, score:d.score})),
    activity_error: activity.error,
    sleep_error: sleep.error,
  });
}
