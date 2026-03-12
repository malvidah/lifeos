import { withAuth } from '../_lib/auth.js';

export const POST = withAuth(async (req, { supabase, user }) => {
  const { year, month } = await req.json();
  if (year == null || month == null) return Response.json({ error: 'year and month required' }, { status: 400 });

  const startDate = `${year}-${String(month + 1).padStart(2,'0')}-01`;
  const endDay = new Date(year, month + 1, 0).getDate();
  const endDate = `${year}-${String(month + 1).padStart(2,'0')}-${String(endDay).padStart(2,'0')}`;

  const { data: rows } = await supabase.from('entries')
    .select('date, type, data').eq('user_id', user.id).in('type', ['journal'])
    .gte('date', startDate).lte('date', endDate);

  if (!rows || rows.length === 0) return Response.json({ summaries: {} });

  // Build index of notes by date
  const notesByDate = {};
  for (const r of rows) {
    if (!notesByDate[r.date]) notesByDate[r.date] = [];
    const text = typeof r.data === 'string' ? r.data : (r.data?.text || '');
    if (text.trim()) notesByDate[r.date].push(text.trim());
  }
  const datesWithNotes = Object.keys(notesByDate).sort();
  if (datesWithNotes.length === 0) return Response.json({ summaries: {} });

  // Check cache
  const cacheKey = `month_summaries_${year}_${month}`;
  const { data: cached } = await supabase.from('entries')
    .select('data, updated_at').eq('type', 'settings').eq('date', cacheKey).eq('user_id', user.id).maybeSingle();

  if (cached?.data?.summaries && cached?.data?.dates) {
    if (cached.data.dates.sort().join(',') === datesWithNotes.join(','))
      return Response.json({ summaries: cached.data.summaries });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ summaries: {} });

  const lines = datesWithNotes.map(d => `${d}: ${notesByDate[d].join(' ').slice(0, 300)}`).join('\n');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', max_tokens: 350,
      system: `You summarize journal entries into ultra-short one-line summaries (max 8 words each).\nRespond ONLY with valid JSON: {"YYYY-MM-DD": "summary", ...}\nBe specific and concrete. Capture what actually happened. No filler words.`,
      messages: [{ role: 'user', content: `Summarize each date in max 8 words:\n${lines}` }],
    }),
  });

  const aiData = await res.json();
  let summaries = {};
  try { summaries = JSON.parse((aiData.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim()); }
  catch { summaries = {}; }

  await supabase.from('entries').upsert({
    user_id: user.id, date: cacheKey, type: 'settings',
    data: { summaries, dates: datesWithNotes },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,date,type' });

  return Response.json({ summaries });
});
