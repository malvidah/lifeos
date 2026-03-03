import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '../_lib/rateLimit.js';

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

async function refreshGoogleToken(refreshToken) {
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
  return (!r.ok || !data.access_token) ? null : data.access_token;
}

export async function POST(request) {
  try {
    const { supabase } = getUserClient(request);
    if (!supabase) return Response.json({ error: 'unauthorized' }, { status: 401 });
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

    const { text, date, tz, history } = await request.json();
    if (!text?.trim() || !date) return Response.json({ error: 'text and date required' }, { status: 400 });

    // Cap input length to prevent prompt injection via giant strings
    if (text.length > 2000) return Response.json({ error: 'Input too long' }, { status: 400 });

    // Rate limit: 60 actions per user per hour
    const rl = rateLimit(`voice:${user.id}`, { max: 60, windowMs: 60 * 60 * 1000 });
    if (!rl.ok) return Response.json({ error: `Too many requests. Try again in ${rl.retryAfter}s.` }, { status: 429 });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return Response.json({ error: 'Service unavailable' }, { status: 503 });

    // Build context snapshot of today's data so Claude can handle edits intelligently
    const { data: todayEntries } = await supabase.from('entries')
      .select('type, data').eq('date', date).eq('user_id', user.id);
    const today = {};
    for (const row of todayEntries || []) today[row.type] = row.data;

    const snapshot = [];
    if (today.meals?.length) snapshot.push(`Current meals: ${today.meals.filter(r=>r.text?.trim()).map(r=>r.text).join(', ')}`);
    if (today.tasks?.length) snapshot.push(`Current tasks: ${today.tasks.filter(r=>r.text?.trim()).map(r=>r.text).join(', ')}`);
    if (today.activity?.length) snapshot.push(`Current activity: ${today.activity.filter(r=>r.text?.trim()).map(r=>r.text).join(', ')}`);
    if (today.notes) snapshot.push(`Current notes: ${String(today.notes).slice(0, 300)}`);

    // Build conversation context for follow-up edits
    const recentHistory = (history || []).slice(-6)
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const systemPrompt = `You classify and parse natural language input for a personal life dashboard.

FIRST decide the intent:
- "action": the user is recording data or explicitly asking to add/edit/remove something
- "question": the user is asking a question, seeking insights, analysis, or conversational response

Return ONLY valid JSON. Format:
{
  "intent": "action" | "question",
  "actions": [...],
  "summary": "brief description of what was done"
}

If intent is "question", return {"intent":"question","actions":[],"summary":""} — nothing else.

ACTION TYPES:
- Add entries:
  {"type":"meals","entries":["salmon tacos","green salad"]}
  {"type":"notes","append":"Went for a walk in the park"}
  {"type":"tasks","entries":[{"text":"call dentist","done":false}]}
  {"type":"activity","entries":["45 min run"]}
  {"type":"calendar","events":[{"title":"Doctor appointment","startTime":"14:00","endTime":"15:00","allDay":false}]}

- Edit existing entries (use when user wants to change something already added):
  {"type":"meals","edit":{"find":"salmon","replace":"salmon tacos"}}
  {"type":"tasks","edit":{"find":"call dentist","replace":"call dentist tomorrow"}}
  {"type":"activity","edit":{"find":"run","replace":"45 min run"}}

- Delete entries:
  {"type":"meals","delete":"salmon"}
  {"type":"tasks","delete":"call dentist"}

RULES:
- Questions like "what can you tell me?", "how did I sleep?", "what's my HRV?", "analyze my week" → intent: "question"
- Conversational follow-ups ("actually", "instead", "change X to Y", "remove that") → use edit/delete with context from history
- Only include action types clearly present in the input
- For ambiguous input that could be a question OR an action, prefer "question"
- notes: reflections, journal entries, things that happened — NOT questions or requests`;

    const userMessage = [
      snapshot.length ? `Today's data:\n${snapshot.join('\n')}` : '',
      recentHistory ? `Recent conversation:\n${recentHistory}` : '',
      `New message: "${text}"`,
    ].filter(Boolean).join('\n\n');

    const parseRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    const parseData = await parseRes.json();
    if (parseData.error) {
      return Response.json({ error: `AI error: ${parseData.error?.message || JSON.stringify(parseData.error)}` }, { status: 500 });
    }
    const rawText = parseData.content?.find(b => b.type === 'text')?.text || '{}';
    let parsed;
    try {
      parsed = JSON.parse(rawText.match(/\{[\s\S]*\}/)?.[0] || '{}');
    } catch {
      return Response.json({ error: 'Failed to parse AI response' }, { status: 500 });
    }

    // If it's a question, signal the frontend to route to the chat/insights API
    if (parsed.intent === 'question') {
      return Response.json({ ok: false, isQuestion: true });
    }

    const actions = parsed.actions || [];
    const results = [];

    for (const action of actions) {
      const { type } = action;

      // ── NOTES ──────────────────────────────────────────────────────────────
      if (type === 'notes' && action.append) {
        const { data: existing } = await supabase.from('entries').select('data')
          .eq('date', date).eq('type', 'notes').eq('user_id', user.id).maybeSingle();
        const current = existing?.data || '';
        const updated = current ? current + '\n\n' + action.append : action.append;
        await supabase.from('entries').upsert(
          { date, type: 'notes', data: updated, user_id: user.id, updated_at: new Date().toISOString() },
          { onConflict: 'date,type,user_id' }
        );
        results.push({ type: 'notes', count: 1 });
      }

      // ── MEALS ──────────────────────────────────────────────────────────────
      if (type === 'meals') {
        const { data: existing } = await supabase.from('entries').select('data')
          .eq('date', date).eq('type', 'meals').eq('user_id', user.id).maybeSingle();
        const current = Array.isArray(existing?.data) ? existing.data : [];

        if (action.entries?.length) {
          const cleaned = current.filter(r => r.text?.trim());
          const newRows = action.entries.map(text => ({ id: Date.now() + Math.random(), text, kcal: null, protein: null }));
          await supabase.from('entries').upsert(
            { date, type: 'meals', data: [...cleaned, ...newRows], user_id: user.id, updated_at: new Date().toISOString() },
            { onConflict: 'date,type,user_id' }
          );
          results.push({ type: 'meals', count: newRows.length });
        }
        if (action.edit) {
          const updated = current.map(r =>
            r.text?.toLowerCase().includes(action.edit.find.toLowerCase())
              ? { ...r, text: action.edit.replace, kcal: null, protein: null }
              : r
          );
          await supabase.from('entries').upsert(
            { date, type: 'meals', data: updated, user_id: user.id, updated_at: new Date().toISOString() },
            { onConflict: 'date,type,user_id' }
          );
          results.push({ type: 'meals', count: 1 });
        }
        if (action.delete) {
          const updated = current.filter(r => !r.text?.toLowerCase().includes(action.delete.toLowerCase()));
          await supabase.from('entries').upsert(
            { date, type: 'meals', data: updated, user_id: user.id, updated_at: new Date().toISOString() },
            { onConflict: 'date,type,user_id' }
          );
          results.push({ type: 'meals', count: 1 });
        }
      }

      // ── TASKS ──────────────────────────────────────────────────────────────
      if (type === 'tasks') {
        const { data: existing } = await supabase.from('entries').select('data')
          .eq('date', date).eq('type', 'tasks').eq('user_id', user.id).maybeSingle();
        const current = Array.isArray(existing?.data) ? existing.data : [];

        if (action.entries?.length) {
          const cleaned = current.filter(r => r.text?.trim());
          const newRows = action.entries.map(e => ({ id: Date.now() + Math.random(), text: typeof e === 'string' ? e : e.text, done: false }));
          await supabase.from('entries').upsert(
            { date, type: 'tasks', data: [...cleaned, ...newRows], user_id: user.id, updated_at: new Date().toISOString() },
            { onConflict: 'date,type,user_id' }
          );
          results.push({ type: 'tasks', count: newRows.length });
        }
        if (action.edit) {
          const updated = current.map(r =>
            r.text?.toLowerCase().includes(action.edit.find.toLowerCase())
              ? { ...r, text: action.edit.replace }
              : r
          );
          await supabase.from('entries').upsert(
            { date, type: 'tasks', data: updated, user_id: user.id, updated_at: new Date().toISOString() },
            { onConflict: 'date,type,user_id' }
          );
          results.push({ type: 'tasks', count: 1 });
        }
        if (action.delete) {
          const updated = current.filter(r => !r.text?.toLowerCase().includes(action.delete.toLowerCase()));
          await supabase.from('entries').upsert(
            { date, type: 'tasks', data: updated, user_id: user.id, updated_at: new Date().toISOString() },
            { onConflict: 'date,type,user_id' }
          );
          results.push({ type: 'tasks', count: 1 });
        }
      }

      // ── ACTIVITY ───────────────────────────────────────────────────────────
      if (type === 'activity') {
        const { data: existing } = await supabase.from('entries').select('data')
          .eq('date', date).eq('type', 'activity').eq('user_id', user.id).maybeSingle();
        const current = Array.isArray(existing?.data) ? existing.data : [];

        if (action.entries?.length) {
          const cleaned = current.filter(r => r.text?.trim());
          const newRows = action.entries.map(text => ({ id: Date.now() + Math.random(), text, kcal: null }));
          await supabase.from('entries').upsert(
            { date, type: 'activity', data: [...cleaned, ...newRows], user_id: user.id, updated_at: new Date().toISOString() },
            { onConflict: 'date,type,user_id' }
          );
          results.push({ type: 'activity', count: newRows.length });
        }
        if (action.edit) {
          const updated = current.map(r =>
            r.text?.toLowerCase().includes(action.edit.find.toLowerCase())
              ? { ...r, text: action.edit.replace }
              : r
          );
          await supabase.from('entries').upsert(
            { date, type: 'activity', data: updated, user_id: user.id, updated_at: new Date().toISOString() },
            { onConflict: 'date,type,user_id' }
          );
          results.push({ type: 'activity', count: 1 });
        }
        if (action.delete) {
          const updated = current.filter(r => !r.text?.toLowerCase().includes(action.delete.toLowerCase()));
          await supabase.from('entries').upsert(
            { date, type: 'activity', data: updated, user_id: user.id, updated_at: new Date().toISOString() },
            { onConflict: 'date,type,user_id' }
          );
          results.push({ type: 'activity', count: 1 });
        }
      }

      // ── CALENDAR ───────────────────────────────────────────────────────────
      if (type === 'calendar' && action.events?.length) {
        const { data: stored } = await supabase.from('entries').select('data')
          .eq('date', '0000-00-00').eq('type', 'google_token').eq('user_id', user.id).maybeSingle();
        let accessToken = stored?.data?.token;
        const refreshTok = stored?.data?.refreshToken;
        if (refreshTok && !accessToken) accessToken = await refreshGoogleToken(refreshTok);

        const timezone = tz || 'America/Los_Angeles';
        for (const ev of action.events) {
          if (!accessToken) break;
          let eventBody;
          if (ev.allDay || !ev.startTime) {
            const nextDay = new Date(date + 'T12:00:00');
            nextDay.setDate(nextDay.getDate() + 1);
            eventBody = { summary: ev.title, start: { date }, end: { date: nextDay.toISOString().split('T')[0] } };
          } else {
            const endT = ev.endTime || (() => {
              const [h, m] = ev.startTime.split(':').map(Number);
              return `${String((h+1)%24).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
            })();
            eventBody = {
              summary: ev.title,
              start: { dateTime: `${date}T${ev.startTime}:00`, timeZone: timezone },
              end: { dateTime: `${date}T${endT}:00`, timeZone: timezone },
            };
          }
          let res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(eventBody),
          });
          if (!res.ok && refreshTok) {
            const newToken = await refreshGoogleToken(refreshTok);
            if (newToken) {
              accessToken = newToken;
              await supabase.from('entries').upsert(
                { date: '0000-00-00', type: 'google_token', data: { token: newToken, refreshToken: refreshTok }, user_id: user.id, updated_at: new Date().toISOString() },
                { onConflict: 'date,type,user_id' }
              );
              res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
                method: 'POST',
                headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(eventBody),
              });
            }
          }
          results.push({ type: 'calendar', title: ev.title, ok: res.ok });
        }
      }
    }

    return Response.json({ ok: true, results, summary: parsed.summary || 'Done.' });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
