import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '../_lib/rateLimit.js';

function getUserClient(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return { supabase: null, token: null };
  return {
    token,
    supabase: createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    ),
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
  const d = await r.json();
  return (!r.ok || !d.access_token) ? null : d.access_token;
}

export async function POST(request) {
  try {
    const { supabase, token } = getUserClient(request);
    if (!supabase) return Response.json({ error: 'unauthorized' }, { status: 401 });

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

    // Rate limit: 80 messages per user per hour
    const rl = rateLimit(`chat:${user.id}`, { max: 80, windowMs: 60 * 60 * 1000 });
    if (!rl.ok) return Response.json({ error: `Rate limited. Retry in ${rl.retryAfter}s.` }, { status: 429 });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return Response.json({ error: 'Service unavailable' }, { status: 503 });

    const { messages, date, tz } = await request.json();
    if (!messages?.length || !date) return Response.json({ error: 'messages and date required' }, { status: 400 });

    // Build today's data context
    const { data: todayEntries } = await supabase.from('entries')
      .select('type, data').eq('date', date).eq('user_id', user.id);
    const today = {};
    for (const row of todayEntries || []) today[row.type] = row.data;

    const snapshot = [];
    if (today.health) {
      const h = today.health;
      const parts = [];
      if (h.sleep_score) parts.push(`sleep score ${h.sleep_score}`);
      if (h.sleep_hours) parts.push(`${h.sleep_hours}h sleep`);
      if (h.sleep_efficiency) parts.push(`${h.sleep_efficiency}% efficiency`);
      if (h.readiness_score) parts.push(`readiness ${h.readiness_score}`);
      if (h.hrv) parts.push(`HRV ${h.hrv}ms`);
      if (h.rhr) parts.push(`RHR ${h.rhr}bpm`);
      if (parts.length) snapshot.push(`Health: ${parts.join(', ')}`);
    }
    if (today.meals?.length) {
      const mealTexts = today.meals.filter(r => r.text?.trim()).map(r => {
        let s = r.text;
        if (r.kcal) s += ` (${r.kcal}kcal`;
        if (r.protein) s += `, ${r.protein}g protein`;
        if (r.kcal || r.protein) s += ')';
        return s;
      });
      if (mealTexts.length) snapshot.push(`Meals: ${mealTexts.join(', ')}`);
    }
    if (today.tasks?.length) {
      const taskTexts = today.tasks.filter(r => r.text?.trim()).map(r => `${r.done ? '✓' : '○'} ${r.text}`);
      if (taskTexts.length) snapshot.push(`Tasks: ${taskTexts.join(', ')}`);
    }
    if (today.activity?.length) {
      const actTexts = today.activity.filter(r => r.text?.trim()).map(r => {
        let s = r.text;
        if (r.kcal) s += ` (${r.kcal}kcal)`;
        return s;
      });
      if (actTexts.length) snapshot.push(`Activity: ${actTexts.join(', ')}`);
    }
    if (today.notes) snapshot.push(`Notes: ${String(today.notes).slice(0, 400)}`);

    const contextBlock = snapshot.length ? snapshot.join('\n') : 'No data logged yet today.';

    const systemPrompt = `You are a personal wellness assistant inside Day Lab, a health and productivity tracking app.

Today is ${date}. The user's data for today:
${contextBlock}

You can both ANSWER QUESTIONS conversationally and ADD/EDIT/DELETE entries.

When the user asks a question or wants insights, respond naturally and helpfully. Reference their actual data when relevant.

When the user wants to add/edit/delete data, respond with a JSON block in this exact format embedded in your reply:

\`\`\`actions
{"actions":[...], "summary":"Brief confirmation"}
\`\`\`

Action formats:
- Add meals: {"type":"meals","entries":["salmon 400kcal","green salad"]}
- Add tasks: {"type":"tasks","entries":[{"text":"call dentist","done":false}]}
- Add note: {"type":"notes","append":"felt good today"}
- Add activity: {"type":"activity","entries":["30 min run"]}
- Edit meal: {"type":"meals","edit":{"find":"salmon","replace":"salmon tacos"}}
- Delete task: {"type":"tasks","delete":"call dentist"}
- Add calendar event: {"type":"calendar","events":[{"title":"Lunch","startTime":"12:00","endTime":"13:00","allDay":false}]}
- Complete task: {"type":"tasks","complete":"call dentist"}

You can combine a conversational reply AND an actions block in the same response.
Example: "Added breakfast for you! That puts you at about 650 calories so far today.\n\`\`\`actions\n{"actions":[{"type":"meals","entries":["oatmeal 320kcal","banana 90kcal"]}],"summary":"Added breakfast"}\n\`\`\`"

Keep replies concise and warm. Don't be overly formal. You know their health data — use it.
For calendar events: parse natural language times, default 1hr duration if no end time given.`;

    // Clamp message history to last 12 turns to control token usage
    const trimmed = messages.slice(-12);

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
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
        messages: trimmed,
      }),
    });

    const aiData = await aiRes.json();
    if (aiData.error) return Response.json({ error: aiData.error?.message || 'AI error' }, { status: 500 });

    const rawReply = aiData.content?.find(b => b.type === 'text')?.text || '';

    // Extract and execute any actions block
    const actionsMatch = rawReply.match(/```actions\s*([\s\S]*?)```/);
    let executedActions = [];
    let summary = null;
    let cleanReply = rawReply.replace(/```actions[\s\S]*?```/g, '').trim();

    if (actionsMatch) {
      try {
        const parsed = JSON.parse(actionsMatch[1].trim());
        summary = parsed.summary || null;
        const actions = parsed.actions || [];

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
            executedActions.push({ type: 'notes' });
          }

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
              executedActions.push({ type: 'meals', count: newRows.length });
            }
            if (action.edit) {
              const updated = current.map(r =>
                r.text?.toLowerCase().includes(action.edit.find.toLowerCase())
                  ? { ...r, text: action.edit.replace, kcal: null, protein: null } : r
              );
              await supabase.from('entries').upsert(
                { date, type: 'meals', data: updated, user_id: user.id, updated_at: new Date().toISOString() },
                { onConflict: 'date,type,user_id' }
              );
              executedActions.push({ type: 'meals', edit: true });
            }
            if (action.delete) {
              const updated = current.filter(r => !r.text?.toLowerCase().includes(action.delete.toLowerCase()));
              await supabase.from('entries').upsert(
                { date, type: 'meals', data: updated, user_id: user.id, updated_at: new Date().toISOString() },
                { onConflict: 'date,type,user_id' }
              );
              executedActions.push({ type: 'meals', delete: true });
            }
          }

          if (type === 'tasks') {
            const { data: existing } = await supabase.from('entries').select('data')
              .eq('date', date).eq('type', 'tasks').eq('user_id', user.id).maybeSingle();
            const current = Array.isArray(existing?.data) ? existing.data : [];
            if (action.entries?.length) {
              const cleaned = current.filter(r => r.text?.trim());
              const newRows = action.entries.map(e => ({ id: Date.now() + Math.random(), text: typeof e === 'string' ? e : e.text, done: e.done ?? false }));
              await supabase.from('entries').upsert(
                { date, type: 'tasks', data: [...cleaned, ...newRows], user_id: user.id, updated_at: new Date().toISOString() },
                { onConflict: 'date,type,user_id' }
              );
              executedActions.push({ type: 'tasks', count: newRows.length });
            }
            if (action.complete) {
              const updated = current.map(r =>
                r.text?.toLowerCase().includes(action.complete.toLowerCase()) ? { ...r, done: true } : r
              );
              await supabase.from('entries').upsert(
                { date, type: 'tasks', data: updated, user_id: user.id, updated_at: new Date().toISOString() },
                { onConflict: 'date,type,user_id' }
              );
              executedActions.push({ type: 'tasks', complete: true });
            }
            if (action.edit) {
              const updated = current.map(r =>
                r.text?.toLowerCase().includes(action.edit.find.toLowerCase())
                  ? { ...r, text: action.edit.replace } : r
              );
              await supabase.from('entries').upsert(
                { date, type: 'tasks', data: updated, user_id: user.id, updated_at: new Date().toISOString() },
                { onConflict: 'date,type,user_id' }
              );
              executedActions.push({ type: 'tasks', edit: true });
            }
            if (action.delete) {
              const updated = current.filter(r => !r.text?.toLowerCase().includes(action.delete.toLowerCase()));
              await supabase.from('entries').upsert(
                { date, type: 'tasks', data: updated, user_id: user.id, updated_at: new Date().toISOString() },
                { onConflict: 'date,type,user_id' }
              );
              executedActions.push({ type: 'tasks', delete: true });
            }
          }

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
              executedActions.push({ type: 'activity', count: newRows.length });
            }
          }

          if (type === 'calendar' && action.events?.length) {
            const { data: stored } = await supabase.from('entries').select('data')
              .eq('date', '0000-00-00').eq('type', 'google_token').eq('user_id', user.id).maybeSingle();
            let accessToken = stored?.data?.token;
            const refreshTok = stored?.data?.refreshToken;
            if (!accessToken && refreshTok) accessToken = await refreshGoogleToken(refreshTok);
            if (!accessToken) { executedActions.push({ type: 'calendar', error: 'no token' }); continue; }

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
              const calRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
                method: 'POST',
                headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(eventBody),
              });
              executedActions.push({ type: 'calendar', title: ev.title, ok: calRes.ok });
            }
          }
        }
      } catch (e) {
        // Actions parse failed — still return the text reply
      }
    }

    // Types that had changes — so the client can refresh them
    const refreshTypes = [...new Set(executedActions.map(a => a.type))];

    return Response.json({ reply: cleanReply, actions: executedActions, refreshTypes, summary });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
