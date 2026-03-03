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

    const premium = await isPremium(supabase, user.id);

    // ── Follow-up chat ──────────────────────────────────────────────────────
    if (messages?.length) {
      // Chat is premium only
      if (!premium) return Response.json({ tier: 'free', limit: true });

      // Build today's data context for chat so Claude doesn't ask for data it already has
      const { data: chatEntries } = await supabase.from('entries')
        .select('type, data').eq('date', date).eq('user_id', user.id);
      const chatToday = {};
      for (const row of chatEntries || []) chatToday[row.type] = row.data;

      const chatCtxParts = [];
      if (chatToday.health) {
        const h = chatToday.health;
        chatCtxParts.push(`Sleep ${h.sleepScore || '?'} (${h.sleepHrs || '?'}h, ${h.sleepEff || '?'}% eff), Readiness ${h.readinessScore || '?'}, HRV ${h.hrv || '?'}ms, RHR ${h.rhr || '?'}bpm, Activity ${h.activityScore || '?'} (${h.activeCalories || '?'} cal burned)`);
      }
      if (chatToday.notes) chatCtxParts.push(`Notes: ${String(chatToday.notes).slice(0, 400)}`);
      if (chatToday.meals?.length) {
        const m = chatToday.meals.filter(r => r.text?.trim()).map(r => r.text);
        if (m.length) chatCtxParts.push(`Meals: ${m.join(', ')}`);
      }
      if (chatToday.activity?.length) {
        const a = chatToday.activity.filter(r => r.text?.trim()).map(r => r.text);
        if (a.length) chatCtxParts.push(`Activity: ${a.join(', ')}`);
      }
      if (chatToday.tasks?.length) {
        const t = chatToday.tasks.filter(r => r.text?.trim()).map(r => `${r.done ? '✓' : '○'} ${r.text}`);
        if (t.length) chatCtxParts.push(`Tasks: ${t.join(', ')}`);
      }
      const chatContext = chatCtxParts.length
        ? `Today's data (${date}):\n${chatCtxParts.join('\n')}`
        : `No health or activity data logged yet for ${date}.`;

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          system: `You are a warm, observant wellness coach inside someone's Day Loop dashboard. You have access to their data — never ask them to provide it.

${chatContext}

Rules: 1-3 sentences max. Be specific, reference actual numbers when available. No bullet points. No headers. If they ask what you can tell them, give a direct observation from the data above.`,
          messages,
        }),
      });
      const data = await res.json();
      if (data.error) return Response.json({ error: `AI error: ${data.error.message}` }, { status: 500 });
      const text = data.content?.find(b => b.type === 'text')?.text || '';
      return Response.json({ insight: text });
    }

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

    // Build context
    const parts = [`## Today (${date})`];

    if (today.health) {
      const h = today.health;
      parts.push(`Health: Sleep ${h.sleepScore || '?'} (${h.sleepHrs || '?'}h, ${h.sleepEff || '?'}% eff), Readiness ${h.readinessScore || '?'} (HRV ${h.hrv || '?'}ms, RHR ${h.rhr || '?'}bpm), Activity ${h.activityScore || '?'} (${h.activeCalories || '?'} cal burned, ${h.activeMinutes || '?'} active min), Recovery ${h.resilienceScore || '?'} (stress ${h.stressMins || '?'}min, recovery ${h.recoveryMins || '?'}min)`);
    }
    if (today.notes) {
      const n = typeof today.notes === 'string' ? today.notes : JSON.stringify(today.notes);
      parts.push(`Notes: ${n.slice(0, 500)}`);
    }
    if (today.meals && Array.isArray(today.meals)) {
      const meals = today.meals.filter(r => r.text?.trim()).map(r => `${r.text}${r.protein ? ` (${r.protein}g protein, ${r.kcal} kcal)` : r.kcal ? ` (${r.kcal} kcal)` : ''}`);
      if (meals.length) parts.push(`Meals: ${meals.join(', ')}`);
    }
    if (today.tasks && Array.isArray(today.tasks)) {
      const tasks = today.tasks.filter(r => r.text?.trim()).map(r => `${r.done ? '✓' : '○'} ${r.text}`);
      if (tasks.length) parts.push(`Tasks: ${tasks.join(', ')}`);
    }
    if (today.activity && Array.isArray(today.activity)) {
      const acts = today.activity.filter(r => r.text?.trim()).map(r => r.text);
      if (acts.length) parts.push(`Activity: ${acts.join(', ')}`);
    }

    if (recentHealth.length) {
      parts.push(`\n## Recent Trends (past 7 days)`);
      const sleepScores = recentHealth.map(h => +h.sleepScore).filter(Boolean);
      const readScores = recentHealth.map(h => +h.readinessScore).filter(Boolean);
      const hrvs = recentHealth.map(h => +h.hrv).filter(Boolean);
      if (sleepScores.length) parts.push(`Sleep scores: ${sleepScores.join(', ')} (avg ${Math.round(sleepScores.reduce((a, b) => a + b) / sleepScores.length)})`);
      if (readScores.length) parts.push(`Readiness: ${readScores.join(', ')} (avg ${Math.round(readScores.reduce((a, b) => a + b) / readScores.length)})`);
      if (hrvs.length) parts.push(`HRV: ${hrvs.join(', ')}ms (avg ${Math.round(hrvs.reduce((a, b) => a + b) / hrvs.length)}ms)`);
    }
    if (recentActivity.length) {
      parts.push(`Recent activity: ${recentActivity.map(a => `${a.date}: ${a.entries.join(', ')}`).join(' | ')}`);
    }
    if (hasLastYear) {
      parts.push(`\n## This Time Last Year`);
      for (const [d, data] of Object.entries(lastYearData)) {
        if (!data || Object.keys(data).length === 0) continue;
        if (data.notes) parts.push(`[${d}] Notes: ${typeof data.notes === 'string' ? data.notes.slice(0, 200) : ''}`);
        if (data.health) {
          const h = data.health;
          parts.push(`[${d}] Health: Sleep ${h.sleepScore || '?'}, Readiness ${h.readinessScore || '?'}, HRV ${h.hrv || '?'}ms`);
        }
        if (data.activity && Array.isArray(data.activity)) {
          const acts = data.activity.filter(r => r.text?.trim()).map(r => r.text);
          if (acts.length) parts.push(`[${d}] Activity: ${acts.join(', ')}`);
        }
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
        max_tokens: 200,
        system: `You are a warm, observant wellness coach inside someone's Day Loop dashboard. Write 1-3 sentences of specific insight based on their data. Reference actual numbers. No bullet points, no headers, no preamble — just the insight.

If there's data from last year, weave in a brief "this time last year" comparison. Keep it under 60 words total.`,
        messages: [{ role: 'user', content: context }],
      }),
    });

    const insightData = await res.json();
    if (insightData.error) return Response.json({ error: `AI error: ${insightData.error.message}` }, { status: 500 });
    const insight = insightData.content?.find(b => b.type === 'text')?.text || 'No insights generated.';

    // Cache
    await supabase.from('entries').upsert(
      { date, type: 'insights', data: { text: insight, generatedAt: new Date().toISOString() }, user_id: user.id, updated_at: new Date().toISOString() },
      { onConflict: 'date,type,user_id' }
    );

    return Response.json({ insight });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
