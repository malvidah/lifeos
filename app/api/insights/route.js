// AI insights — premium only for generation, free users get tier:'free' response.
// Chat follow-ups also premium only; free users get 1 exchange/day tracked in DB.

import { createClient } from '@supabase/supabase-js';
import { isPremium, ANTHROPIC_KEY } from '../_lib/tier.js';

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

    const apiKey = ANTHROPIC_KEY();
    if (!apiKey) return Response.json({ error: 'Service unavailable' }, { status: 503 });

    const premium = await isPremium(supabase, user.id);

    // ── Follow-up chat ──────────────────────────────────────────────────────
    if (messages?.length) {
      if (!premium) {
        // Track daily chat count for free users
        const today = new Date().toISOString().split('T')[0];
        const { data: chatRow } = await supabase.from('entries').select('data')
          .eq('type', 'daily_chat').eq('date', today).eq('user_id', user.id).maybeSingle();
        const count = chatRow?.data?.count || 0;
        if (count >= 1) return Response.json({ tier: 'free', limit: true });

        // Increment counter
        await supabase.from('entries').upsert(
          { date: today, type: 'daily_chat', data: { count: count + 1 }, user_id: user.id, updated_at: new Date().toISOString() },
          { onConflict: 'date,type,user_id' }
        );
      }

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          system: `You are a thoughtful personal wellness coach embedded in someone's Day Loop dashboard. Be warm, observant, and concise. Use specific data points when relevant. Keep responses to 2-3 sentences unless asked for more detail.`,
          messages,
        }),
      });
      const data = await res.json();
      if (data.error) return Response.json({ error: `AI error: ${data.error.message}` }, { status: 500 });
      const text = data.content?.find(b => b.type === 'text')?.text || '';
      return Response.json({ insight: text });
    }

    // ── Initial insight generation ──────────────────────────────────────────
    if (!premium) return Response.json({ tier: 'free' });

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

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: `You are a thoughtful personal wellness coach embedded in someone's Day Loop dashboard. Generate 2-3 brief, specific insights based on their data. Be warm and observant, not preachy. Reference specific numbers and patterns.

If there's data from last year, include a "this time last year" reflection — be specific. If trends show improvement or decline, mention it with actual numbers.

Format: Natural conversational tone. No headers or bullet points. Separate insights with line breaks. Under 100 words total.`,
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
