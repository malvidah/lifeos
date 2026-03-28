import { withAuth, getServiceClient } from '../../_lib/auth.js';

const OWNER_EMAIL = 'marvin.liyanage@gmail.com';

export const GET = withAuth(async (req, { user }) => {
  if (user.email !== OWNER_EMAIL) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  // Parse Supabase URL to just domain
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  let supabaseDomain = '';
  try { supabaseDomain = new URL(supabaseUrl).hostname; } catch {}

  // Count users via service role client
  let userCount = null;
  try {
    const svc = getServiceClient();
    const { count, error } = await svc.from('entries').select('user_id', { count: 'exact', head: true });
    if (!error) {
      // Get distinct user count from entries table
      const { data: users } = await svc.rpc('get_user_count').single();
      userCount = users?.count ?? null;
    }
  } catch {}

  // If rpc doesn't exist, fallback: count distinct user_ids from entries
  if (userCount === null) {
    try {
      const svc = getServiceClient();
      const { data } = await svc.from('entries').select('user_id');
      if (data) userCount = new Set(data.map(r => r.user_id)).size;
    } catch {}
  }

  return Response.json({
    services: {
      supabase: { domain: supabaseDomain, configured: !!supabaseDomain },
      anthropic: { configured: !!process.env.ANTHROPIC_API_KEY },
      openai: { configured: !!process.env.OPENAI_API_KEY },
      groq: { configured: !!process.env.GROQ_API_KEY },
      google: { configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) },
      vercel: { url: process.env.VERCEL_URL || process.env.NEXT_PUBLIC_BASE_URL || null },
    },
    stats: {
      userCount,
    },
  });
});
