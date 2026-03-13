import { withAuth } from '../_lib/auth.js';

export const POST = withAuth(async (req, { supabase, user }) => {
  const { year, month } = await req.json();
  if (year == null || month == null) return Response.json({ error: 'year and month required' }, { status: 400 });

  const startDate = `${year}-${String(month + 1).padStart(2,'0')}-01`;
  const endDay = new Date(year, month + 1, 0).getDate();
  const endDate = `${year}-${String(month + 1).padStart(2,'0')}-${String(endDay).padStart(2,'0')}`;

  // ── Check day_recaps cache first ──────────────────────────────────────────
  // If all days in the range already have a recap, return those immediately.
  const { data: existingRecaps } = await supabase
    .from('day_recaps')
    .select('date, content')
    .eq('user_id', user.id)
    .gte('date', startDate).lte('date', endDate);

  const cachedSummaries = Object.fromEntries((existingRecaps ?? []).map(r => [r.date, r.content]));

  // ── Fetch journal_blocks for the month ────────────────────────────────────
  const { data: blockRows } = await supabase
    .from('journal_blocks')
    .select('date, content')
    .eq('user_id', user.id)
    .gte('date', startDate).lte('date', endDate)
    .order('date', { ascending: true })
    .order('position', { ascending: true });

  if (!blockRows || blockRows.length === 0) {
    return Response.json({ summaries: cachedSummaries });
  }

  // Group plain text by date
  const notesByDate = {};
  for (const r of blockRows) {
    if (!notesByDate[r.date]) notesByDate[r.date] = [];
    // Strip HTML tags for the summary prompt
    const text = (r.content || '').replace(/<[^>]+>/g, '').trim();
    if (text) notesByDate[r.date].push(text);
  }

  // Only request AI summaries for dates that don't have a cached recap
  const datesToSummarise = Object.keys(notesByDate)
    .filter(d => !cachedSummaries[d])
    .sort();

  if (datesToSummarise.length === 0) {
    return Response.json({ summaries: cachedSummaries });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ summaries: cachedSummaries });

  const lines = datesToSummarise.map(d => `${d}: ${notesByDate[d].join(' ').slice(0, 300)}`).join('\n');
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
  let newSummaries = {};
  try { newSummaries = JSON.parse((aiData.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim()); }
  catch { newSummaries = {}; }

  // ── Upsert new recaps to day_recaps ──────────────────────────────────────
  const recapRows = Object.entries(newSummaries)
    .filter(([, content]) => content?.trim())
    .map(([date, content]) => ({
      user_id: user.id,
      date,
      content: content.trim(),
      generated_at: new Date().toISOString(),
    }));

  if (recapRows.length > 0) {
    await supabase.from('day_recaps')
      .upsert(recapRows, { onConflict: 'user_id,date' });
  }

  return Response.json({ summaries: { ...cachedSummaries, ...newSummaries } });
});
