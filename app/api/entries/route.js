import { createClient } from '@supabase/supabase-js';

function getSupabase(req) {
  // Get the user's JWT from the Authorization header
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '');
  
  // Create a client authenticated as this user
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');
  const type = searchParams.get('type');
  if (!date) return Response.json({ error: 'date required' }, { status: 400 });

  const supabase = getSupabase(req);
  try {
    if (type) {
      const { data, error } = await supabase
        .from('entries').select('data')
        .eq('date', date).eq('type', type).maybeSingle();
      if (error) throw error;
      return Response.json({ data: data?.data ?? null });
    } else {
      const { data, error } = await supabase
        .from('entries').select('type, data').eq('date', date);
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
  const supabase = getSupabase(req);
  try {
    const { date, type, data } = await req.json();
    if (!date || !type || data === undefined)
      return Response.json({ error: 'date, type, data required' }, { status: 400 });

    // Get user to attach user_id
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: 'not authenticated' }, { status: 401 });

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
