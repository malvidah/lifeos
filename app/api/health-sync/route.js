import { withAuth } from '../_lib/auth.js';
import { isValidDate } from '@/lib/validate.js';

// POST /api/health-sync
// Called by the iOS Shortcut / Apple Health bridge to push Apple Health data.
// Body: { date, hrv?, rhr?, sleep_hrs?, sleep_eff?, steps?, active_min? }
// Writes to health_metrics with source='apple'.

export const POST = withAuth(async (req, { supabase, user }) => {
  const { date, ...healthData } = await req.json();
  if (!date || !isValidDate(date)) return Response.json({ error: 'valid date (YYYY-MM-DD) required' }, { status: 400 });

  const hasData = Object.keys(healthData).some(k =>
    healthData[k] !== null && healthData[k] !== undefined && healthData[k] !== ''
  );
  if (!hasData) return Response.json({ ok: true, skipped: 'no data' });

  // Map incoming field names to health_metrics columns
  const row = {
    user_id:    user.id,
    date,
    source:     'apple',
    hrv:        toNum(healthData.hrv),
    rhr:        toNum(healthData.rhr),
    sleep_hrs:  toNum(healthData.sleepHrs ?? healthData.sleep_hrs),
    sleep_eff:  toNum(healthData.sleepEff ?? healthData.sleep_eff),
    steps:      toNum(healthData.steps),
    active_min: toNum(healthData.activeMinutes ?? healthData.active_min),
    raw:        healthData,
    synced_at:  new Date().toISOString(),
  };

  const { error } = await supabase
    .from('health_metrics')
    .upsert(row, { onConflict: 'user_id,date,source' });
  if (error) throw error;

  return Response.json({ ok: true });
});

function toNum(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}
