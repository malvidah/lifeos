import { createClient } from '@supabase/supabase-js';

// Build a Supabase client authenticated as the requesting user.
// Token comes from Authorization header (normal) or ?token= query param (sendBeacon fallback).
function getUserClient(req) {
  const auth = req.headers.get('authorization') || '';
  const { searchParams } = new URL(req.url);
  const token = auth.replace('Bearer ', '').trim() || searchParams.get('token') || '';
  if (!token) return { supabase: null, token: null };

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  return { supabase, token };
}

export async function GET(req) {
  const { supabase } = getUserClient(req);
  if (!supabase) return Response.json({ error: 'unauthorized' }, { status: 401 });

  // Verify token and get user — RLS will enforce user_id filter automatically
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');
  const type = searchParams.get('type');
  if (!date) return Response.json({ error: 'date required' }, { status: 400 });

  try {
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
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req) {
  const { supabase } = getUserClient(req);
  if (!supabase) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  try {
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
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
