import { createClient } from '@supabase/supabase-js';
import { batchComputeScores } from '@/lib/scoreCalc.js';

// Backfills Oura historical data into health_metrics table.
// Fetches in 90-day chunks to stay within Oura API limits.
// Safe to run multiple times — uses upsert so no duplicates.

const SOURCE_PRIORITY = ['oura', 'apple', 'garmin'];

function metricsToLegacy(row) {
  const out = {};
  if (row.hrv        != null) out.hrv          = String(row.hrv);
  if (row.rhr        != null) out.rhr          = String(row.rhr);
  if (row.sleep_hrs  != null) out.sleepHrs     = String(row.sleep_hrs);
  if (row.sleep_eff  != null) out.sleepEff = String(row.sleep_eff);
  if (row.steps      != null) out.steps        = String(row.steps);
  if (row.active_min != null) out.activeMinutes = String(row.active_min);
  return out;
}

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

  // Read Oura token from user_settings
  const { data: settingsRow } = await supabase
    .from("user_settings").select("data")
    .eq("user_id", user.id)
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

      // Build per-date metrics in health_metrics column format (numeric, snake_case)
      const byDate = {};
      const ensure = d => { if (!byDate[d]) byDate[d] = {}; };

      for (const r of sleepData.data ?? []) {
        ensure(r.day);
        if (r.contributors?.sleep_efficiency != null) byDate[r.day].sleep_eff = r.contributors.sleep_efficiency;
      }
      for (const r of actData.data ?? []) {
        ensure(r.day);
        if (r.steps != null) byDate[r.day].steps = r.steps;
        const activeSecs = (r.medium_activity_time ?? 0) + (r.high_activity_time ?? 0);
        if (activeSecs > 0) byDate[r.day].active_min = Math.round(activeSecs / 60);
      }
      for (const r of sessionData.data ?? []) {
        if (r.type !== 'long_sleep') continue;
        ensure(r.day);
        if (r.lowest_heart_rate != null) byDate[r.day].rhr = Math.round(r.lowest_heart_rate);
        if (r.average_hrv != null) byDate[r.day].hrv = Math.round(r.average_hrv);
        if (r.total_sleep_duration) byDate[r.day].sleep_hrs = parseFloat((r.total_sleep_duration / 3600).toFixed(1));
      }
      for (const r of stressData.data ?? []) {
        ensure(r.day);
        if (r.stress_high != null || r.recovery_high != null) {
          byDate[r.day].raw = {
            stressMins:   r.stress_high   != null ? Math.round(r.stress_high / 60)   : null,
            recoveryMins: r.recovery_high != null ? Math.round(r.recovery_high / 60) : null,
          };
        }
      }

      const rows = Object.entries(byDate)
        .filter(([, data]) => Object.keys(data).length > 0)
        .map(([date, data]) => ({
          user_id: user.id, date, source: 'oura',
          ...data,
          synced_at: new Date().toISOString(),
        }));

      if (rows.length > 0) {
        const { error: upsertErr } = await supabase
          .from('health_metrics')
          .upsert(rows, { onConflict: 'user_id,date,source' });
        if (upsertErr) errors.push(`${s}-${e}: ${upsertErr.message}`);
        else totalUpserted += rows.length;
      }
    } catch (err) {
      errors.push(`${s}-${e}: ${err.message}`);
    }
  }

  // ── Batch compute scores for ALL stored health data ────────────────────────
  try {
    const { data: allMetrics } = await supabase
      .from('health_metrics')
      .select('date, source, hrv, rhr, sleep_hrs, sleep_eff, steps, active_min')
      .eq('user_id', user.id)
      .order('date', { ascending: true });

    if (allMetrics?.length) {
      // Best source per date → legacy format for scoreCalc.js
      const bestByDate = {};
      for (const r of allMetrics) {
        const cur = bestByDate[r.date];
        if (!cur || SOURCE_PRIORITY.indexOf(r.source) < SOURCE_PRIORITY.indexOf(cur.source)) {
          bestByDate[r.date] = r;
        }
      }
      const legacyByDate = Object.fromEntries(
        Object.entries(bestByDate).map(([d, r]) => [d, metricsToLegacy(r)])
      );
      const scored = batchComputeScores(legacyByDate, allMetrics.length);

      const BATCH = 200;
      for (let i = 0; i < scored.length; i += BATCH) {
        const chunk = scored.slice(i, i + BATCH).map(s => ({
          user_id:         user.id,
          date:            s.date,
          winning_source:  bestByDate[s.date]?.source ?? 'oura',
          sleep_score:     s.sleepScore,
          readiness_score: s.readinessScore,
          activity_score:  s.activityScore,
          recovery_score:  s.recoveryScore,
          calibrated:      s.calibrated,
          contributors:    s.contributors,
          computed_at:     s.computedAt,
        }));
        await supabase.from('health_scores').upsert(chunk, { onConflict: 'user_id,date' });
      }
    }
  } catch (scoreErr) {
    errors.push(`score_batch: ${scoreErr.message}`);
  }

  return Response.json({ ok: true, totalUpserted, chunks: chunks.length, errors: errors.length ? errors : undefined });
}
