import { createClient } from '@supabase/supabase-js';
import { ANTHROPIC_KEY } from '../_lib/tier.js';

export async function POST(request) {
  try {
    const token = (request.headers.get('authorization') || '').replace('Bearer ', '').trim();
    if (!token) return Response.json({ error: 'unauthorized' }, { status: 401 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

    const { audio, mimeType } = await request.json();
    if (!audio) return Response.json({ error: 'no audio' }, { status: 400 });

    const apiKey = ANTHROPIC_KEY();
    if (!apiKey) return Response.json({ error: 'Service unavailable' }, { status: 503 });

    // Normalise mime type for Anthropic (only accepts audio/mp4, audio/mpeg, audio/webm, audio/wav, audio/ogg)
    const safeMime = mimeType?.startsWith('audio/webm') ? 'audio/webm'
      : mimeType?.startsWith('audio/mp4') ? 'audio/mp4'
      : mimeType?.startsWith('audio/ogg') ? 'audio/ogg'
      : mimeType?.startsWith('audio/wav') ? 'audio/wav'
      : 'audio/mp4';

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'audio',
              source: {
                type: 'base64',
                media_type: safeMime,
                data: audio,
              },
            },
            {
              type: 'text',
              text: 'Transcribe this audio exactly as spoken. Return only the transcription text, nothing else.',
            },
          ],
        }],
      }),
    });

    const data = await res.json();
    if (data.error) return Response.json({ error: data.error.message }, { status: 500 });

    const text = (data.content?.find(b => b.type === 'text')?.text || '').trim();
    return Response.json({ text });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
