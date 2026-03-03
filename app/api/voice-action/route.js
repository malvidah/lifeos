// Parses natural-language input into structured actions and writes to Supabase.
// Supports: notes, meals, tasks, activity, calendar events.

import { createClient } from '@supabase/supabase-js';

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

    const { text, date, tz } = await request.json();
    if (!text?.trim() || !date) return Response.json({ error: 'text and date required' }, { status: 400 });

    // Get API key from user settings
    const { data: settingsRow } = await supabase.from('entries').select('data')
      .eq('type', 'settings').eq('date', 'global').eq('user_id', user.id).maybeSingle();
    const apiKey = settingsRow?.data?.anthropicKey;
    if (!apiKey) return Response.json({ error: 'No API key configured. Add your Anthropic key in settings.' }, { status: 402 });

    // 1. Call Claude to parse the input
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
        system: `You parse natural language into structured actions for a personal dashboard.
Return ONLY valid JSON, no markdown. The format:
{
  "actions": [
    {"type":"meals","entries":["salmon salad","protein bar"]},
    {"type":"notes","append":"Mom came over and we played games"},
    {"type":"tasks","entries":[{"text":"call dentist","done":false}]},
    {"type":"activity","entries":["30 min yoga"]},
    {"type":"calendar","events":[{"title":"Mom coming over","startTime":"15:00","endTime":"16:00","allDay":false}]}
  ],
  "summary":"Added salmon salad and protein bar to meals. Added note about mom visiting. Created calendar event at 3 PM."
}

Rules:
- Only include action types that are clearly present in the input
- meals: food/drinks consumed. Each entry is a short description.
- notes: observations, journal entries, reflections, things that happened. Append as natural sentences.
- tasks: to-do items, things to remember to do. Each has text + done:false.
- activity: exercise, workouts, physical activity done. Each entry is a description.
- calendar: future plans, appointments, events with specific times. Include startTime in 24h format if mentioned. Set allDay:true if no specific time.
- If something is ambiguous, lean toward notes.
- summary: brief human-readable description of what you did.`,
        messages: [{ role: 'user', content: `Parse this into actions for ${date}: "${text}"` }],
      }),
    });
    const parseData = await parseRes.json();
    const rawText = parseData.content?.find(b => b.type === 'text')?.text || '{}';
    let parsed;
    try {
      parsed = JSON.parse(rawText.match(/\{[\s\S]*\}/)?.[0] || '{}');
    } catch {
      return Response.json({ error: 'Failed to parse AI response' }, { status: 500 });
    }

    const actions = parsed.actions || [];
    const results = [];

    // 2. Execute each action by reading current data and appending
    for (const action of actions) {
      const { type } = action;

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

      if (type === 'meals' && action.entries?.length) {
        const { data: existing } = await supabase.from('entries').select('data')
          .eq('date', date).eq('type', 'meals').eq('user_id', user.id).maybeSingle();
        const current = Array.isArray(existing?.data) ? existing.data : [];
        // Filter out empty placeholder rows
        const cleaned = current.filter(r => r.text?.trim());
        const newRows = action.entries.map(text => ({
          id: Date.now() + Math.random(),
          text,
          kcal: null,
          protein: null,
        }));
        await supabase.from('entries').upsert(
          { date, type: 'meals', data: [...cleaned, ...newRows], user_id: user.id, updated_at: new Date().toISOString() },
          { onConflict: 'date,type,user_id' }
        );
        results.push({ type: 'meals', count: newRows.length });
      }

      if (type === 'tasks' && action.entries?.length) {
        const { data: existing } = await supabase.from('entries').select('data')
          .eq('date', date).eq('type', 'tasks').eq('user_id', user.id).maybeSingle();
        const current = Array.isArray(existing?.data) ? existing.data : [];
        const cleaned = current.filter(r => r.text?.trim());
        const newRows = action.entries.map(e => ({
          id: Date.now() + Math.random(),
          text: typeof e === 'string' ? e : e.text,
          done: false,
        }));
        await supabase.from('entries').upsert(
          { date, type: 'tasks', data: [...cleaned, ...newRows], user_id: user.id, updated_at: new Date().toISOString() },
          { onConflict: 'date,type,user_id' }
        );
        results.push({ type: 'tasks', count: newRows.length });
      }

      if (type === 'activity' && action.entries?.length) {
        const { data: existing } = await supabase.from('entries').select('data')
          .eq('date', date).eq('type', 'activity').eq('user_id', user.id).maybeSingle();
        const current = Array.isArray(existing?.data) ? existing.data : [];
        const cleaned = current.filter(r => r.text?.trim());
        const newRows = action.entries.map(text => ({
          id: Date.now() + Math.random(),
          text,
          kcal: null,
        }));
        await supabase.from('entries').upsert(
          { date, type: 'activity', data: [...cleaned, ...newRows], user_id: user.id, updated_at: new Date().toISOString() },
          { onConflict: 'date,type,user_id' }
        );
        results.push({ type: 'activity', count: newRows.length });
      }

      if (type === 'calendar' && action.events?.length) {
        // Get Google token
        const { data: stored } = await supabase.from('entries').select('data')
          .eq('date', '0000-00-00').eq('type', 'google_token').eq('user_id', user.id).maybeSingle();
        let accessToken = stored?.data?.token;
        const refreshToken = stored?.data?.refreshToken;

        if (refreshToken && !accessToken) {
          accessToken = await refreshGoogleToken(refreshToken);
        }

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
              return `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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

          // Retry with refreshed token
          if (!res.ok && refreshToken) {
            const newToken = await refreshGoogleToken(refreshToken);
            if (newToken) {
              accessToken = newToken;
              await supabase.from('entries').upsert(
                { date: '0000-00-00', type: 'google_token', data: { token: newToken, refreshToken }, user_id: user.id, updated_at: new Date().toISOString() },
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
