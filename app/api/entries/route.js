import { withAuth } from '../_lib/auth.js';
import { createClient } from '@supabase/supabase-js';

export const GET = withAuth(async (request, { supabase, user }) => {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');
  const type = searchParams.get('type');
  if (!date) return Response.json({ error: 'date required' }, { status: 400 });

  if (type) {
    const { data, error } = await supabase
      .from('entries').select('data')
      .eq('date', date).eq('type', type).eq('user_id', user.id)
      .maybeSingle();
    if (error) throw error;
    return Response.json({ data: data?.data ?? null });
  } else {
    const { data, error } = await supabase
      .from('entries').select('type, data')
      .eq('date', date).eq('user_id', user.id);
    if (error) throw error;
    const day = {};
    for (const row of data || []) day[row.type] = row.data;
    return Response.json({ day });
  }
});

// POST supports both Authorization header and ?token= (sendBeacon fallback)
export async function POST(req) {
  const auth = req.headers.get('authorization') || '';
  const { searchParams } = new URL(req.url);
  const token = auth.replace('Bearer ', '').trim() || searchParams.get('token') || '';
  if (!token) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const { date, type, data } = body;
  if (!date || !type || data === undefined)
    return Response.json({ error: 'date, type, data required' }, { status: 400 });

  const { error } = await supabase.from('entries').upsert(
    { date, type, data, user_id: user.id, updated_at: new Date().toISOString() },
    { onConflict: 'date,type,user_id' }
  );
  if (error) throw error;
  return Response.json({ ok: true });
}
