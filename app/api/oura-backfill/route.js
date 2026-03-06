import { createClient } from '@supabase/supabase-js';

// Backfills Oura historical data into Supabase entries table.
// Fetches in 90-day chunks to stay within Oura API limits.
// Safe to run multiple times — uses upsert so no duplicates.

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

  const { data: settingsRow } = await supabase
    .from("entries").select("data")
    .eq("type", "settings").eq("date", "global").eq("user_id", user.id)
    .maybeSingle();

  const ouraToken = settingsRow?.data?.ouraToken;
  if (!ouraToken) return Response.json({ error: "no_token" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const endDate = body.endDate || new Date().toISOString().split('T')[0];
  const startDate = body.startDate || (() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 2); return d.toISOString().split('T')[0];
  })();

  const h = { Authorization: `Bearer ${ouraToken}` };

  // Fetch in 90-day chunks (Oura API limit)
  const chunks = [];
  let chunkStart = new Date(startDate);
  const end = new Date(endDate);
  while (chunkStart <= end) {
    const chunkEnd = new Date(chunkStart);
    chunkEnd.setDate(chunkEnd.getDate() + 89);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());
    chunks.push([chunkStart.toISOString().split('T')[0], chunkEnd.toISOString().split('T')[0]]);
    chunkStart.setDate(chunkStart.getDate() + 90);
  }

  let totalUpserted = 0;
  const errors = [];

  for (const [s, e] of chunks) {
    try {
      const [sleepRes, readRes, actRes, sessionRes, stressRes] = await Promise.all([
        fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${s}&end_date=${e}`, { headers: h }),
        fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${s}&end_date=${e}`, { headers: h }),
        fetch(`https://api.ouraring.com/v2/usercollection/daily_activity?start_date=${s}&end_date=${e}`, { headers: h }),
        fetch(`https://api.ouraring.com/v2/usercollection/sleep?start_date=${s}&end_date=${e}`, { headers: h }),
        fetch(`https://api.ouraring.com/v2/usercollection/daily_stress?start_date=${s}&end_date=${e}`, { headers: h }),
      ]);
      const [sleepData, readData, actData, sessionData, stressData] = await Promise.all([
        sleepRes.json(), readRes.json(), actRes.json(), sessionRes.json(), stressRes.json(),
      ]);

      const byDate = {};
      const ensure = d => { if (!byDate[d]) byDate[d] = {}; };

      for (const r of sleepData.data ?? []) {
        ensure(r.day);
        if (r.score != null) byDate[r.day].sleepScore = String(r.score);
        if (r.contributors?.sleep_efficiency != null) byDate[r.day].sleepQuality = String(r.contributors.sleep_efficiency);
      }
      for (const r of readData.data ?? []) {
        ensure(r.day);
        if (r.score != null) byDate[r.day].readinessScore = String(r.score);
      }
      for (const r of actData.data ?? []) {
        ensure(r.day);
        if (r.score != null) byDate[r.day].activityScore = String(r.score);
        if (r.steps != null) byDate[r.day].steps = String(r.steps);
        if (r.total_calories != null) byDate[r.day].totalCalories = String(Math.round(r.total_calories));
        if (r.active_calories != null) byDate[r.day].activeCalories = String(Math.round(r.active_calories));
        const activeSecs = (r.medium_activity_time ?? 0) + (r.high_activity_time ?? 0);
        if (activeSecs > 0) byDate[r.day].activeMinutes = String(Math.round(activeSecs / 60));
      }
      for (const r of sessionData.data ?? []) {
        if (r.type !== 'long_sleep') continue;
        ensure(r.day);
        if (r.lowest_heart_rate != null) byDate[r.day].rhr = String(Math.round(r.lowest_heart_rate));
        if (r.average_hrv != null) byDate[r.day].hrv = String(Math.round(r.average_hrv));
        if (r.total_sleep_duration) byDate[r.day].sleepHrs = (r.total_sleep_duration / 3600).toFixed(1);
      }
      for (const r of stressData.data ?? []) {
        ensure(r.day);
        if (r.stress_high != null) byDate[r.day].stressMins = String(Math.round(r.stress_high / 60));
        if (r.recovery_high != null) byDate[r.day].recoveryMins = String(Math.round(r.recovery_high / 60));
      }

      const rows = Object.entries(byDate)
        .filter(([, data]) => Object.keys(data).length > 0)
        .map(([date, data]) => ({
          user_id: user.id, date, type: 'health', data,
          updated_at: new Date().toISOString(),
        }));

      if (rows.length > 0) {
        const { error: upsertErr } = await supabase
          .from('entries')
          .upsert(rows, { onConflict: 'user_id,date,type' });
        if (upsertErr) errors.push(`${s}-${e}: ${upsertErr.message}`);
        else totalUpserted += rows.length;
      }
    } catch (err) {
      errors.push(`${s}-${e}: ${err.message}`);
    }
  }

  return Response.json({ ok: true, totalUpserted, chunks: chunks.length, errors: errors.length ? errors : undefined });
}
