import { withAuth } from '../_lib/auth.js';
import { rateLimit } from '../_lib/rateLimit.js';

export const POST = withAuth(async (req, { supabase, user }) => {
  const rl = rateLimit('tts:' + user.id, { max: 60, windowMs: 60 * 60 * 1000 });
  if (!rl.ok) return Response.json({ error: 'Rate limit exceeded' }, { status: 429 });

  const { text } = await req.json();
  if (!text || typeof text !== 'string' || !text.trim()) {
    return Response.json({ error: 'text is required' }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: 'TTS not configured' }, { status: 503 });

  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1',
      voice: 'alloy',
      input: text.trim(),
      response_format: 'mp3',
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return Response.json({ error: err?.error?.message || 'TTS failed' }, { status: res.status });
  }

  return new Response(res.body, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache',
    },
  });
});
