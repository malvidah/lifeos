import { createClient } from '@supabase/supabase-js';
import { isPremium, ANTHROPIC_KEY } from '../_lib/tier.js';
import { rateLimit } from '../_lib/rateLimit.js';

const CACHE_VERSION = 8;
const DAY_NAMES     = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function getUserClient(req) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '').trim();
  if (!token) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function dateOffset(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// Serialize one day's entries into a compact readable line
function formatDay(date, entries) {
  const parts = [];
  const h = entries.health;

  if (h) {
    const scores = [
      h.sleepScore      && `sleep ${h.sleepScore}${h.sleepHrs ? ` (${h.sleepHrs}h ${h.sleepEff}% eff)` : ''}`,
      h.readinessScore  && `readiness ${h.readinessScore}`,
      h.hrv             && `HRV ${h.hrv}ms`,
      h.rhr             && `RHR ${h.rhr}bpm`,
      h.activityScore   && `activity ${h.activityScore}`,
      h.resilienceScore && `recovery ${h.resilienceScore}`,
    ].filter(Boolean);
    if (scores.length) parts.push(scores.join(', '));
  }

  const workouts = [
    ...(Array.isArray(entries.workouts) ? entries.workouts.map(w =>
      [w.name || w.sport, w.durationMins && `${w.durationMins}min`,
       w.distance && `${(w.distance * 0.621371).toFixed(1)}mi`,
       w.avgHr && `${w.avgHr}bpm`].filter(Boolean).join(' ')
    ) : []),
    ...(Array.isArray(entries.activity)
      ? entries.activity.filter(r => r.text?.trim()).map(r => r.text) : []),
  ];
  if (workouts.length) parts.push(`workout: ${workouts.join(', ')}`);

  if (entries.meals?.length) {
    const ms = entries.meals.filter(r => r.text?.trim())
      .map(r => r.text + (r.kcal ? ` (${r.kcal}kcal)` : ''));
    if (ms.length) parts.push(`meals: ${ms.join(', ')}`);
  }

  if (entries.tasks?.length) {
    const done = entries.tasks.filter(r => r.done  && r.text?.trim()).map(r => r.text);
    const todo = entries.tasks.filter(r => !r.done && r.text?.trim()).map(r => r.text);
    if (done.length) parts.push(`done: ${done.join(', ')}`);
    if (todo.length) parts.push(`todo: ${todo.join(', ')}`);
  }

  if (entries.notes) {
    const n = typeof entries.notes === 'string' ? entries.notes.trim() : '';
    if (n) parts.push(`notes: "${n.slice(0, 250)}${n.length > 250 ? '…' : ''}"`);
  }

  return parts.length ? parts.join(' | ') : null;
}

export async function POST(request) {
  try {
    const supabase = getUserClient(request);
    if (!supabase) return Response.json({ error: 'unauthorized' }, { status: 401 });
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

    const { date, healthKey } = await request.json();
    if (!date) return Response.json({ error: 'date required' }, { status: 400 });

    const rl = rateLimit(`insights:${user.id}`, { max: 30, windowMs: 60 * 60 * 1000 });
    if (!rl.ok) return Response.json({ error: `Rate limited. Retry in ${rl.retryAfter}s.` }, { status: 429 });

    const apiKey = ANTHROPIC_KEY();
    if (!apiKey) return Response.json({ error: 'Service unavailable' }, { status: 503 });

    // ── Fetch ───────────────────────────────────────────────────────────────

    const { data: todayRows } = await supabase.from('entries')
      .select('type, data').eq('date', date).eq('user_id', user.id);
    const today = {};
    for (const row of todayRows || []) today[row.type] = row.data;

    // Client already has Oura scores before they save to DB — use them
    if (!today.health && healthKey) {
      const [, sleep, readiness] = healthKey.split(':');
      if (+sleep > 0 || +readiness > 0)
        today.health = { sleepScore: +sleep || '', readinessScore: +readiness || '' };
    }

    const recentDays = [];
    for (let i = 1; i <= 7; i++) {
      const d = dateOffset(date, -i);
      const { data: rows } = await supabase.from('entries')
        .select('type, data').eq('date', d).eq('user_id', user.id);
      if (!rows?.length) continue;
      const day = { date: d };
      for (const row of rows) day[row.type] = row.data;
      recentDays.push(day);
    }

    const lastYearDays = [];
    for (const d of [dateOffset(date, -366), dateOffset(date, -365), dateOffset(date, -364)]) {
      const { data: rows } = await supabase.from('entries')
        .select('type, data').eq('date', d).eq('user_id', user.id);
      if (!rows?.length) continue;
      const day = { date: d };
      for (const row of rows) day[row.type] = row.data;
      lastYearDays.push(day);
    }

    // ── Build context ───────────────────────────────────────────────────────

    const dObj = new Date(date + 'T12:00:00');
    const lines = [`${DAY_NAMES[dObj.getDay()]} ${date}`];

    const todayLine = formatDay(date, today);
    if (todayLine) lines.push(`Today: ${todayLine}`);

    // Explicitly flag missing health/sleep data so AI doesn't infer from previous days
    const hasTodayHealth = !!(today.health && (today.health.sleepScore || today.health.sleepHrs || today.health.readinessScore));
    if (!hasTodayHealth) {
      lines.push(`Today: no Oura data for last night (ring not worn or not yet synced) — do not infer or assume last night's sleep from previous nights`);
    }

    if (recentDays.length) {
      lines.push('');
      for (const day of recentDays) {
        const line = formatDay(day.date, day);
        if (line) lines.push(`${DAY_NAMES[new Date(day.date + 'T12:00:00').getDay()]} ${day.date}: ${line}`);
      }
    }

    if (lastYearDays.length) {
      lines.push('');
      for (const day of lastYearDays) {
        const line = formatDay(day.date, day);
        if (line) lines.push(`Last year ${day.date}: ${line}`);
      }
    }

    const context = lines.join('\n');

    // First-time user — nothing to say yet
    if (lines.length === 1) {
      const name = user.user_metadata?.name?.split(' ')[0] || 'there';
      const welcome = `Welcome to Day Loop, ${name}. Connect your Oura ring and start logging notes, meals, and tasks — the insights get sharper the more context you give them.`;
      await supabase.from('entries').upsert(
        { date, type: 'insights', data: { text: welcome, generatedAt: new Date().toISOString(), isWelcome: true }, user_id: user.id, updated_at: new Date().toISOString() },
        { onConflict: 'date,type,user_id' }
      );
      return Response.json({ insight: welcome });
    }

    // ── Generate ────────────────────────────────────────────────────────────

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 160,
        system: `You are a perceptive friend reading someone's daily log. Say the one thing most worth saying — it might be a health pattern, something from their notes, a connection between their body and what they've been doing, or just a small thing you noticed. Use everything: scores, workouts, meals, notes, tasks, last year. If today is light on data, speak to the week's shape. CRITICAL: sleep data is labeled by day — only reference "last night" sleep if today's entry explicitly contains sleep data. If today has no Oura/sleep data, acknowledge that and speak to trends or other data instead — never assume last night's sleep matches a previous night. 2 sentences max. No markdown, no "Your [metric]" openers.`,
        messages: [{ role: 'user', content: context }],
      }),
    });

    const aiData = await res.json();
    if (aiData.error) return Response.json({ error: `AI error: ${aiData.error.message}` }, { status: 500 });

    const insight = (aiData.content?.find(b => b.type === 'text')?.text || '')
      .replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/^#{1,3}\s+/gm, '').trim();

    await supabase.from('entries').upsert(
      { date, type: 'insights', data: { text: insight, generatedAt: new Date().toISOString(), v: CACHE_VERSION, healthKey: healthKey || '' }, user_id: user.id, updated_at: new Date().toISOString() },
      { onConflict: 'date,type,user_id' }
    );

    return Response.json({ insight });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
