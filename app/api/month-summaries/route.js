import { createClient } from '@supabase/supabase-js';

const ANTHROPIC_KEY = () => process.env.ANTHROPIC_API_KEY || '';

export async function POST(request) {
  const authHeader = request.headers.get("authorization") || "";
  const jwt = authHeader.replace("Bearer ", "").trim();
  if (!jwt) return Response.json({ error: "unauthorized" }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json();
  const { year, month } = body; // month is 0-indexed
  if (year == null || month == null) return Response.json({ error: "year and month required" }, { status: 400 });

  const startDate = `${year}-${String(month + 1).padStart(2,'0')}-01`;
  const endDay = new Date(year, month + 1, 0).getDate();
  const endDate = `${year}-${String(month + 1).padStart(2,'0')}-${String(endDay).padStart(2,'0')}`;

  // Fetch notes + journal entries for the month
  const { data: rows } = await supabase.from('entries')
    .select('date, type, data')
    .eq('user_id', user.id)
    .in('type', ['notes', 'journal'])
    .gte('date', startDate)
    .lte('date', endDate);

  if (!rows || rows.length === 0) return Response.json({ summaries: {} });

  // Check cache — only regenerate if notes changed
  const cacheKey = `month_summaries_${year}_${month}`;
  const { data: cached } = await supabase.from('entries')
    .select('data, updated_at')
    .eq('type', 'settings').eq('date', cacheKey).eq('user_id', user.id)
    .maybeSingle();

  // Build index of notes by date
  const notesByDate = {};
  for (const r of rows) {
    if (!notesByDate[r.date]) notesByDate[r.date] = [];
    const text = r.data?.rows?.map(row => row.text || '').filter(Boolean).join(' ') ||
                 r.data?.content || r.data?.text || '';
    if (text.trim()) notesByDate[r.date].push(text.trim());
  }

  const datesWithNotes = Object.keys(notesByDate).sort();
  if (datesWithNotes.length === 0) return Response.json({ summaries: {} });

  // Check if cached summaries are still fresh (cover same dates)
  if (cached?.data?.summaries && cached?.data?.dates) {
    const cachedDates = cached.data.dates.sort().join(',');
    const currentDates = datesWithNotes.join(',');
    if (cachedDates === currentDates) {
      return Response.json({ summaries: cached.data.summaries });
    }
  }

  const apiKey = ANTHROPIC_KEY();
  if (!apiKey) return Response.json({ summaries: {} });

  // Build prompt — one line per date
  const lines = datesWithNotes.map(d => `${d}: ${notesByDate[d].join(' ').slice(0, 300)}`).join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 350,
      system: `You summarize journal entries into ultra-short one-line summaries (max 8 words each). 
Respond ONLY with valid JSON: {"YYYY-MM-DD": "summary", ...}
Be specific and concrete. Capture what actually happened. No filler words.`,
      messages: [{ role: 'user', content: `Summarize each date in max 8 words:\n${lines}` }],
    }),
  });

  const aiData = await res.json();
  let summaries = {};
  try {
    const text = aiData.content?.[0]?.text || '{}';
    summaries = JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch { summaries = {}; }

  // Cache summaries
  await supabase.from('entries').upsert({
    user_id: user.id, date: cacheKey, type: 'settings',
    data: { summaries, dates: datesWithNotes },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,date,type' });

  return Response.json({ summaries });
}
