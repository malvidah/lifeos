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

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { data: settingsRow } = await supabase
    .from("entries").select("data")
    .eq("type", "settings").eq("date", "global").eq("user_id", user.id)
    .maybeSingle();

  const ouraToken = settingsRow?.data?.ouraToken;
  if (!ouraToken) return Response.json({ error: "no_token" });

  const h = { Authorization: `Bearer ${ouraToken}` };
  const [sleep, readiness, activity, personal] = await Promise.all([
    fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${date}&end_date=${date}`, {headers:h}).then(r=>r.json()),
    fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${date}&end_date=${date}`, {headers:h}).then(r=>r.json()),
    fetch(`https://api.ouraring.com/v2/usercollection/daily_activity?start_date=${date}&end_date=${date}`, {headers:h}).then(r=>r.json()),
    fetch(`https://api.ouraring.com/v2/usercollection/personal_info`, {headers:h}).then(r=>r.json()),
  ]);

  return Response.json({
    date,
    sleep_count: sleep.data?.length,
    sleep_score: sleep.data?.[0]?.score,
    readiness_count: readiness.data?.length,
    readiness_score: readiness.data?.[0]?.score,
    activity_count: activity.data?.length,
    activity_score: activity.data?.[0]?.score,
    activity_raw: activity.data?.[0],
    personal_info: personal,
  });
}
