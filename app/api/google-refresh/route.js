// Exchanges a Google refresh token for a new access token
import { createClient } from '@supabase/supabase-js';

function getUserClient(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return { supabase: null };
  return {
    supabase: createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    )
  };
}

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

  // Persist new access token, keep same refresh token
  await supabase.from('entries').upsert(
    { date: '0000-00-00', type: 'google_token', data: { token: data.access_token, refreshToken }, user_id: user.id, updated_at: new Date().toISOString() },
    { onConflict: 'date,type,user_id' }
  );

  return Response.json({ googleToken: data.access_token });
}
