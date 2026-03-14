// Cron job: runs every 2 hours 6am–2pm to pre-populate today's Oura data.
// Vercel invokes this via vercel.json cron config with CRON_SECRET header.
// For each user with an Oura token, fetches today + yesterday and upserts health_metrics.

import { createClient } from '@supabase/supabase-js';
import { batchComputeScores } from '@/lib/scoreCalc.js';
import { persistScores } from '@/lib/persistScores.js';

const SOURCE_PRIORITY = ['oura', 'apple', 'garmin'];

// Convert health_metrics row (numeric columns) → legacy camelCase strings for scoreCalc.js
function metricsToLegacy(row) {
  if (!row) return {};
  const out = {};
  if (row.hrv        != null) out.hrv          = String(row.hrv);
  if (row.rhr        != null) out.rhr          = String(row.rhr);
  if (row.sleep_hrs  != null) out.sleepHrs     = String(row.sleep_hrs);
  if (row.sleep_eff  != null) out.sleepEff = String(row.sleep_eff);
  if (row.steps      != null) out.steps        = String(row.steps);
  if (row.active_min != null) out.activeMinutes = String(row.active_min);
  return out;
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization') || '';
  const secret = process.env.CRON_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return Response.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' }, { status: 500 });

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey);

  // Find all users with Oura tokens from user_settings
  const { data: settingsRows, error } = await sb
    .from('user_settings')
    .select('user_id, data')
    .not('data->ouraToken', 'is', null);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const today     = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const dates     = [today, yesterday];
  const results   = [];

  for (const row of settingsRows ?? []) {
    const { user_id, data } = row;
    const ouraToken = data?.ouraToken;
    if (!ouraToken) continue;

    try {
      for (const date of dates) {
        const metrics = await fetchOuraForDate(date, ouraToken);
        if (!metrics || Object.keys(metrics).length === 0) continue;

        await sb.from('health_metrics').upsert({
          user_id, date, source: 'oura',
          ...metrics,
          synced_at: new Date().toISOString(),
        }, { onConflict: 'user_id,date,source' });
      }

      // Recompute scores for the last 2 days
      const { data: metricRows } = await sb
        .from('health_metrics')
        .select('date, source, hrv, rhr, sleep_hrs, sleep_eff, steps, active_min')
        .eq('user_id', user_id)
        .gte('date', new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0])
        .order('date', { ascending: true });

      if (metricRows?.length) {
        // Pick best source per date, convert to legacy format for scoreCalc.js
        const bestByDate = {};
        for (const r of metricRows) {
          const cur = bestByDate[r.date];
          if (!cur || SOURCE_PRIORITY.indexOf(r.source) < SOURCE_PRIORITY.indexOf(cur.source)) {
            bestByDate[r.date] = r;
          }
        }
        const legacyByDate = Object.fromEntries(
          Object.entries(bestByDate).map(([d, r]) => [d, metricsToLegacy(r)])
        );
        const computed = batchComputeScores(legacyByDate, metricRows.length);
        const recentDates = computed.filter(s => s.date >= yesterday).map(s => s.date);
        if (recentDates.length) {
          await persistScores(sb, user_id, computed, bestByDate, recentDates);
        }
      }

      results.push({ user_id: user_id.slice(0, 8), status: 'ok', dates });
    } catch (e) {
      results.push({ user_id: user_id.slice(0, 8), status: 'error', message: e.message });
    }
  }

  return Response.json({ synced: results.length, results, at: new Date().toISOString() });
}

async function fetchOuraForDate(date, ouraToken) {
  const next1 = new Date(date); next1.setDate(next1.getDate() + 1);
  const nextDate = next1.toISOString().split('T')[0];
  const prev2 = new Date(date); prev2.setDate(prev2.getDate() - 2);
  const prevDate2 = prev2.toISOString().split('T')[0];
  const prev1 = new Date(date); prev1.setDate(prev1.getDate() - 1);
  const prevDate1 = prev1.toISOString().split('T')[0];

  const h = { Authorization: `Bearer ${ouraToken}` };
  const [sleepRes, readinessRes, sessionRes, activityRes, stressRes] = await Promise.all([
    fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${date}&end_date=${nextDate}`, { headers: h }),
    fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${date}&end_date=${nextDate}`, { headers: h }),
    fetch(`https://api.ouraring.com/v2/usercollection/sleep?start_date=${prevDate2}&end_date=${nextDate}`, { headers: h }),
    fetch(`https://api.ouraring.com/v2/usercollection/daily_activity?start_date=${date}&end_date=${nextDate}`, { headers: h }),
    fetch(`https://api.ouraring.com/v2/usercollection/daily_stress?start_date=${date}&end_date=${nextDate}`, { headers: h }),
  ]);

  const sleepData    = await sleepRes.json();
  const readinessData= await readinessRes.json();
  const sessionData  = await sessionRes.json();
  const activityData = await activityRes.json();
  const stressData   = await stressRes.json();

  const daily      = (sleepData.data ?? []).find(d => d.day === date) ?? null;
  const sessions   = sessionData.data ?? [];
  const mainSession = sessions
    .filter(s => s.type === 'long_sleep' && (s.day === date || s.day === prevDate1))
    .sort((a, b) => (b.total_sleep_duration ?? 0) - (a.total_sleep_duration ?? 0))[0] ?? null;

  // Return in health_metrics column format (snake_case numerics)
  const result = {};

  if (daily?.contributors?.sleep_efficiency != null) {
    result.sleep_eff = daily.contributors.sleep_efficiency;
  }

  if (mainSession) {
    if (mainSession.lowest_heart_rate != null) result.rhr = Math.round(mainSession.lowest_heart_rate);
    if (mainSession.average_hrv != null)        result.hrv = Math.round(mainSession.average_hrv);
    if (mainSession.total_sleep_duration)       result.sleep_hrs = parseFloat((mainSession.total_sleep_duration / 3600).toFixed(1));
    if (!result.sleep_eff && mainSession.efficiency) result.sleep_eff = mainSession.efficiency;
  }

  const activity = (activityData.data ?? []).find(d => d.day === date) ?? null;
  if (activity) {
    if (activity.steps != null) result.steps = activity.steps;
    const activeSecs = (activity.medium_activity_time ?? 0) + (activity.high_activity_time ?? 0);
    if (activeSecs > 0) result.active_min = Math.round(activeSecs / 60);
  }

  const stress = (stressData.data ?? []).find(d => d.day === date) ?? null;
  if (stress?.stress_high != null || stress?.recovery_high != null) {
    result.raw = {
      ...(result.raw || {}),
      stressMins:   stress.stress_high   != null ? Math.round(stress.stress_high / 60)   : null,
      recoveryMins: stress.recovery_high != null ? Math.round(stress.recovery_high / 60) : null,
    };
  }

  return result;
}
