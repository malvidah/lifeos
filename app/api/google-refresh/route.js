// Exchanges a Google refresh token for a new access token
import { createClient } from '@supabase/supabase-js';
import { getUserClient } from '../_lib/google.js';

export async function POST(req) {
  const { supabase } = getUserClient(req);
  if (!supabase) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { refreshToken } = await req.json();
  if (!refreshToken) return Response.json({ error: 'no refresh token' }, { status: 400 });

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const data = await r.json();
  if (!r.ok || !data.access_token) {
    return Response.json({ error: data.error || 'refresh failed' }, { status: 400 });
  }

  // Persist new access token to user_settings, keep same refresh token
  const { data: existing } = await supabase.from('user_settings')
    .select('data').eq('user_id', user.id).maybeSingle();
  await supabase.from('user_settings').upsert({
    user_id: user.id,
    data: { ...(existing?.data || {}), googleToken: data.access_token, googleRefreshToken: refreshToken },
  }, { onConflict: 'user_id' });

  return Response.json({ googleToken: data.access_token });
}
