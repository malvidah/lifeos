import { createClient } from '@supabase/supabase-js';
import { isPremium, ANTHROPIC_KEY } from '../_lib/tier.js';
import { rateLimit } from '../_lib/rateLimit.js';

const CACHE_VERSION = 8;
const FREE_LIMIT    = 10;   // free users get this many total insight generations
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

function formatDay(date, entries) {
  const parts = [];
  const h = entries.health;
  const s = entries.scores;

  if (h || s) {
    const scores = [
      s?.sleepScore     && `sleep score ${s.sleepScore}${h?.sleepHrs ? ` (${h.sleepHrs}h${h.sleepEff ? ` ${h.sleepEff}% eff` : ''})` : ''}`,
      s?.readinessScore && `readiness ${s.readinessScore}`,
      h?.hrv            && `HRV ${h.hrv}ms`,
      h?.rhr            && `RHR ${h.rhr}bpm`,
      s?.activityScore  && `activity ${s.activityScore}${h?.steps ? ` (${Number(h.steps).toLocaleString()} steps)` : ''}`,
      s?.recoveryScore  && `recovery ${s.recoveryScore}`,
      !s && h?.sleepScore     && `sleep ${h.sleepScore}${h.sleepHrs ? ` (${h.sleepHrs}h)` : ''}`,
      !s && h?.readinessScore && `readiness ${h.readinessScore}`,
      !s && h?.activityScore  && `activity ${h.activityScore}`,
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

async function getInsightCount(supabase, userId) {
  const { data } = await supabase.from('entries').select('data')
    .eq('type', 'insight_usage').eq('date', 'global').eq('user_id', userId).maybeSingle();
  return data?.data?.count || 0;
}

async function incrementInsightCount(supabase, userId) {
  const count = await getInsightCount(supabase, userId);
  await supabase.from('entries').upsert(
    { date: 'global', type: 'insight_usage', data: { count: count + 1, updatedAt: new Date().toISOString() }, user_id: userId, updated_at: new Date().toISOString() },
    { onConflict: 'date,type,user_id' }
  );
  return count + 1;
}

export async function POST(request) {
  try {
    const supabase = getUserClient(request);
    if (!supabase) return Response.json({ error: 'unauthorized' }, { status: 401 });
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

    const { date, healthKey } = await request.json();
    if (!date) return Response.json({ error: 'date required' }, { status: 400 });

    // ── Cache check (free AND premium — no AI call if cache is fresh) ─────────
    const { data: cached } = await supabase.from('entries')
      .select('data, updated_at').eq('type', 'insights').eq('date', date)
      .eq('user_id', user.id).maybeSingle();
    if (cached?.data?.insight) {
      const age = Date.now() - new Date(cached.updated_at).getTime();
      if (age < 24 * 60 * 60 * 1000) {
        return Response.json({ insight: cached.data.insight, cached: true });
      }
    }

    // ── Tier check — only for NEW generations ─────────────────────────────────
    const premium = await isPremium(supabase, user.id);
    if (!premium) {
      const usageCount = await getInsightCount(supabase, user.id);
      if (usageCount >= FREE_LIMIT) {
        return Response.json({ tier: 'free', usageCount, limit: FREE_LIMIT });
      }
    }

    const rl = rateLimit(`insights:${user.id}`, { max: 100, windowMs: 60 * 60 * 1000 });
    if (!rl.ok) return Response.json({ error: `Rate limited. Retry in ${rl.retryAfter}s.` }, { status: 429 });

    const apiKey = ANTHROPIC_KEY();
    if (!apiKey) return Response.json({ error: 'Service unavailable' }, { status: 503 });

    // ── Fetch context ──────────────────────────────────────────────────────────
    const { data: todayRows } = await supabase.from('entries')
      .select('type, data').eq('date', date).eq('user_id', user.id);
    const today = {};
    for (const row of todayRows || []) today[row.type] = row.data;

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

    const dObj = new Date(date + 'T12:00:00');
    const lines = [`${DAY_NAMES[dObj.getDay()]} ${date}`];

    const todayLine = formatDay(date, today);
    if (todayLine) lines.push(`Today: ${todayLine}`);

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

    // First-time user welcome
    if (lines.length === 1) {
      const name = user.user_metadata?.name?.split(' ')[0] || 'there';
      const welcome = `Welcome to Day Lab, ${name}. Connect your Oura ring and start logging notes, meals, and tasks — the insights get sharper the more context you give them.`;
      await supabase.from('entries').upsert(
        { date, type: 'insights', data: { text: welcome, generatedAt: new Date().toISOString(), isWelcome: true }, user_id: user.id, updated_at: new Date().toISOString() },
        { onConflict: 'date,type,user_id' }
      );
      return Response.json({ insight: welcome });
    }

    // ── Generate ───────────────────────────────────────────────────────────────
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 160,
        system: `You are a sharp, honest friend who reads someone's daily log and tells them one thing worth knowing. You never hype bad metrics — poor sleep, low recovery, or skipped workouts are noted plainly, not celebrated. When something is off, suggest one concrete thing they can do about it. When something is genuinely good, you can acknowledge it briefly. Speak to patterns over single days when possible. Use everything: scores, workouts, meals, notes, tasks. CRITICAL: sleep data is labeled by day — only reference "last night" sleep if today's entry explicitly contains sleep data. If today has no Oura/sleep data, speak to trends or other data instead — never assume last night's sleep matches a previous night. 2-3 sentences max. No markdown, no "Your [metric]" openers, no sycophantic openers.`,
        messages: [{ role: 'user', content: context }],
      }),
    });

    const aiData = await res.json();
    if (aiData.error) return Response.json({ error: `AI error: ${aiData.error.message}` }, { status: 500 });

    const insight = (aiData.content?.find(b => b.type === 'text')?.text || '')
      .replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/^#{1,3}\s+/gm, '').trim();

    // Increment usage count for free users (welcome message doesn't count)
    if (!premium) {
      await incrementInsightCount(supabase, user.id);
    }

    await supabase.from('entries').upsert(
      { date, type: 'insights', data: { text: insight, generatedAt: new Date().toISOString(), v: CACHE_VERSION, healthKey: healthKey || '' }, user_id: user.id, updated_at: new Date().toISOString() },
      { onConflict: 'date,type,user_id' }
    );

    return Response.json({ insight });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
