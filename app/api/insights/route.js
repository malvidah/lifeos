import { withAuth } from '../_lib/auth.js';
import { isPremium, ANTHROPIC_KEY } from '../_lib/tier.js';
import { rateLimit } from '../_lib/rateLimit.js';

const CACHE_VERSION = 8;
const FREE_LIMIT    = 10;
const DAY_NAMES     = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const SOURCE_PRIORITY = ['oura', 'apple', 'garmin'];

function dateOffset(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// Fetch a single day's data from typed tables
async function fetchDay(supabase, userId, date) {
  const [journalR, tasksR, mealsR, workoutsR, metricsR, scoresR] = await Promise.all([
    supabase.from('journal_blocks').select('content').eq('user_id', userId).eq('date', date).order('position'),
    supabase.from('tasks').select('text, done').eq('user_id', userId).eq('date', date).order('position'),
    supabase.from('meal_items').select('content, ai_calories, ai_protein').eq('user_id', userId).eq('date', date).order('position'),
    supabase.from('workouts').select('name, sport, duration_mins, distance_m, avg_hr, calories').eq('user_id', userId).eq('date', date),
    supabase.from('health_metrics').select('source, hrv, rhr, sleep_hrs, sleep_eff, steps, active_min').eq('user_id', userId).eq('date', date),
    supabase.from('health_scores').select('sleep_score, readiness_score, activity_score, recovery_score').eq('user_id', userId).eq('date', date).maybeSingle(),
  ]);

  // Best health source
  let health = null;
  for (const r of metricsR.data ?? []) {
    if (!health || SOURCE_PRIORITY.indexOf(r.source) < SOURCE_PRIORITY.indexOf(health.source)) health = r;
  }

  return {
    journal:  journalR.data ?? [],
    tasks:    tasksR.data ?? [],
    meals:    mealsR.data ?? [],
    workouts: workoutsR.data ?? [],
    health,
    scores:   scoresR.data ?? null,
  };
}

function formatDay(date, data) {
  const parts = [];
  const h = data.health;
  const s = data.scores;

  if (h || s) {
    const scores = [
      s?.sleep_score     && `sleep score ${s.sleep_score}${h?.sleep_hrs ? ` (${h.sleep_hrs}h${h?.sleep_eff ? ` ${h.sleep_eff}% eff` : ''})` : ''}`,
      s?.readiness_score && `readiness ${s.readiness_score}`,
      h?.hrv             && `HRV ${h.hrv}ms`,
      h?.rhr             && `RHR ${h.rhr}bpm`,
      s?.activity_score  && `activity ${s.activity_score}${h?.steps ? ` (${Number(h.steps).toLocaleString()} steps)` : ''}`,
      s?.recovery_score  && `recovery ${s.recovery_score}`,
    ].filter(Boolean);
    if (scores.length) parts.push(scores.join(', '));
  }

  const workouts = data.workouts.map(w =>
    [w.name || w.sport, w.duration_mins && `${w.duration_mins}min`,
     w.distance_m && `${(w.distance_m * 0.000621371).toFixed(1)}mi`,
     w.avg_hr && `${w.avg_hr}bpm`].filter(Boolean).join(' ')
  ).filter(Boolean);
  if (workouts.length) parts.push(`workout: ${workouts.join(', ')}`);

  if (data.meals?.length) {
    const ms = data.meals.filter(r => r.content?.trim())
      .map(r => r.content + (r.ai_calories ? ` (${r.ai_calories}kcal)` : ''));
    if (ms.length) parts.push(`meals: ${ms.join(', ')}`);
  }

  if (data.tasks?.length) {
    const done = data.tasks.filter(r => r.done  && r.text?.trim()).map(r => r.text);
    const todo = data.tasks.filter(r => !r.done && r.text?.trim()).map(r => r.text);
    if (done.length) parts.push(`done: ${done.join(', ')}`);
    if (todo.length) parts.push(`todo: ${todo.join(', ')}`);
  }

  if (data.journal?.length) {
    const text = data.journal.map(r => r.content?.replace(/<[^>]+>/g, '').trim()).filter(Boolean).join(' ');
    if (text) parts.push(`notes: "${text.slice(0, 250)}${text.length > 250 ? '…' : ''}"`);
  }

  return parts.length ? parts.join(' | ') : null;
}

// ── user_settings helpers for insights cache & usage ─────────────────────────

async function readSettings(supabase, userId) {
  const { data } = await supabase.from('user_settings').select('data')
    .eq('user_id', userId).maybeSingle();
  return data?.data || {};
}

async function mergeSettings(supabase, userId, patch) {
  const { data: existing } = await supabase.from('user_settings').select('data')
    .eq('user_id', userId).maybeSingle();
  await supabase.from('user_settings').upsert({
    user_id: userId,
    data: { ...(existing?.data || {}), ...patch },
  }, { onConflict: 'user_id' });
}

export const POST = withAuth(async (req, { supabase, user }) => {
  const { date, healthKey } = await req.json();
  if (!date) return Response.json({ error: 'date required' }, { status: 400 });

  // Read user_settings once — used for cache, usage count, and premium check
  const settings = await readSettings(supabase, user.id);

  // ── Cache check ──────────────────────────────────────────────────────────
  const cached = settings.insights_cache?.[date];
  if (cached?.text && cached?.generatedAt) {
    const age = Date.now() - new Date(cached.generatedAt).getTime();
    if (age < 24 * 60 * 60 * 1000) {
      return Response.json({ insight: cached.text, cached: true });
    }
  }

  // ── Tier check — only for new generations ───────────────────────────────
  const premium = settings.premium?.active === true;
  if (!premium) {
    const usageCount = settings.insightUsage?.count || 0;
    if (usageCount >= FREE_LIMIT) {
      return Response.json({ tier: 'free', usageCount, limit: FREE_LIMIT });
    }
  }

  const rl = rateLimit(`insights:${user.id}`, { max: 100, windowMs: 60 * 60 * 1000 });
  if (!rl.ok) return Response.json({ error: `Rate limited. Retry in ${rl.retryAfter}s.` }, { status: 429 });

  const apiKey = ANTHROPIC_KEY();
  if (!apiKey) return Response.json({ error: 'Service unavailable' }, { status: 503 });

  // ── Fetch context in parallel ────────────────────────────────────────────
  const recentDates    = Array.from({ length: 7 }, (_, i) => dateOffset(date, -(i + 1)));
  const lastYearDates  = [dateOffset(date, -366), dateOffset(date, -365), dateOffset(date, -364)];

  const [todayData, ...allOtherData] = await Promise.all([
    fetchDay(supabase, user.id, date),
    ...recentDates.map(d => fetchDay(supabase, user.id, d)),
    ...lastYearDates.map(d => fetchDay(supabase, user.id, d)),
  ]);

  const recentData   = allOtherData.slice(0, recentDates.length);
  const lastYearData = allOtherData.slice(recentDates.length);

  // ── Build prompt lines ───────────────────────────────────────────────────
  const dObj = new Date(date + 'T12:00:00');
  const lines = [`${DAY_NAMES[dObj.getDay()]} ${date}`];
  let realDataCount = 0;

  const todayLine = formatDay(date, todayData);
  if (todayLine) { lines.push(`Today: ${todayLine}`); realDataCount++; }

  const hasTodayHealth = !!(todayData.health && (todayData.health.sleep_hrs || todayData.health.hrv));
  if (!hasTodayHealth) {
    lines.push('Today: no Oura data for last night (ring not worn or not yet synced) — do not infer or assume last night\'s sleep from previous nights');
  }

  if (recentDates.length) {
    lines.push('');
    for (let i = 0; i < recentDates.length; i++) {
      const line = formatDay(recentDates[i], recentData[i]);
      if (line) {
        lines.push(`${DAY_NAMES[new Date(recentDates[i] + 'T12:00:00').getDay()]} ${recentDates[i]}: ${line}`);
        realDataCount++;
      }
    }
  }

  if (lastYearDates.length) {
    lines.push('');
    for (let i = 0; i < lastYearDates.length; i++) {
      const line = formatDay(lastYearDates[i], lastYearData[i]);
      if (line) { lines.push(`Last year ${lastYearDates[i]}: ${line}`); realDataCount++; }
    }
  }

  // No data at all — show welcome
  if (realDataCount === 0) {
    const name = user.user_metadata?.name?.split(' ')[0] || 'there';
    const welcome = `Welcome to Day Lab, ${name}. Connect your health data (Oura or Apple Health) and start logging meals, notes, and tasks — insights will start generating once there's data to work with.`;
    await mergeSettings(supabase, user.id, {
      insights_cache: {
        ...(settings.insights_cache || {}),
        [date]: { text: welcome, generatedAt: new Date().toISOString(), isWelcome: true },
      },
    });
    return Response.json({ insight: welcome });
  }

  // ── Generate ─────────────────────────────────────────────────────────────
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 160,
      system: `You are a sharp, honest friend who reads someone's daily log and tells them one thing worth knowing. You never hype bad metrics — poor sleep, low recovery, or skipped workouts are noted plainly, not celebrated. When something is off, suggest one concrete thing they can do about it. When something is genuinely good, you can acknowledge it briefly. Speak to patterns over single days when possible. Use everything: scores, workouts, meals, notes, tasks. CRITICAL: sleep data is labeled by day — only reference "last night" sleep if today's entry explicitly contains sleep data. If today has no Oura/sleep data, speak to trends or other data instead — never assume last night's sleep matches a previous night. 2-3 sentences max. No markdown, no "Your [metric]" openers, no sycophantic openers.`,
      messages: [{ role: 'user', content: lines.join('\n') }],
    }),
  });

  const aiData = await res.json();
  if (aiData.error) return Response.json({ error: `AI error: ${aiData.error.message}` }, { status: 500 });

  const insight = (aiData.content?.find(b => b.type === 'text')?.text || '')
    .replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/^#{1,3}\s+/gm, '').trim();

  // ── Persist cache and usage count ────────────────────────────────────────
  const usageCount = settings.insightUsage?.count || 0;
  const newCache   = { ...(settings.insights_cache || {}), [date]: { text: insight, generatedAt: new Date().toISOString(), v: CACHE_VERSION, healthKey: healthKey || '' } };
  const newUsage   = premium ? (settings.insightUsage || {}) : { count: usageCount + 1, updatedAt: new Date().toISOString() };

  await mergeSettings(supabase, user.id, { insights_cache: newCache, insightUsage: newUsage });

  return Response.json({ insight });
});
