// Calorie / nutrition estimation — available on free tier.
import { createClient } from '@supabase/supabase-js';
import { ANTHROPIC_KEY } from '../_lib/tier.js';
import { rateLimit } from '../_lib/rateLimit.js';

const MAX_TOKENS_CAP = 300; // calorie estimates are tiny; cap runaway requests

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

    // Rate limit: 30 calorie estimates per user per hour
    const rl = rateLimit(`ai:${user.id}`, { max: 30, windowMs: 60 * 60 * 1000 });
    if (!rl.ok) return Response.json({ error: `Rate limited. Retry in ${rl.retryAfter}s.` }, { status: 429 });

    const apiKey = ANTHROPIC_KEY();
    if (!apiKey) return Response.json({ error: 'Service unavailable' }, { status: 503 });

    const body = await request.json();

    // ── Prompt shorthand: { prompt } → proper Messages API body ──────────
    let apiBody;
    if (body.prompt && !body.messages) {
      apiBody = {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: MAX_TOKENS_CAP,
        messages: [{ role: 'user', content: body.prompt }],
      };
    } else {
      apiBody = {
        ...body,
        max_tokens: Math.min(body.max_tokens ?? MAX_TOKENS_CAP, MAX_TOKENS_CAP),
      };
    }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(apiBody),
    });

    const data = await r.json();

    // ── For prompt shorthand, extract JSON from the response text ─────────
    if (body.prompt && !body.messages && data.content?.[0]?.text) {
      const text = data.content[0].text;
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try { return Response.json(JSON.parse(match[0])); } catch (_) {}
      }
    }

    return Response.json(data, { status: r.status });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
