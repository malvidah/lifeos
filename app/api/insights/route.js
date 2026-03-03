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

    const { date, messages } = await request.json();
    if (!date) return Response.json({ error: 'date required' }, { status: 400 });

    // Rate limit: 30 requests per user per hour
    const rl = rateLimit(`insights:${user.id}`, { max: 30, windowMs: 60 * 60 * 1000 });
    if (!rl.ok) return Response.json({ error: `Too many requests. Try again in ${rl.retryAfter}s.` }, { status: 429 });

    const apiKey = ANTHROPIC_KEY();
    if (!apiKey) return Response.json({ error: 'Service unavailable' }, { status: 503 });

    // ── Insight generation ────────────────────────────────────────────────────
    // ── Initial insight generation — available to all users ──────────────────

    // Today's data (all entry types)
    const { data: todayEntries } = await supabase.from('entries')
      .select('type, data').eq('date', date).eq('user_id', user.id);
    const today = {};
    for (const row of todayEntries || []) today[row.type] = row.data;

    // Last 7 days of health + activity
    const recentHealth = [], recentActivity = [];
    for (let i = 1; i <= 7; i++) {
      const d = dateOffset(date, -i);
      const { data: hRow } = await supabase.from('entries')
        .select('data').eq('date', d).eq('type', 'health').eq('user_id', user.id).maybeSingle();
      if (hRow?.data) recentHealth.push({ date: d, ...hRow.data });
      const { data: aRow } = await supabase.from('entries')
        .select('data').eq('date', d).eq('type', 'activity').eq('user_id', user.id).maybeSingle();
      if (aRow?.data && Array.isArray(aRow.data)) {
        const entries = aRow.data.filter(r => r.text?.trim()).map(r => r.text);
        if (entries.length) recentActivity.push({ date: d, entries });
      }
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

    // ── Per-day history — each row dated so model can see direction ────────
    if (recentHealth.length || recentActivity.length) {
      parts.push('\nRecent days (most recent first):');
      for (let i = 1; i <= 7; i++) {
        const d = dateOffset(date, -i);
        const h = recentHealth.find(r => r.date === d);
        const a = recentActivity.find(r => r.date === d);
        const dObj = new Date(d + 'T12:00:00');
        const dName = DAY_NAMES_FULL[dObj.getDay()].slice(0,3);
        const row = [];
        if (h) {
          if (h.sleepScore)     row.push(`sleep ${h.sleepScore}`);
          if (h.readinessScore) row.push(`readiness ${h.readinessScore}`);
          if (h.hrv)            row.push(`HRV ${h.hrv}ms`);
          if (h.activityScore)  row.push(`activity ${h.activityScore}`);
        }
        if (a?.entries?.length) row.push(`workout: ${a.entries.join(', ')}`);
        if (row.length) parts.push(`  ${dName} ${d}: ${row.join(', ')}`);
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

    // Detect empty state — only the date header, no actual data
    const hasData = parts.length > 1 || recentHealth.length > 0 || recentActivity.length > 0;
    if (!hasData) {
      // Get user's name for welcome message
      const userName = user.user_metadata?.name?.split(' ')[0] || user.email?.split('@')[0] || 'there';
      const welcome = `Welcome to Day Loop, ${userName}. Connect your Oura ring to start seeing AI insights based on your sleep, readiness, and HRV — then use the chat bar below to ask questions or log your day. The more data you add, the sharper the insights get.`;
      // Cache the welcome so it doesn't re-generate every load
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
        system: `You are a direct, no-BS wellness coach giving a daily briefing. Your job is to say the one or two things that are genuinely specific to THIS day — not generic advice that could apply to any day.

Rules:
- Before writing anything, ask yourself: "Could this exact sentence apply to yesterday, or any other day?" If yes, rewrite it until it couldn't.
- Look for direction and change: is something improving, declining, or breaking a pattern? That's the story.
- If there's a "this time last year" data point, use it — but only if the comparison is actually interesting.
- Lead with what it means for TODAY: what to protect, push, or adjust RIGHT NOW. One specific number is fine if it earns its place.
- 2-3 sentences max. Plain English. Sound like a smart friend who actually looked at the data.
- Never start with "Your" followed by a metric name. Never list metrics.
- NEVER use markdown: no **bold**, no *italic*, no ## headers.
- NEVER start with the date or day name. Jump straight into the insight.`,
        messages: [{ role: 'user', content: context }],
      }),
    });

    const insightData = await res.json();
    if (insightData.error) return Response.json({ error: `AI error: ${insightData.error.message}` }, { status: 500 });
    const insight = insightData.content?.find(b => b.type === 'text')?.text || 'No insights generated.';

    // Cache
    await supabase.from('entries').upsert(
      { date, type: 'insights', data: { text: insight, generatedAt: new Date().toISOString(), v: 4 }, user_id: user.id, updated_at: new Date().toISOString() },
      { onConflict: 'date,type,user_id' }
    );

    return Response.json({ insight });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
