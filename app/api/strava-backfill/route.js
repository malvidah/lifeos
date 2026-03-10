import { createClient } from '@supabase/supabase-js';

export async function POST(request) {
  const authHeader = request.headers.get("authorization") || "";
  const jwt = authHeader.replace("Bearer ", "").trim();
  if (!jwt) return Response.json({ error: "unauthorized" }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return Response.json({ error: "unauthorized" }, { status: 401 });

  // Get Strava tokens + client creds
  const { data: settings } = await supabase.from("entries").select("data")
    .eq("type","settings").eq("date","global").eq("user_id",user.id).maybeSingle();
  const clientId = settings?.data?.stravaClientId || process.env.STRAVA_CLIENT_ID;
  const clientSecret = settings?.data?.stravaClientSecret || process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return Response.json({ error: "no_strava_creds" }, { status: 404 });

  const { data: tokenRow } = await supabase.from("entries").select("data")
    .eq("type","strava_token").eq("date","0000-00-00").eq("user_id",user.id).maybeSingle();
  if (!tokenRow?.data?.access_token) return Response.json({ error: "not_connected" }, { status: 404 });

  let { access_token, refresh_token, expires_at } = tokenRow.data;

  // Refresh token if expired
  if (Date.now() / 1000 > expires_at - 300) {
    const r = await fetch("https://www.strava.com/oauth/token", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret,
        grant_type: "refresh_token", refresh_token }),
    });
    const refreshed = await r.json();
    if (refreshed.access_token) {
      access_token = refreshed.access_token;
      refresh_token = refreshed.refresh_token;
      expires_at = refreshed.expires_at;
      await supabase.from("entries").upsert(
        { date:"0000-00-00", type:"strava_token", user_id:user.id,
          data:{ access_token, refresh_token, expires_at }, updated_at:new Date().toISOString() },
        { onConflict:"date,type,user_id" }
      );
    }
  }

  // Fetch all activities paginated (up to 2 years)
  const since = Math.floor(Date.now() / 1000) - 2 * 365 * 24 * 3600;
  let page = 1, totalUpserted = 0;

  while (true) {
    const res = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?after=${since}&per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    const activities = await res.json();
    if (!Array.isArray(activities) || activities.length === 0) break;

    // Group by date, upsert as activity entries
    const byDate = {};
    for (const a of activities) {
      const date = a.start_date_local?.split("T")[0];
      if (!date) continue;
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push({
        source: "strava",
        id: String(a.id),
        activity: (a.type || "workout").replace(/_/g," "),
        durationMins: Math.round((a.moving_time || 0) / 60),
        distance: a.distance ? +(a.distance / 1000).toFixed(2) : null,
        calories: a.calories || null,
        elevGain: a.total_elevation_gain ? Math.round(a.total_elevation_gain) : null,
        name: a.name || null,
        startTime: a.start_date_local || null,
      });
    }

    const rows = Object.entries(byDate).map(([date, workouts]) => ({
      user_id: user.id, date, type: "activity",
      data: { workouts },
      updated_at: new Date().toISOString(),
    }));

    if (rows.length > 0) {
      const { error } = await supabase.from("entries")
        .upsert(rows, { onConflict: "user_id,date,type" });
      if (!error) totalUpserted += rows.length;
    }

    if (activities.length < 100) break;
    page++;
    if (page > 20) break; // safety limit: 2000 activities
  }

  return Response.json({ ok: true, totalUpserted });
}
