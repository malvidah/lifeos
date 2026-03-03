import { createClient } from '@supabase/supabase-js';

export async function POST(request) {
  try {
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

    const { code } = await request.json();
    if (!code) return Response.json({ error: 'code required' }, { status: 400 });

    const clientId = process.env.STRAVA_CLIENT_ID;
    const clientSecret = process.env.STRAVA_CLIENT_SECRET;
    if (!clientId || !clientSecret) return Response.json({ error: 'Strava not configured' }, { status: 503 });

    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code' }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return Response.json({ error: tokenData.message || 'Token exchange failed' }, { status: 400 });
    }

    await supabase.from('entries').upsert({
      date: '0000-00-00', type: 'strava_token',
      data: {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: tokenData.expires_at,
        athlete: tokenData.athlete,
      },
      user_id: user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'date,type,user_id' });

    return Response.json({ ok: true, athlete: tokenData.athlete?.firstname });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
