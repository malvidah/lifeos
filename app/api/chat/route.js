import { withAuth } from '../_lib/auth.js';
import { isPremium } from '../_lib/tier.js';
import { refreshGoogleToken } from '../_lib/google.js';
import { rateLimit } from '../_lib/rateLimit.js';

// Context-builder: fetch 7 days from typed tables in parallel
const SOURCE_PRIORITY = ['oura', 'apple', 'garmin'];

async function buildContext(supabase, userId, fromDate, toDate) {
  const [journalR, tasksR, mealsR, workoutsR, metricsR, scoresR] = await Promise.all([
    supabase.from('journal_blocks').select('date, content')
      .eq('user_id', userId).gte('date', fromDate).lte('date', toDate)
      .order('date').order('position'),
    supabase.from('tasks').select('date, text, done')
      .eq('user_id', userId).gte('date', fromDate).lte('date', toDate)
      .order('date').order('position'),
    supabase.from('meal_items').select('date, content, ai_calories, ai_protein')
      .eq('user_id', userId).gte('date', fromDate).lte('date', toDate)
      .order('date').order('position'),
    supabase.from('workouts').select('date, name, sport, duration_mins, calories, source')
      .eq('user_id', userId).gte('date', fromDate).lte('date', toDate).order('date'),
    supabase.from('health_metrics').select('date, source, hrv, rhr, sleep_hrs, sleep_eff, steps, active_min')
      .eq('user_id', userId).gte('date', fromDate).lte('date', toDate),
    supabase.from('health_scores').select('date, sleep_score, readiness_score, activity_score, recovery_score')
      .eq('user_id', userId).gte('date', fromDate).lte('date', toDate),
  ]);

  const byDate = {};
  const ensure = (d) => {
    if (!byDate[d]) byDate[d] = { journal: [], tasks: [], meals: [], workouts: [], health: null, scores: null };
  };

  for (const r of journalR.data ?? []) { ensure(r.date); byDate[r.date].journal.push(r.content); }
  for (const r of tasksR.data ?? []) { ensure(r.date); byDate[r.date].tasks.push(r); }
  for (const r of mealsR.data ?? []) {
    ensure(r.date);
    byDate[r.date].meals.push({ text: r.content, kcal: r.ai_calories, protein: r.ai_protein });
  }
  for (const r of workoutsR.data ?? []) { ensure(r.date); byDate[r.date].workouts.push(r); }

  // Best health source per date: oura > apple > garmin
  const metricsByDate = {};
  for (const r of metricsR.data ?? []) {
    const cur = metricsByDate[r.date];
    if (!cur || SOURCE_PRIORITY.indexOf(r.source) < SOURCE_PRIORITY.indexOf(cur.source)) {
      metricsByDate[r.date] = r;
    }
  }
  for (const [d, m] of Object.entries(metricsByDate)) { ensure(d); byDate[d].health = m; }
  for (const r of scoresR.data ?? []) { ensure(r.date); byDate[r.date].scores = r; }

  return byDate;
}

function formatDay(d, data, todayDate) {
  const isToday = d === todayDate;
  const tag = isToday ? `[TODAY ${d}]` : `[${d}]`;
  const lines = [];
  const h = data.health;
  const s = data.scores;

  if (h || s) {
    const parts = [];
    if (h?.sleep_hrs  != null) parts.push(`${h.sleep_hrs}h sleep`);
    if (s?.sleep_score)        parts.push(`sleep score ${s.sleep_score}`);
    if (h?.sleep_eff  != null) parts.push(`${h.sleep_eff}% efficiency`);
    if (s?.readiness_score)    parts.push(`readiness ${s.readiness_score}`);
    if (h?.hrv != null)        parts.push(`HRV ${h.hrv}ms`);
    if (h?.rhr != null)        parts.push(`RHR ${h.rhr}bpm`);
    if (h?.steps != null)      parts.push(`${h.steps} steps`);
    if (parts.length) lines.push(`${tag} health: ${parts.join(', ')}`);
    else if (isToday) lines.push(`${tag} health: no data synced for today`);
  } else if (isToday) {
    lines.push(`${tag} health: no data synced for today`);
  }

  if (data.meals?.length) {
    const texts = data.meals
      .filter(r => r.text?.trim())
      .map(r => r.kcal ? `${r.text} (${r.kcal}kcal${r.protein ? `, ${r.protein}g protein` : ''})` : r.text);
    if (texts.length) lines.push(`${tag} meals: ${texts.join(', ')}`);
  }

  if (data.workouts?.length) {
    const texts = data.workouts.map(w => {
      const p = [w.name || w.sport].filter(Boolean);
      if (w.duration_mins) p.push(`${w.duration_mins}min`);
      if (w.calories)      p.push(`${w.calories}kcal`);
      return p.join(' ') || 'workout';
    });
    lines.push(`${tag} activity: ${texts.join(', ')}`);
  }

  if (data.tasks?.length) {
    const texts = data.tasks.filter(r => r.text?.trim()).map(r => `${r.done ? '✓' : '○'} ${r.text}`);
    if (texts.length) lines.push(`${tag} tasks: ${texts.join(', ')}`);
  }

  if (data.journal?.length) {
    const text = data.journal
      .map(c => c.replace(/<[^>]+>/g, '').trim()).filter(Boolean).join(' ').slice(0, 300);
    if (text) lines.push(`${tag} notes: ${text}`);
  }

  if (!lines.length) {
    if (isToday) lines.push(`${tag} (no data logged)`);
    else return null;
  }
  return lines.join('\n');
}

