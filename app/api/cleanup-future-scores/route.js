import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function POST() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const now = new Date();
  const today = [now.getFullYear(), String(now.getMonth()+1).padStart(2,'0'), String(now.getDate()).padStart(2,'0')].join('-');

  // Delete future health_metrics and health_scores rows
  const [metricsResult, scoresResult] = await Promise.all([
    supabase.from('health_metrics').delete().eq('user_id', user.id).gt('date', today),
    supabase.from('health_scores').delete().eq('user_id', user.id).gt('date', today),
  ]);

  const error = metricsResult.error || scoresResult.error;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, today });
}
