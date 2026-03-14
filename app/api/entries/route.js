import { withAuth } from '../_lib/auth.js';
import { isValidDate } from '@/lib/validate.js';

export const GET = withAuth(async (req, { supabase, user }) => {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');
  const type = searchParams.get('type');
  if (!date || (!isValidDate(date) && date !== 'global')) return Response.json({ error: 'valid date (YYYY-MM-DD) required' }, { status: 400 });

  if (type) {
    const { data, error } = await supabase
      .from('entries').select('data')
      .eq('date', date).eq('type', type).eq('user_id', user.id)
      .maybeSingle();
    if (error) throw error;
    return Response.json({ data: data?.data ?? null });
  }

  const { data, error } = await supabase
    .from('entries').select('type, data')
    .eq('date', date).eq('user_id', user.id);
  if (error) throw error;
  const day = {};
  for (const row of data || []) day[row.type] = row.data;
  return Response.json({ day });
});

export const POST = withAuth(async (req, { supabase, user }) => {
  const { date, type, data } = await req.json();
  if (!date || (!isValidDate(date) && date !== 'global') || !type || data === undefined)
    return Response.json({ error: 'valid date (YYYY-MM-DD), type, data required' }, { status: 400 });

  const { error } = await supabase.from('entries').upsert(
    { date, type, data, user_id: user.id, updated_at: new Date().toISOString() },
    { onConflict: 'date,type,user_id' }
  );
  if (error) throw error;
  return Response.json({ ok: true });
});