export const POST = withAuth(async (req, { supabase, user }) => {
  // Rate limit: 80 messages per user per hour
  const rl = rateLimit(`chat:${user.id}`, { max: 80, windowMs: 60 * 60 * 1000 });
  if (!rl.ok) return Response.json({ error: `Rate limited. Retry in ${rl.retryAfter}s.` }, { status: 429 });

  const isPrem = await isPremium(supabase, user.id);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ error: 'Service unavailable' }, { status: 503 });

  const { messages, date, tz } = await req.json();
  if (!messages?.length || !date) return Response.json({ error: 'messages and date required' }, { status: 400 });

  // Build context: today + last 6 days
  const fromDate = (() => { const d = new Date(date); d.setDate(d.getDate() - 6); return d.toISOString().split('T')[0]; })();
  const byDate = await buildContext(supabase, user.id, fromDate, date);

  if (!byDate[date]) byDate[date] = { journal: [], tasks: [], meals: [], workouts: [], health: null, scores: null };

  const contextParts = Object.keys(byDate).sort().map(d => formatDay(d, byDate[d], date)).filter(Boolean);
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
- Add note: {"type":"journal","append":"text to append"}
- Add activity: {"type":"workouts","entries":["30 min run"]}
- Edit meal: {"type":"meals","edit":{"find":"salmon","replace":"salmon tacos"}}
- Delete: {"type":"tasks","delete":"call dentist"} or {"type":"meals","delete":"text"}
- Complete task: {"type":"tasks","complete":"task text"}
- Calendar event: {"type":"calendar","events":[{"title":"Lunch","startTime":"12:00","endTime":"13:00","allDay":false}]}

