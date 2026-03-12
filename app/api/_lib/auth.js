import { createClient } from '@supabase/supabase-js';
export function withAuth(handler) {
  return async (request) => {
    const token = (request.headers.get('authorization') || '').replace('Bearer ', '').trim();
    if (!token) return Response.json({ error: 'unauthorized' }, { status: 401 });
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { global: { headers: { Authorization: 'Bearer ' + token } } });
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });
    return handler(request, { supabase, user, token });
  };
}
