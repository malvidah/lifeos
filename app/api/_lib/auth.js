// ─── API Auth Middleware ──────────────────────────────────────────────────────
// Wraps route handlers with Supabase auth. Eliminates 30x duplicated auth code.
//
// Usage:
//   import { withAuth } from '../_lib/auth.js';
//   export const GET = withAuth(async (request, { supabase, user, token }) => {
//     // your business logic here
//   });

import { createClient } from '@supabase/supabase-js';

export function withAuth(handler) {
  return async (request) => {
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) return Response.json({ error: 'unauthorized' }, { status: 401 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

    return handler(request, { supabase, user, token });
  };
}

// withAuth + premium check
export function withPremium(handler) {
  return withAuth(async (request, ctx) => {
    const { supabase, user } = ctx;
    const { data: premRow } = await supabase.from('entries').select('data')
      .eq('type', 'premium').eq('date', 'global').eq('user_id', user.id).maybeSingle();
    const isPremium = premRow?.data?.active === true;
    return handler(request, { ...ctx, isPremium });
  });
}
