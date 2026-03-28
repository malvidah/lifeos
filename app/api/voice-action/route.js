import { withAuth } from '../_lib/auth.js';
import { refreshGoogleToken } from '../_lib/google.js';
import { isPremium } from '../_lib/tier.js';
import { rateLimit } from '../_lib/rateLimit.js';
import { textToTaskHtml, expandSlashCommands, parseProjectTags } from '@/lib/textToTaskHtml.js';

export const POST = withAuth(async (req, { supabase, user }) => {
  const { text, date, tz } = await req.json();
  if (!text?.trim() || !date) return Response.json({ error: 'text and date required' }, { status: 400 });
  if (text.length > 2000) return Response.json({ error: 'Input too long' }, { status: 400 });

  const rl = rateLimit(`voice:${user.id}`, { max: 60, windowMs: 60 * 60 * 1000 });
  if (!rl.ok) return Response.json({ error: `Too many requests. Try again in ${rl.retryAfter}s.` }, { status: 429 });

  const premium = await isPremium(supabase, user.id);
  if (!premium) return Response.json({ tier: 'free', message: 'Voice entry requires a Premium account.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ error: 'Service unavailable' }, { status: 503 });

  // Build snapshot of today's data from typed tables
  const [journalR, tasksR, mealsR, workoutsR] = await Promise.all([
    supabase.from('journal_blocks').select('content').eq('user_id', user.id).eq('date', date).order('position'),
    supabase.from('tasks').select('text, done').eq('user_id', user.id).eq('date', date).order('position'),
    supabase.from('meal_items').select('content, ai_calories').eq('user_id', user.id).eq('date', date).order('position'),
    supabase.from('workouts').select('name, sport, duration_mins').eq('user_id', user.id).eq('date', date),
  ]);

  const snapshot = [];
  const mealItems = mealsR.data ?? [];
  if (mealItems.length) {
    snapshot.push(`Current meals: ${mealItems.filter(r => r.content?.trim()).map(r => r.content).join(', ')}`);
  }
  const taskItems = tasksR.data ?? [];
  if (taskItems.length) {
    snapshot.push(`Current tasks: ${taskItems.filter(r => r.text?.trim()).map(r => r.text).join(', ')}`);
  }
  const workoutItems = workoutsR.data ?? [];
  if (workoutItems.length) {
    snapshot.push(`Current activity: ${workoutItems.map(w => w.name || w.sport || 'workout').join(', ')}`);
  }
  const journalBlocks = journalR.data ?? [];
  if (journalBlocks.length) {
    const text = journalBlocks.map(r => r.content.replace(/<[^>]+>/g, '').trim()).filter(Boolean).join(' ');
    if (text) snapshot.push(`Current notes: ${text.slice(0, 300)}`);
  }

  const contextSnippet = snapshot.length ? snapshot.join('\n') : 'No data logged yet today.';

  const systemPrompt = `You are a data entry assistant for a personal wellness dashboard. Your only job is to parse add/log/update/delete commands and write structured actions.

Respond ONLY with valid JSON — no explanation, no markdown.

If the request is clearly asking to add, log, edit, or remove data, return:
{"ok": true, "actions": [...], "summary": "Added X to Y"}

If it is a question, is vague, references unsupported sources, or you genuinely can't determine what to add, return:
{"ok": false, "message": "Short sentence explaining why (max 10 words)"}

Supported types: meals, tasks, notes, activity, calendar, goals
NOT supported: strava, oura, health metrics

Action formats:
{"type":"meals","entries":["salmon 400kcal","green salad"]}
{"type":"tasks","entries":[{"text":"call dentist","done":false}]}
{"type":"journal","append":"felt good today"}
{"type":"workouts","entries":["30 min run"]}
{"type":"goals","entries":[{"name":"Half marathon","project":"health","status":"active"}]}
{"type":"goals","edit":{"find":"half marathon","replace":{"name":"Full marathon"}}}
{"type":"goals","delete":"half marathon"}
{"type":"meals","edit":{"find":"salmon","replace":"salmon tacos"}}
{"type":"tasks","delete":"call dentist"}
{"type":"calendar","events":[{"title":"Lunch with Sarah","startTime":"12:00","endTime":"13:00","allDay":false}]}
{"type":"calendar","events":[{"title":"Team offsite","allDay":true}]}

For goals: name is required. project is optional (attach to a project). status defaults to "active" (options: active, planned, completed, archived).
When user says "add a goal" or "set a goal" or "new goal", use type "goals" — do NOT add goals as tasks.

IMPORTANT for tasks: preserve ALL user formatting tokens in the text field exactly as typed.
- Project tags like {personal}, {work}, {fitness} — keep the curly braces
- Habit markers like /h daily, /h mwf — keep the slash command
- Repeat markers like /r weekdays — keep the slash command
- Date tags like @2026-03-28 — keep the @ prefix
Do NOT strip or reformat these tokens. Pass them through verbatim in the "text" field.

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
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
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

  if (!parsed.ok) {
    return Response.json({ ok: false, message: parsed.message || "I can only add data — try 'add a meal' or 'add a task'" });
  }

  const results = [];

  for (const action of parsed.actions || []) {
    const { type } = action;

    // ── JOURNAL ──────────────────────────────────────────────────────────────
    if ((type === 'notes' || type === 'journal') && action.append) {
      const { data: last } = await supabase.from('journal_blocks').select('position')
        .eq('user_id', user.id).eq('date', date).order('position', { ascending: false }).limit(1);
      const nextPos = (last?.[0]?.position ?? -1) + 1;
      const { data: jRows } = await supabase.from('journal_blocks').insert({
        user_id: user.id, date, position: nextPos,
        content: `<p>${action.append}</p>`, project_tags: [], note_tags: [],
      }).select('id');
      results.push({ type: 'journal', count: 1, created: jRows?.map(r => r.id) || [] });
    }

    // ── MEALS ────────────────────────────────────────────────────────────────
    if (type === 'meals') {
      if (action.entries?.length) {
        const { data: last } = await supabase.from('meal_items').select('position')
          .eq('user_id', user.id).eq('date', date).order('position', { ascending: false }).limit(1);
        let nextPos = (last?.[0]?.position ?? -1) + 1;
        const { data: mRows } = await supabase.from('meal_items').insert(
          action.entries.map(text => ({ user_id: user.id, date, position: nextPos++, content: text }))
        ).select('id');
        results.push({ type: 'meals', count: action.entries.length, created: mRows?.map(r => r.id) || [] });
      }
      if (action.edit) {
        const { data: items } = await supabase.from('meal_items').select('id, content')
          .eq('user_id', user.id).eq('date', date);
        const match = items?.find(r => r.content?.toLowerCase().includes(action.edit.find.toLowerCase()));
        if (match) {
          await supabase.from('meal_items')
            .update({ content: action.edit.replace, ai_calories: null, ai_protein: null })
            .eq('id', match.id).eq('user_id', user.id);
          results.push({ type: 'meals', count: 1, edited: [{ id: match.id, prev: { content: match.content } }] });
        } else {
          results.push({ type: 'meals', count: 1 });
        }
      }
      if (action.delete) {
        const { data: items } = await supabase.from('meal_items').select('id, content, position')
          .eq('user_id', user.id).eq('date', date);
        const match = items?.find(r => r.content?.toLowerCase().includes(action.delete.toLowerCase()));
        if (match) {
          await supabase.from('meal_items').delete().eq('id', match.id).eq('user_id', user.id);
          results.push({ type: 'meals', count: 1, deleted: [{ id: match.id, prev: match }] });
        } else {
          results.push({ type: 'meals', count: 1 });
        }
      }
    }

    // ── TASKS ────────────────────────────────────────────────────────────────
    if (type === 'tasks') {
      if (action.entries?.length) {
        const { data: last } = await supabase.from('tasks').select('position')
          .eq('user_id', user.id).eq('date', date).order('position', { ascending: false }).limit(1);
        let nextPos = (last?.[0]?.position ?? -1) + 1;
        const { data: tRows } = await supabase.from('tasks').insert(action.entries.map(e => {
          const rawText = typeof e === 'string' ? e : e.text;
          const taskText = expandSlashCommands(rawText);
          return {
            user_id: user.id, date, position: nextPos++, text: taskText, done: false,
            html: textToTaskHtml(taskText, false),
            project_tags: parseProjectTags(taskText),
          };
        })).select('id');
        results.push({ type: 'tasks', count: action.entries.length, created: tRows?.map(r => r.id) || [] });
      }
      if (action.edit) {
        const { data: rows } = await supabase.from('tasks').select('id, text, done, html, project_tags')
          .eq('user_id', user.id).eq('date', date);
        const match = rows?.find(r => r.text?.toLowerCase().includes(action.edit.find.toLowerCase()));
        if (match) {
          const editText = expandSlashCommands(action.edit.replace);
          await supabase.from('tasks').update({
            text: editText,
            html: textToTaskHtml(editText, match.done),
            project_tags: parseProjectTags(editText),
          }).eq('id', match.id).eq('user_id', user.id);
          results.push({ type: 'tasks', count: 1, edited: [{ id: match.id, prev: { text: match.text, html: match.html, project_tags: match.project_tags } }] });
        } else {
          results.push({ type: 'tasks', count: 1 });
        }
      }
      if (action.delete) {
        const { data: rows } = await supabase.from('tasks').select('id, text, html, done, position, project_tags')
          .eq('user_id', user.id).eq('date', date);
        const match = rows?.find(r => r.text?.toLowerCase().includes(action.delete.toLowerCase()));
        if (match) {
          await supabase.from('tasks').delete().eq('id', match.id).eq('user_id', user.id);
          results.push({ type: 'tasks', count: 1, deleted: [{ id: match.id, prev: match }] });
        } else {
          results.push({ type: 'tasks', count: 1 });
        }
      }
    }

    // ── WORKOUTS ─────────────────────────────────────────────────────────────
    if (type === 'activity' || type === 'workouts') {
      if (action.entries?.length) {
        const { data: wRows } = await supabase.from('workouts').insert(
          action.entries.map(text => ({ user_id: user.id, date, name: text, source: 'manual' }))
        ).select('id');
        results.push({ type: 'workouts', count: action.entries.length, created: wRows?.map(r => r.id) || [] });
      }
      if (action.edit) {
        const { data: rows } = await supabase.from('workouts').select('id, name')
          .eq('user_id', user.id).eq('date', date);
        const match = rows?.find(r => r.name?.toLowerCase().includes(action.edit.find.toLowerCase()));
        if (match) {
          await supabase.from('workouts').update({ name: action.edit.replace })
            .eq('id', match.id).eq('user_id', user.id);
          results.push({ type: 'workouts', count: 1, edited: [{ id: match.id, prev: { name: match.name } }] });
        } else {
          results.push({ type: 'workouts', count: 1 });
        }
      }
      if (action.delete) {
        const { data: rows } = await supabase.from('workouts').select('id, name, source, date')
          .eq('user_id', user.id).eq('date', date);
        const match = rows?.find(r => r.name?.toLowerCase().includes(action.delete.toLowerCase()));
        if (match) {
          await supabase.from('workouts').delete().eq('id', match.id).eq('user_id', user.id);
          results.push({ type: 'workouts', count: 1, deleted: [{ id: match.id, prev: match }] });
        } else {
          results.push({ type: 'workouts', count: 1 });
        }
      }
    }

    // ── GOALS ──────────────────────────────────────────────────────────────────
    if (type === 'goals') {
      if (action.entries?.length) {
        const { data: gRows } = await supabase.from('goals').insert(
          action.entries.map(e => ({
            user_id: user.id,
            name: e.name,
            project: e.project || null,
            status: e.status || 'active',
            done: false,
          }))
        ).select('id');
        results.push({ type: 'goals', count: action.entries.length, created: gRows?.map(r => r.id) || [] });
        window?.dispatchEvent?.(new Event('daylab:goals-changed'));
      }
      if (action.edit) {
        const { data: rows } = await supabase.from('goals').select('id, name, project, status')
          .eq('user_id', user.id);
        const match = rows?.find(r => r.name?.toLowerCase().includes(action.edit.find.toLowerCase()));
        if (match) {
          const patch = {};
          if (action.edit.replace?.name) patch.name = action.edit.replace.name;
          if (action.edit.replace?.project !== undefined) patch.project = action.edit.replace.project || null;
          if (action.edit.replace?.status) patch.status = action.edit.replace.status;
          if (Object.keys(patch).length) {
            await supabase.from('goals').update(patch).eq('id', match.id).eq('user_id', user.id);
          }
          results.push({ type: 'goals', count: 1, edited: [{ id: match.id, prev: { name: match.name, project: match.project, status: match.status } }] });
        } else {
          results.push({ type: 'goals', count: 1 });
        }
      }
      if (action.delete) {
        const { data: rows } = await supabase.from('goals').select('id, name, project, status, done')
          .eq('user_id', user.id);
        const match = rows?.find(r => r.name?.toLowerCase().includes(action.delete.toLowerCase()));
        if (match) {
          await supabase.from('goals').delete().eq('id', match.id).eq('user_id', user.id);
          results.push({ type: 'goals', count: 1, deleted: [{ id: match.id, prev: match }] });
        } else {
          results.push({ type: 'goals', count: 1 });
        }
      }
    }

    // ── CALENDAR ─────────────────────────────────────────────────────────────
    if (type === 'calendar' && action.events?.length) {
      const { data: settingsRow } = await supabase.from('user_settings')
        .select('data').eq('user_id', user.id).maybeSingle();
      let accessToken = settingsRow?.data?.googleToken;
      const refreshTok = settingsRow?.data?.googleRefreshToken;
      if (refreshTok && !accessToken) accessToken = await refreshGoogleToken(refreshTok);

      const timezone = tz || 'America/Los_Angeles';
      for (const ev of action.events) {
        if (!accessToken) break;
        let eventBody;
        if (ev.allDay || !ev.startTime) {
          const next = new Date(date + 'T12:00:00');
          next.setDate(next.getDate() + 1);
          eventBody = { summary: ev.title, start: { date }, end: { date: next.toISOString().split('T')[0] } };
        } else {
          const endT = ev.endTime || (() => {
            const [h, m] = ev.startTime.split(':').map(Number);
            return `${String((h+1)%24).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
          })();
          eventBody = {
            summary: ev.title,
            start: { dateTime: `${date}T${ev.startTime}:00`, timeZone: timezone },
            end:   { dateTime: `${date}T${endT}:00`,         timeZone: timezone },
          };
        }
        let res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(eventBody),
        });
        // Retry with refreshed token on 401
        if (!res.ok && refreshTok) {
          const newToken = await refreshGoogleToken(refreshTok);
          if (newToken) {
            accessToken = newToken;
            // Persist refreshed token
            const { data: ex } = await supabase.from('user_settings').select('data')
              .eq('user_id', user.id).maybeSingle();
            await supabase.from('user_settings').upsert({
              user_id: user.id,
              data: { ...(ex?.data || {}), googleToken: newToken },
            }, { onConflict: 'user_id' });
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
});
