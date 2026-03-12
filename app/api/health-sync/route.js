import { withAuth } from '../_lib/auth.js';

export const POST = withAuth(async (req, { supabase, user }) => {
  const { date, ...healthData } = await req.json();
  if (!date) return Response.json({ error: 'date required' }, { status: 400 });

  const hasData = Object.keys(healthData).some(k =>
    healthData[k] !== null && healthData[k] !== undefined && healthData[k] !== ''
  );
  if (!hasData) return Response.json({ ok: true, skipped: 'no data' });

  const { error } = await supabase.from('entries').upsert({
    user_id: user.id, date, type: 'health_apple', data: healthData,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,date,type' });
  if (error) throw error;
  return Response.json({ ok: true });
});
