// Cron job: runs every 2 hours 6am–2pm to pre-populate today's Oura data.
// Vercel invokes this via vercel.json cron config with CRON_SECRET header.
// For each user with an Oura token, fetches today + yesterday and upserts health entries.

import { createClient } from '@supabase/supabase-js';
import { batchComputeScores } from '@/lib/scoreCalc.js';

export async function GET(request) {
  // Verify this is coming from Vercel cron (or our own internal call)
  const authHeader = request.headers.get('authorization') || '';
  const secret = process.env.CRON_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Use service role key so we can read all users' settings
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return Response.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' }, { status: 500 });

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey);

  // Find all users with Oura tokens
  const { data: settingsRows, error } = await sb
    .from('entries')
    .select('user_id, data')
    .eq('type', 'settings')
    .eq('date', 'global')
    .not('data->ouraToken', 'is', null);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const dates = [today, yesterday];

  const results = [];

  for (const row of settingsRows ?? []) {
    const { user_id, data } = row;
    const ouraToken = data?.ouraToken;
    if (!ouraToken) continue;

    try {
      for (const date of dates) {
        const result = await fetchOuraForDate(date, ouraToken);
        if (!result || Object.keys(result).length === 0) continue;

        // Upsert health entry
        await sb.from('entries').upsert({
          user_id, date, type: 'health', data: result,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,date,type' });
      }

      // Recompute scores for the last 2 days
      const since = yesterday;
      const { data: healthRows } = await sb
        .from('entries').select('date, data')
        .eq('user_id', user_id).eq('type', 'health')
        .gte('date', new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0])
        .order('date', { ascending: true });

      if (healthRows?.length) {
        const byDate = Object.fromEntries(healthRows.map(r => [r.date, r.data]));
        const computed = batchComputeScores(byDate, healthRows.length)
          .filter(s => s.date >= since);

        if (computed.length) {
          const scoreRows = computed.map(s => ({
            user_id, date: s.date, type: 'scores',
            data: {
              sleepScore: s.sleepScore, readinessScore: s.readinessScore,
              activityScore: s.activityScore, recoveryScore: s.recoveryScore,
              calibrated: s.calibrated, computedAt: s.computedAt,
            },
            updated_at: new Date().toISOString(),
          }));
          await sb.from('entries').upsert(scoreRows, { onConflict: 'user_id,date,type' });
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

  const result = {};
  if (daily?.contributors?.sleep_efficiency != null)
    result.sleepQuality = String(daily.contributors.sleep_efficiency);

  if (mainSession) {
    if (mainSession.lowest_heart_rate != null) result.rhr = String(Math.round(mainSession.lowest_heart_rate));
    if (mainSession.average_hrv != null)        result.hrv = String(Math.round(mainSession.average_hrv));
    if (mainSession.total_sleep_duration)       result.sleepHrs = (mainSession.total_sleep_duration / 3600).toFixed(1);
    if (!result.sleepQuality && mainSession.efficiency) result.sleepQuality = String(mainSession.efficiency);
  }

  const activity = (activityData.data ?? []).find(d => d.day === date) ?? null;
  if (activity) {
    if (activity.total_calories  != null) result.totalCalories  = String(Math.round(activity.total_calories));
    if (activity.active_calories != null) result.activeCalories = String(Math.round(activity.active_calories));
    if (activity.steps           != null) result.steps          = String(activity.steps);
    const activeSecs = (activity.medium_activity_time ?? 0) + (activity.high_activity_time ?? 0);
    if (activeSecs > 0) result.activeMinutes = String(Math.round(activeSecs / 60));
  }

  const stress = (stressData.data ?? []).find(d => d.day === date) ?? null;
  if (stress) {
    const stressHigh   = stress.stress_high   ?? null;
    const recoveryHigh = stress.recovery_high ?? null;
    if (stressHigh   != null) result.stressMins   = String(Math.round(stressHigh / 60));
    if (recoveryHigh != null) result.recoveryMins = String(Math.round(recoveryHigh / 60));
    const total = (recoveryHigh ?? 0) + (stressHigh ?? 0);
    if (total > 0) result.resilienceScore = String(Math.round(((recoveryHigh ?? 0) / total) * 100));
  }

  return result;
}
