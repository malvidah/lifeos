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

    // Check premium status
    const { data: premRow } = await supabase.from('entries').select('data')
      .eq('type', 'premium').eq('date', 'global').eq('user_id', user.id).maybeSingle();
    const isPremium = premRow?.data?.active === true;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return Response.json({ error: 'Service unavailable' }, { status: 503 });

    const { messages, date, tz } = await request.json();
    if (!messages?.length || !date) return Response.json({ error: 'messages and date required' }, { status: 400 });

    // Build data context: today + last 6 days for trends
    const startDate = new Date(date);
    startDate.setDate(startDate.getDate() - 6);
    const fromDate = startDate.toISOString().split('T')[0];

    const { data: allEntries } = await supabase.from('entries')
      .select('date, type, data')
      .eq('user_id', user.id)
      .gte('date', fromDate)
      .lte('date', date)
      .not('type', 'in', '("google_token","premium","settings")');

    // Group by date
    const byDate = {};
    for (const row of allEntries || []) {
      if (!byDate[row.date]) byDate[row.date] = {};
      byDate[row.date][row.type] = row.data;
    }

    const formatDay = (d, data) => {
      const isToday = d === date;
      const tag = isToday ? `[TODAY ${d}]` : `[${d}]`;
      const lines = [];

      if (data.health) {
        const h = data.health;
        const parts = [];
        if (h.sleep_hours != null) parts.push(`${h.sleep_hours}h sleep`);
        if (h.sleep_score) parts.push(`sleep score ${h.sleep_score}`);
        if (h.sleep_efficiency) parts.push(`${h.sleep_efficiency}% efficiency`);
        if (h.readiness_score) parts.push(`readiness ${h.readiness_score}`);
        if (h.hrv) parts.push(`HRV ${h.hrv}ms`);
        if (h.rhr) parts.push(`RHR ${h.rhr}bpm`);
        if (h.steps) parts.push(`${h.steps} steps`);
        if (parts.length) lines.push(`${tag} health: ${parts.join(', ')}`);
        else if (isToday) lines.push(`${tag} health: no data synced for today`);
      } else if (isToday) {
        lines.push(`${tag} health: no data synced for today`);
      }

      if (data.meals?.length) {
        const texts = data.meals.filter(r => r.text?.trim()).map(r => {
          let s = r.text;
          if (r.kcal) s += ` (${r.kcal}kcal${r.protein ? `, ${r.protein}g protein` : ''})`;
          return s;
        });
        if (texts.length) lines.push(`${tag} meals: ${texts.join(', ')}`);
      }
      if (data.activity?.length) {
        const texts = data.activity.filter(r => r.text?.trim()).map(r =>
          r.kcal ? `${r.text} (${r.kcal}kcal)` : r.text
        );
        if (texts.length) lines.push(`${tag} activity: ${texts.join(', ')}`);
      }
      if (data.tasks?.length) {
        const texts = data.tasks.filter(r => r.text?.trim()).map(r => `${r.done ? '✓' : '○'} ${r.text}`);
        if (texts.length) lines.push(`${tag} tasks: ${texts.join(', ')}`);
      }
      if (data.notes) lines.push(`${tag} notes: ${String(data.notes).slice(0, 300)}`);

      if (!lines.length) {
        if (isToday) lines.push(`${tag} (no data logged)`);
        else return null;
      }
      return lines.join('\n');
    };

    // Always include today even if no DB entry
    if (!byDate[date]) byDate[date] = {};

    const sortedDates = Object.keys(byDate).sort();
    const contextParts = sortedDates.map(d => formatDay(d, byDate[d])).filter(Boolean);
    const contextBlock = contextParts.length ? contextParts.join('\n\n') : 'No data logged yet.';

    const systemPrompt = `You are the AI inside Day Lab — a personal wellness and productivity tracker. You have access to the user's real data.

Today is ${date} (user timezone: ${tz || 'unknown'}).

User data — last 7 days:
${contextBlock}

Your voice: curious, open, thoughtful, empathetic. Never sycophantic, never preachy. Prioritize insight over information — cut through the noise rather than listing everything back at them. Short is almost always better. If something is genuinely interesting or worth flagging in their data, name it plainly.

IMPORTANT: If today's health shows "no data synced for today", do NOT assume or infer today's sleep/readiness from prior days. Acknowledge the gap honestly and comment only on what's actually present.

You can ANSWER QUESTIONS and ADD/EDIT/DELETE entries.

When adding data, embed an actions block in your reply:

\`\`\`actions
{"actions":[...], "summary":"Brief confirmation"}
\`\`\`

Action formats:
- Add meals: {"type":"meals","entries":["salmon 400kcal","green salad"]}
- Add tasks: {"type":"tasks","entries":[{"text":"call dentist","done":false}]}
- Add note: {"type":"notes","append":"text to append"}
- Add activity: {"type":"activity","entries":["30 min run"]}
- Edit meal: {"type":"meals","edit":{"find":"salmon","replace":"salmon tacos"}}
- Delete: {"type":"tasks","delete":"call dentist"} or {"type":"meals","delete":"text"}
- Complete task: {"type":"tasks","complete":"task text"}
- Calendar event: {"type":"calendar","events":[{"title":"Lunch","startTime":"12:00","endTime":"13:00","allDay":false}]}

You can combine a reply and an actions block in the same response. Default calendar event duration is 1hr if no end time given.`;

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

    return Response.json({ reply: cleanReply, actions: executedActions, refreshTypes, summary, isPremium });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
