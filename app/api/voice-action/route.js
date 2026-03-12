import { createClient } from '@supabase/supabase-js';
import { getUserClient, refreshGoogleToken } from '../_lib/google.js';
import { isPremium } from '../_lib/tier.js';
import { rateLimit } from '../_lib/rateLimit.js';

export async function POST(request) {
  try {
    const { supabase } = getUserClient(request);
    if (!supabase) return Response.json({ error: 'unauthorized' }, { status: 401 });
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

    const { text, date, tz } = await request.json();
    if (!text?.trim() || !date) return Response.json({ error: 'text and date required' }, { status: 400 });

    // Cap input length to prevent prompt injection via giant strings
    if (text.length > 2000) return Response.json({ error: 'Input too long' }, { status: 400 });

    // Rate limit: 60 actions per user per hour
    const rl = rateLimit(`voice:${user.id}`, { max: 60, windowMs: 60 * 60 * 1000 });
    if (!rl.ok) return Response.json({ error: `Too many requests. Try again in ${rl.retryAfter}s.` }, { status: 429 });

    // Voice entry is a premium feature
    const premium = await isPremium(supabase, user.id);
    if (!premium) {
      return Response.json({ tier: 'free', message: 'Voice entry requires a Premium account.' });
    }

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

    const contextSnippet = snapshot.length ? snapshot.join('\n') : 'No data logged yet today.';

    const systemPrompt = `You are a data entry assistant for a personal wellness dashboard. Your only job is to parse add/log/update/delete commands and write structured actions.

Respond ONLY with valid JSON — no explanation, no markdown.

If the request is clearly asking to add, log, edit, or remove data, return:
{"ok": true, "actions": [...], "summary": "Added X to Y"}

If it is a question, is vague, references unsupported sources, or you genuinely can't determine what to add, return:
{"ok": false, "message": "Short sentence explaining why (max 10 words)"}

Supported types: meals, tasks, notes, activity, calendar
NOT supported: strava, oura, health metrics

Action formats:
{"type":"meals","entries":["salmon 400kcal","green salad"]}
{"type":"tasks","entries":[{"text":"call dentist","done":false}]}
{"type":"journal","append":"felt good today"}
{"type":"workouts","entries":["30 min run"]}
{"type":"meals","edit":{"find":"salmon","replace":"salmon tacos"}}
{"type":"tasks","delete":"call dentist"}
{"type":"calendar","events":[{"title":"Lunch with Sarah","startTime":"12:00","endTime":"13:00","allDay":false}]}
{"type":"calendar","events":[{"title":"Team offsite","allDay":true}]}

For calendar events:
- Parse natural language times: "noon" → "12:00", "3pm" → "15:00", "9:30" → "09:30"
- If no end time given, default to 1 hour after start
- If no time at all, set allDay: true
- The date context is: ${date}
- If user says "tomorrow" or a weekday name, still use date ${date} (front-end handles date routing)
- Keep event titles clean and concise

For bulk adds ("add 3 tasks from today's insight"), generate multiple entries.
Keep summary short and conversational: "Added breakfast" not "Successfully added meal entry".

Today's existing data:
${contextSnippet}`;

    const userMessage = [
      snapshot.length ? `Today's data:\n${snapshot.join('\n')}` : '',
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
        max_tokens: 250,
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

    // If AI declined (question, vague, unsupported) — return message to show in status bar
    if (!parsed.ok || parsed.ok === false) {
      return Response.json({ ok: false, message: parsed.message || "I can only add data — try 'add a meal' or 'add a task'" });
    }

    const actions = parsed.actions || [];
    const results = [];

    for (const action of actions) {
      const { type } = action;

      // ── NOTES ──────────────────────────────────────────────────────────────
      if ((type === 'notes' || type === 'journal') && action.append) {
        const { data: existing } = await supabase.from('entries').select('data')
          .eq('date', date).eq('type', 'journal').eq('user_id', user.id).maybeSingle();
        const current = existing?.data || '';
        const updated = current ? current + '\n\n' + action.append : action.append;
        await supabase.from('entries').upsert(
          { date, type: 'journal', data: updated, user_id: user.id, updated_at: new Date().toISOString() },
          { onConflict: 'date,type,user_id' }
        );
        results.push({ type: 'journal', count: 1 });
      }

      // ── MEALS ──────────────────────────────────────────────────────────────
      if (type === 'meals') {
        const { data: existing } = await supabase.from('entries').select('data')
          .eq('date', date).eq('type', 'meals').eq('user_id', user.id).maybeSingle();
        const current = Array.isArray(existing?.data) ? existing.data : [];

        if (action.entries?.length) {
          const cleaned = current.filter(r => r.text?.trim());
          const newRows = action.entries.map(text => ({ id: crypto.randomUUID(), text, kcal: null, protein: null }));
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
          const newRows = action.entries.map(e => ({ id: crypto.randomUUID(), text: typeof e === 'string' ? e : e.text, done: false }));
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
      if (type === 'activity' || type === 'workouts') {
        const { data: existing } = await supabase.from('entries').select('data')
          .eq('date', date).eq('type', 'workouts').eq('user_id', user.id).maybeSingle();
        const current = Array.isArray(existing?.data) ? existing.data : [];

        if (action.entries?.length) {
          const cleaned = current.filter(r => r.text?.trim());
          const newRows = action.entries.map(text => ({ id: crypto.randomUUID(), text, kcal: null }));
          await supabase.from('entries').upsert(
            { date, type: 'workouts', data: [...cleaned, ...newRows], user_id: user.id, updated_at: new Date().toISOString() },
            { onConflict: 'date,type,user_id' }
          );
          results.push({ type: 'workouts', count: newRows.length });
        }
        if (action.edit) {
          const updated = current.map(r =>
            r.text?.toLowerCase().includes(action.edit.find.toLowerCase())
              ? { ...r, text: action.edit.replace }
              : r
          );
          await supabase.from('entries').upsert(
            { date, type: 'workouts', data: updated, user_id: user.id, updated_at: new Date().toISOString() },
            { onConflict: 'date,type,user_id' }
          );
          results.push({ type: 'workouts', count: 1 });
        }
        if (action.delete) {
          const updated = current.filter(r => !r.text?.toLowerCase().includes(action.delete.toLowerCase()));
          await supabase.from('entries').upsert(
            { date, type: 'workouts', data: updated, user_id: user.id, updated_at: new Date().toISOString() },
            { onConflict: 'date,type,user_id' }
          );
          results.push({ type: 'workouts', count: 1 });
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