import { createClient } from '@supabase/supabase-js';

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

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return Response.json({ error: 'Transcription not configured' }, { status: 503 });

    // Convert base64 back to binary and build a File for Whisper
    const binary = Buffer.from(audio, 'base64');
    const ext = mimeType?.includes('mp4') ? 'mp4' : mimeType?.includes('ogg') ? 'ogg' : 'webm';
    const file = new File([binary], `audio.${ext}`, { type: mimeType || 'audio/webm' });

    const form = new FormData();
    form.append('file', file);
    form.append('model', 'whisper-1');
    form.append('language', 'en');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    const data = await res.json();
    if (data.error) return Response.json({ error: data.error.message }, { status: 500 });

    return Response.json({ text: (data.text || '').trim() });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
