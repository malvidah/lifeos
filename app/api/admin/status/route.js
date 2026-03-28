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

  const svc = getServiceClient();

  // Count total users + premium users
  let userCount = null;
  let premiumCount = 0;
  try {
    const { data } = await svc.from('entries').select('user_id');
    if (data) {
      const uniqueIds = [...new Set(data.map(r => r.user_id))];
      userCount = uniqueIds.length;

      // Check premium status for each user
      const { data: settings } = await svc
        .from('user_settings')
        .select('user_id, data')
        .in('user_id', uniqueIds);
      if (settings) {
        premiumCount = settings.filter(s => s.data?.premium?.active === true).length;
      }
    }
  } catch {}

  return Response.json({
    services: {
      supabase: {
        domain: supabaseDomain,
        configured: !!supabaseDomain,
        notes: 'Postgres + Auth + RLS',
        dashboard: supabaseDomain ? `https://supabase.com/dashboard/project/${supabaseDomain.split('.')[0]}` : null,
      },
      anthropic: {
        configured: !!process.env.ANTHROPIC_API_KEY,
        model: 'claude-haiku-4-5',
        notes: 'Insights, chat, voice-action — 50k tokens/min rate limit',
        dashboard: 'https://console.anthropic.com',
      },
      openai: {
        configured: !!process.env.OPENAI_API_KEY,
        model: 'tts-1, whisper-1 legacy',
        notes: 'TTS generation',
        dashboard: 'https://platform.openai.com/billing',
      },
      groq: {
        configured: !!process.env.GROQ_API_KEY,
        model: 'whisper-large-v3',
        notes: 'Speech-to-text transcription',
        dashboard: 'https://console.groq.com',
      },
      google: {
        configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        notes: 'Calendar OAuth integration',
        dashboard: 'https://console.cloud.google.com',
      },
      vercel: {
        url: process.env.VERCEL_URL || process.env.NEXT_PUBLIC_BASE_URL || null,
        configured: !!(process.env.VERCEL_URL || process.env.NEXT_PUBLIC_BASE_URL),
        notes: 'Edge/Serverless deployment',
        dashboard: 'https://vercel.com/dashboard',
      },
    },
    stats: {
      userCount,
      premiumCount,
      freeCount: userCount !== null ? userCount - premiumCount : null,
    },
  });
});