You can combine a reply and an actions block in the same response. Default calendar event duration is 1hr if no end time given.`;

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: systemPrompt,
      messages: messages.slice(-12),
    }),
  });

  const aiData = await aiRes.json();
  if (aiData.error) return Response.json({ error: aiData.error?.message || 'AI error' }, { status: 500 });

  const rawReply = aiData.content?.find(b => b.type === 'text')?.text || '';
  const actionsMatch = rawReply.match(/```actions\s*([\s\S]*?)```/);
  let executedActions = [];
  let summary = null;
  const cleanReply = rawReply.replace(/```actions[\s\S]*?```/g, '').trim();

  if (actionsMatch) {
    try {
      const parsed = JSON.parse(actionsMatch[1].trim());
      summary = parsed.summary || null;

      for (const action of parsed.actions || []) {
        const { type } = action;

        // ── JOURNAL ────────────────────────────────────────────────────────────
        if ((type === 'notes' || type === 'journal') && action.append) {
          const { data: last } = await supabase.from('journal_blocks')
            .select('position').eq('user_id', user.id).eq('date', date)
            .order('position', { ascending: false }).limit(1);
          const nextPos = (last?.[0]?.position ?? -1) + 1;
          await supabase.from('journal_blocks').insert({
            user_id: user.id, date, position: nextPos,
            content: `<p>${action.append}</p>`, project_tags: [], note_tags: [],
          });
          executedActions.push({ type: 'journal' });
        }

        // ── MEALS ──────────────────────────────────────────────────────────────
        if (type === 'meals') {
          if (action.entries?.length) {
            const { data: last } = await supabase.from('meal_items')
              .select('position').eq('user_id', user.id).eq('date', date)
              .order('position', { ascending: false }).limit(1);
            let nextPos = (last?.[0]?.position ?? -1) + 1;
            await supabase.from('meal_items').insert(
              action.entries.map(text => ({ user_id: user.id, date, position: nextPos++, content: text }))
            );
            executedActions.push({ type: 'meals', count: action.entries.length });
          }
          if (action.edit) {
            const { data: items } = await supabase.from('meal_items')
              .select('id, content').eq('user_id', user.id).eq('date', date);
            const match = items?.find(r => r.content?.toLowerCase().includes(action.edit.find.toLowerCase()));
            if (match) await supabase.from('meal_items')
              .update({ content: action.edit.replace, ai_calories: null, ai_protein: null })
              .eq('id', match.id).eq('user_id', user.id);
            executedActions.push({ type: 'meals', edit: true });
          }
          if (action.delete) {
            const { data: items } = await supabase.from('meal_items')
              .select('id, content').eq('user_id', user.id).eq('date', date);
            const match = items?.find(r => r.content?.toLowerCase().includes(action.delete.toLowerCase()));
            if (match) await supabase.from('meal_items').delete().eq('id', match.id).eq('user_id', user.id);
            executedActions.push({ type: 'meals', delete: true });
          }
        }

        // ── TASKS ──────────────────────────────────────────────────────────────
        if (type === 'tasks') {
          if (action.entries?.length) {
            const { data: last } = await supabase.from('tasks')
              .select('position').eq('user_id', user.id).eq('date', date)
              .order('position', { ascending: false }).limit(1);
            let nextPos = (last?.[0]?.position ?? -1) + 1;
            await supabase.from('tasks').insert(action.entries.map(e => {
              const text = typeof e === 'string' ? e : e.text;
              const done = e.done ?? false;
              return {
                user_id: user.id, date, position: nextPos++, text, done,
                html: `<li data-type="taskItem" data-checked="${done}"><p>${text}</p></li>`,
              };
            }));
            executedActions.push({ type: 'tasks', count: action.entries.length });
          }
          if (action.complete) {
            const { data: rows } = await supabase.from('tasks').select('id, text')
              .eq('user_id', user.id).eq('date', date).eq('done', false);
            const match = rows?.find(r => r.text?.toLowerCase().includes(action.complete.toLowerCase()));
            if (match) await supabase.from('tasks')
              .update({ done: true, completed_at: date })
              .eq('id', match.id).eq('user_id', user.id);
            executedActions.push({ type: 'tasks', complete: true });
          }
          if (action.edit) {
            const { data: rows } = await supabase.from('tasks').select('id, text, done')
              .eq('user_id', user.id).eq('date', date);
            const match = rows?.find(r => r.text?.toLowerCase().includes(action.edit.find.toLowerCase()));
            if (match) await supabase.from('tasks').update({
              text: action.edit.replace,
              html: `<li data-type="taskItem" data-checked="${match.done}"><p>${action.edit.replace}</p></li>`,
            }).eq('id', match.id).eq('user_id', user.id);
            executedActions.push({ type: 'tasks', edit: true });
          }
          if (action.delete) {
            const { data: rows } = await supabase.from('tasks').select('id, text')
              .eq('user_id', user.id).eq('date', date);
            const match = rows?.find(r => r.text?.toLowerCase().includes(action.delete.toLowerCase()));
            if (match) await supabase.from('tasks').delete().eq('id', match.id).eq('user_id', user.id);
            executedActions.push({ type: 'tasks', delete: true });
          }
        }

        // ── WORKOUTS ───────────────────────────────────────────────────────────
        if (type === 'activity' || type === 'workouts') {
          if (action.entries?.length) {
            await supabase.from('workouts').insert(
              action.entries.map(text => ({ user_id: user.id, date, name: text, source: 'manual' }))
            );
            executedActions.push({ type: 'workouts', count: action.entries.length });
          }
        }

        // ── CALENDAR ───────────────────────────────────────────────────────────
        if (type === 'calendar' && action.events?.length) {
          const { data: settings } = await supabase.from('user_settings')
            .select('data').eq('user_id', user.id).maybeSingle();
          let accessToken = settings?.data?.googleToken;
          const refreshTok = settings?.data?.googleRefreshToken;
          if (!accessToken && refreshTok) accessToken = await refreshGoogleToken(refreshTok);
          if (!accessToken) { executedActions.push({ type: 'calendar', error: 'no token' }); continue; }

          const timezone = tz || 'America/Los_Angeles';
          for (const ev of action.events) {
            let eventBody;
            if (ev.allDay || !ev.startTime) {
              const next = new Date(date + 'T12:00:00');
              next.setDate(next.getDate() + 1);
              eventBody = { summary: ev.title, start: { date }, end: { date: next.toISOString().split('T')[0] } };
            } else {
              const endT = ev.endTime || (() => {
                const [h, m] = ev.startTime.split(':').map(Number);
                return `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
              })();
              eventBody = {
                summary: ev.title,
                start: { dateTime: `${date}T${ev.startTime}:00`, timeZone: timezone },
                end:   { dateTime: `${date}T${endT}:00`,         timeZone: timezone },
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
    } catch {
      // Actions parse failed — still return the text reply
    }
  }

  const refreshTypes = [...new Set(executedActions.map(a => a.type))];
  return Response.json({ reply: cleanReply, actions: executedActions, refreshTypes, summary, isPremium: isPrem });
});
