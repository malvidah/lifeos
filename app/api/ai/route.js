// Calorie / nutrition estimation — available on free tier.
import { createClient } from '@supabase/supabase-js';
import { ANTHROPIC_KEY } from '../_lib/tier.js';

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
    if (authErr || !user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 });

    const apiKey = ANTHROPIC_KEY();
    if (!apiKey) return Response.json({ error: 'Service unavailable' }, { status: 503 });

    const body = await request.json();
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const data = await r.json();
    return Response.json(data, { status: r.status });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
