import { createClient } from '@supabase/supabase-js';

export async function POST(request) {
  const authHeader = request.headers.get('authorization') || '';
  const jwt = authHeader.replace('Bearer ', '').trim();
  if (!jwt) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const now = new Date();
  const today = [now.getFullYear(), String(now.getMonth()+1).padStart(2,'0'), String(now.getDate()).padStart(2,'0')].join('-');

  const { error } = await supabase
    .from('entries')
    .delete()
    .eq('user_id', user.id)
    .in('type', ['health', 'health_apple', 'scores'])
    .gt('date', today);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, today, message: 'Deleted all future health/score rows' });
}
