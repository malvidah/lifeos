// AI insights — premium only for generation, free users get tier:'free' response.
// Chat follow-ups also premium only; free users get 1 exchange/day tracked in DB.

import { createClient } from '@supabase/supabase-js';
import { isPremium, ANTHROPIC_KEY } from '../_lib/tier.js';
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

function dateOffset(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export async function POST(request) {
  try {
    const { supabase } = getUserClient(request);
    if (!supabase) return Response.json({ error: 'unauthorized' }, { status: 401 });
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

    const { date, healthKey } = await request.json();
    if (!date) return Response.json({ error: 'date required' }, { status: 400 });

    // Today's data (all entry types)
    const { data: todayEntries } = await supabase.from('entries')
      .select('type, data').eq('date', date).eq('user_id', user.id);
    const today = {};
    for (const row of todayEntries || []) today[row.type] = row.data;

    // If health isn't in DB yet (insight generated before Oura data saved),
    // use the scores the client sent in healthKey as a fallback
    if (!today.health && healthKey) {
      const [, sleep, readiness] = healthKey.split(':');
      if (+sleep > 0 || +readiness > 0) {
        today.health = { sleepScore: +sleep || '', readinessScore: +readiness || '' };
      }
    }

    // Rate limit: 30 requests per user per hour
    const rl = rateLimit(`insights:${user.id}`, { max: 30, windowMs: 60 * 60 * 1000 });
    if (!rl.ok) return Response.json({ error: `Too many requests. Try again in ${rl.retryAfter}s.` }, { status: 429 });

    const apiKey = ANTHROPIC_KEY();
    if (!apiKey) return Response.json({ error: 'Service unavailable' }, { status: 503 });

    // ── Insight generation ────────────────────────────────────────────────────
    // ── Insight generation ──────────────────────────────────────────────────

    // Last 7 days — fetch all entry types in one query per day
    const recentDays = []; // [{date, health, workouts, activity, notes, meals, tasks}]
    for (let i = 1; i <= 7; i++) {
      const d = dateOffset(date, -i);
      const { data: rows } = await supabase.from('entries')
        .select('type, data').eq('date', d).eq('user_id', user.id);
      if (!rows?.length) continue;
      const day = { date: d };
      for (const row of rows) day[row.type] = row.data;
      recentDays.push(day);
    }

    // Last year today (±1 day window)
    const lastYearDates = [dateOffset(date, -366), dateOffset(date, -365), dateOffset(date, -364)];
    const lastYearData = {};
    for (const d of lastYearDates) {
      const { data: lyRows } = await supabase.from('entries')
        .select('type, data').eq('date', d).eq('user_id', user.id);
      for (const row of lyRows || []) {
        if (!lastYearData[d]) lastYearData[d] = {};
        lastYearData[d][row.type] = row.data;
      }
    }
    const hasLastYear = Object.keys(lastYearData).some(d => Object.keys(lastYearData[d] || {}).length > 0);

    // Build context — dated per-day rows so the model can spot direction, not just averages
    const DAY_NAMES_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const dateObj = new Date(date + 'T12:00:00');
    const dayOfWeek = DAY_NAMES_FULL[dateObj.getDay()];

    const parts = [`Date: ${dayOfWeek}, ${date}`];

    // ── Today ──────────────────────────────────────────────────────────────
    if (today.health) {
      const h = today.health;
      const healthParts = [];
      if (h.sleepScore)     healthParts.push(`sleep score ${h.sleepScore}${h.sleepHrs ? ` (${h.sleepHrs}h, ${h.sleepEff}% efficient)` : ''}`);
      if (h.readinessScore) healthParts.push(`readiness ${h.readinessScore}`);
      if (h.hrv)            healthParts.push(`HRV ${h.hrv}ms`);
      if (h.rhr)            healthParts.push(`RHR ${h.rhr}bpm`);
      if (h.activityScore)  healthParts.push(`activity score ${h.activityScore}${h.activeCalories ? ` (${h.activeCalories} cal, ${h.activeMinutes}min active)` : ''}`);
      if (h.resilienceScore) healthParts.push(`recovery score ${h.resilienceScore} (${h.stressMins}min stress / ${h.recoveryMins}min recovery)`);
      if (healthParts.length) parts.push(`Today's health: ${healthParts.join(', ')}`);
    }
    if (today.notes) {
      const n = typeof today.notes === 'string' ? today.notes : JSON.stringify(today.notes);
      if (n.trim()) parts.push(`Today's notes: ${n.slice(0, 400)}`);
    }
    if (today.meals?.length) {
      const meals = today.meals.filter(r => r.text?.trim()).map(r =>
        `${r.text}${r.protein ? ` (${r.protein}g protein, ${r.kcal}kcal)` : r.kcal ? ` (${r.kcal}kcal)` : ''}`
      );
      if (meals.length) parts.push(`Today's meals: ${meals.join('; ')}`);
    }
    if (today.tasks?.length) {
      const done = today.tasks.filter(r => r.done && r.text?.trim()).map(r => r.text);
      const todo = today.tasks.filter(r => !r.done && r.text?.trim()).map(r => r.text);
      if (done.length) parts.push(`Completed today: ${done.join(', ')}`);
      if (todo.length) parts.push(`Still to do: ${todo.join(', ')}`);
    }
    if (today.activity?.length) {
      const acts = today.activity.filter(r => r.text?.trim()).map(r => r.text);
      if (acts.length) parts.push(`Today's activity: ${acts.join(', ')}`);
    }
    // Today's synced workouts from Strava/Oura
    if (today.workouts?.length) {
      const ws = today.workouts.map(w => {
        const p = [w.name || w.sport];
        if (w.durationMins) p.push(`${w.durationMins}min`);
        if (w.distance) p.push(`${(w.distance * 0.621371).toFixed(1)}mi`);
        if (w.calories) p.push(`${w.calories}cal`);
        if (w.avgHr) p.push(`avg ${w.avgHr}bpm`);
        return p.join(' ');
      });
      parts.push(`Today's workouts: ${ws.join('; ')}`);
    }

    // ── Per-day history — all context so model can spot life themes ───────
    if (recentDays.length) {
      parts.push('\n--- Recent days (context only, NOT today) ---');
      for (const day of recentDays) {
        const dObj = new Date(day.date + 'T12:00:00');
        const dName = DAY_NAMES_FULL[dObj.getDay()].slice(0,3);
        const row = [];

        // Health scores
        const h = day.health;
        if (h) {
          if (h.sleepScore)     row.push(`sleep ${h.sleepScore}`);
          if (h.readinessScore) row.push(`readiness ${h.readinessScore}`);
          if (h.hrv)            row.push(`HRV ${h.hrv}ms`);
          if (h.activityScore)  row.push(`activity ${h.activityScore}`);
        }

        // Synced workouts (Strava/Oura)
        if (Array.isArray(day.workouts) && day.workouts.length) {
          const ws = day.workouts.map(w => {
            const p = [w.name || w.sport];
            if (w.durationMins) p.push(`${w.durationMins}min`);
            if (w.distance) p.push(`${(w.distance * 0.621371).toFixed(1)}mi`);
            if (w.avgHr) p.push(`${w.avgHr}bpm avg`);
            return p.join(' ');
          });
          row.push(`workout: ${ws.join(', ')}`);
        }

        // Manual activity entries
        if (Array.isArray(day.activity)) {
          const acts = day.activity.filter(r => r.text?.trim()).map(r => r.text);
          if (acts.length) row.push(`activity: ${acts.join(', ')}`);
        }

        // Notes — the most human signal, include in full (truncated)
        if (day.notes) {
          const n = typeof day.notes === 'string' ? day.notes.trim() : '';
          if (n) row.push(`notes: "${n.slice(0, 200)}${n.length > 200 ? '…' : ''}"`);
        }

        // Meals summary
        if (Array.isArray(day.meals)) {
          const ms = day.meals.filter(r => r.text?.trim()).map(r => r.text);
          if (ms.length) row.push(`meals: ${ms.join(', ')}`);
        }

        // Tasks completed
        if (Array.isArray(day.tasks)) {
          const done = day.tasks.filter(r => r.done && r.text?.trim()).map(r => r.text);
          if (done.length) row.push(`did: ${done.join(', ')}`);
        }

        if (row.length) parts.push(`  ${dName} ${day.date}: ${row.join(' | ')}`);
      }
    }

    // ── Same day last year ─────────────────────────────────────────────────
    if (hasLastYear) {
      const lyRows = [];
      for (const [d, data] of Object.entries(lastYearData)) {
        if (!data || Object.keys(data).length === 0) continue;
        const row = [];
        if (data.health) {
          const h = data.health;
          if (h.sleepScore)     row.push(`sleep ${h.sleepScore}`);
          if (h.readinessScore) row.push(`readiness ${h.readinessScore}`);
          if (h.hrv)            row.push(`HRV ${h.hrv}ms`);
        }
        if (data.activity?.length) {
          const acts = data.activity.filter(r => r.text?.trim()).map(r => r.text);
          if (acts.length) row.push(`workout: ${acts.join(', ')}`);
        }
        if (data.notes && typeof data.notes === 'string' && data.notes.trim()) {
          row.push(`notes: "${data.notes.slice(0, 150)}"`);
        }
        if (row.length) lyRows.push(`  ${d}: ${row.join(', ')}`);
      }
      if (lyRows.length) {
        parts.push('\nThis time last year:');
        parts.push(...lyRows);
      }
    }

    const context = parts.join('\n');

    // Only show the welcome message if there's truly nothing — no today data AND no history
    const hasAnything = parts.length > 1 || recentDays.length > 0;
    if (!hasAnything) {
      const userName = user.user_metadata?.name?.split(' ')[0] || user.email?.split('@')[0] || 'there';
      const welcome = `Welcome to Day Loop, ${userName}. Connect your Oura ring to start seeing AI insights based on your sleep, readiness, and HRV — then log meals, notes, and tasks to make them richer. The more you add, the sharper the insights get.`;
      await supabase.from('entries').upsert(
        { date, type: 'insights', data: { text: welcome, generatedAt: new Date().toISOString(), isWelcome: true }, user_id: user.id, updated_at: new Date().toISOString() },
        { onConflict: 'date,type,user_id' }
      );
      return Response.json({ insight: welcome });
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 160,
        system: `You are a sharp, observant friend who has access to someone's daily life data — health scores, workouts, meals, notes, and tasks. Your job is to give one genuinely useful observation, grounded in everything you can see.

TODAY'S DATA IS PRIMARY when it exists. Recent history is context for making today more meaningful — or the main story when today hasn't loaded yet.

What to look for (pick the most interesting angle):
- Themes across notes: are they reading more, reflecting, stressed, excited about something?
- Patterns connecting life and body: late nights correlating with low HRV, hard workouts followed by recovery dips
- Wins worth naming: a streak, something they finished, a personal best
- A gentle flag if something looks off — but only if it's real
- A recommendation if something obvious fits: a book, a rest day, a walk

If today's data is sparse or not synced yet: lean on the recent history to say something meaningful about trends, patterns, or what to expect today. Never say "check back later" or "no data yet" — there's always something worth saying if there's history.

Rules:
- 2 sentences max. Plain English. Sound like a smart friend, not a report.
- If health looks fine and notes are more interesting — talk about the notes.
- No markdown. Don't start with the date, "Your", or a metric name.
- Never invent data not present. If notes are empty across all days, don't mention them.`,
        messages: [{ role: 'user', content: context }],
      }),
    });

    const insightData = await res.json();
    if (insightData.error) return Response.json({ error: `AI error: ${insightData.error.message}` }, { status: 500 });
    const insight = insightData.content?.find(b => b.type === 'text')?.text || 'No insights generated.';

    // Cache
    await supabase.from('entries').upsert(
      { date, type: 'insights', data: { text: insight, generatedAt: new Date().toISOString(), v: 6, healthKey: healthKey || '' }, user_id: user.id, updated_at: new Date().toISOString() },
      { onConflict: 'date,type,user_id' }
    );

    return Response.json({ insight });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
