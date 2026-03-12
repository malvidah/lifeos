// ─── Unified API auth middleware ──────────────────────────────────────────────
// Every API route should use withAuth() instead of duplicating JWT extraction,
// Supabase client creation, and user verification.
import { createClient } from '@supabase/supabase-js';

/** Extract JWT from Authorization header or ?token= query param (sendBeacon fallback). */
function extractToken(request) {
  return (request.headers.get('authorization') || '').replace('Bearer ', '').trim()
    || new URL(request.url).searchParams.get('token')
    || '';
}

/** Service-role client — for cron jobs, webhooks, and admin routes that bypass RLS. */
export function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

/**
 * Wrap a route handler with auth verification.
 * Handler receives (request, { supabase, token, user }).
 *
 * Usage:
 *   export const GET = withAuth(async (req, { supabase, user }) => {
 *     return Response.json({ ok: true });
 *   });
 */
export function withAuth(handler) {
  return async (request) => {
    const token = extractToken(request);
    if (!token) return Response.json({ error: 'unauthorized' }, { status: 401 });
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });
    try {
      return await handler(request, { supabase, user, token });
    } catch (err) {
      console.error(`[api] ${new URL(request.url).pathname}:`, err);
      return Response.json({ error: err.message || 'Internal error' }, { status: 500 });
    }
  };
}
