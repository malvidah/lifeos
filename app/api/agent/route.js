import { createClient } from '@supabase/supabase-js';
import { refreshGoogleToken } from '../_lib/google.js';
import { getServiceClient } from '../_lib/auth.js';
import { rateLimit } from '../_lib/rateLimit.js';

// ── Agent token auth ─────────────────────────────────────────────────────────
// Tokens are stored in user_settings.data.agentToken (service-role access required
// because the request uses the dl_ token, not a Supabase JWT).

async function resolveAgentToken(personalToken) {
  if (!personalToken?.startsWith('dl_')) return null;
  const svc = getServiceClient();
  // Scan user_settings for a matching token (low-volume endpoint, acceptable)
  const { data: rows } = await svc.from('user_settings').select('user_id, data');
  const match = rows?.find(r => r.data?.agentToken?.token === personalToken);
  return match ? { userId: match.user_id, svc } : null;
}

// ── READ helpers ─────────────────────────────────────────────────────────────

async function readTyped(svc, userId, type, date) {
  switch (type) {
    case 'journal': {
      const { data } = await svc.from('journal_blocks').select('content, position')
        .eq('user_id', userId).eq('date', date).order('position');
      return (data ?? []).map(r => r.content.replace(/<[^>]+>/g, '').trim()).filter(Boolean).join('\n');
    }
    case 'tasks': {
      const { data } = await svc.from('tasks').select('text, done, due_date')
        .eq('user_id', userId).eq('date', date).order('position');
      return data ?? [];
    }
    case 'meals': {
      const { data } = await svc.from('meal_items').select('content, ai_calories, ai_protein')
        .eq('user_id', userId).eq('date', date).order('position');
      return (data ?? []).map(r => ({ text: r.content, kcal: r.ai_calories, protein: r.ai_protein }));
    }
    case 'workouts':
    case 'activity': {
      const { data } = await svc.from('workouts').select('name, sport, duration_mins, distance_m, avg_hr, calories, source')
        .eq('user_id', userId).eq('date', date);
      return data ?? [];
    }
    case 'health': {
      const { data } = await svc.from('health_metrics').select('*')
        .eq('user_id', userId).eq('date', date);
      if (!data?.length) return null;
      const priority = ['oura', 'apple', 'garmin'];
      return data.sort((a, b) => priority.indexOf(a.source) - priority.indexOf(b.source))[0];
    }
    default:
      return null;
  }
}

async function readAll(svc, userId, date) {
  const [journal, tasks, meals, workouts, health] = await Promise.all([
    readTyped(svc, userId, 'journal',  date),
    readTyped(svc, userId, 'tasks',    date),
    readTyped(svc, userId, 'meals',    date),
    readTyped(svc, userId, 'workouts', date),
    readTyped(svc, userId, 'health',   date),
  ]);
  return { journal, tasks, meals, workouts, health };
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function POST(request) {
  try {
    const auth = request.headers.get('authorization') || '';
    const personalToken = auth.replace('Bearer ', '').trim();

    const resolved = await resolveAgentToken(personalToken);
    if (!resolved) return Response.json({ error: 'Token not found' }, { status: 401 });
    const { userId, svc } = resolved;

    const rl = rateLimit(`agent:${personalToken}`, { max: 120, windowMs: 60 * 60 * 1000 });
    if (!rl.ok) return Response.json({ error: `Rate limited. Retry in ${rl.retryAfter}s` }, { status: 429 });

    const { action, type, date, payload } = await request.json();

    // ── READ ──────────────────────────────────────────────────────────────
    if (action === 'read') {
      if (type === 'all') {
        const data = await readAll(svc, userId, date);
        return Response.json({ ok: true, date, data });
      }
      const data = await readTyped(svc, userId, type, date);
      return Response.json({ ok: true, date, type, data });
    }

    // ── WRITE ─────────────────────────────────────────────────────────────
    if (action === 'write') {
      const targetDate = date || new Date().toISOString().split('T')[0];

      // tasks
      if (type === 'tasks') {
        if (payload.add) {
          const items = Array.isArray(payload.add) ? payload.add : [payload.add];
          const { data: last } = await svc.from('tasks').select('position')
            .eq('user_id', userId).eq('date', targetDate).order('position', { ascending: false }).limit(1);
          let nextPos = (last?.[0]?.position ?? -1) + 1;
          const rows = items.map(t => ({
            user_id: userId, date: targetDate, position: nextPos++,
            text: t, html: `<li data-type="taskItem" data-checked="false"><p>${t}</p></li>`, done: false,
          }));
          await svc.from('tasks').insert(rows);
          return Response.json({ ok: true, added: items.length, tasks: rows.map(r => ({ text: r.text, done: false })) });
        }
        if (payload.complete) {
          const { data: rows } = await svc.from('tasks').select('id, text')
            .eq('user_id', userId).eq('date', targetDate).eq('done', false);
          const match = rows?.find(r => r.text?.toLowerCase().includes(payload.complete.toLowerCase()));
          if (match) await svc.from('tasks').update({ done: true, completed_at: targetDate }).eq('id', match.id);
          return Response.json({ ok: true, action: 'completed', match: payload.complete });
        }
        if (payload.delete) {
          const { data: rows } = await svc.from('tasks').select('id, text')
            .eq('user_id', userId).eq('date', targetDate);
          const match = rows?.find(r => r.text?.toLowerCase().includes(payload.delete.toLowerCase()));
          if (match) await svc.from('tasks').delete().eq('id', match.id);
          return Response.json({ ok: true, action: 'deleted', match: payload.delete });
        }
      }

      // notes / journal
      if (type === 'notes' || type === 'journal') {
        if (payload.append) {
          const { data: last } = await svc.from('journal_blocks').select('position')
            .eq('user_id', userId).eq('date', targetDate).order('position', { ascending: false }).limit(1);
          const nextPos = (last?.[0]?.position ?? -1) + 1;
          await svc.from('journal_blocks').insert({
            user_id: userId, date: targetDate, position: nextPos,
            content: `<p>${payload.append}</p>`, project_tags: [], note_tags: [],
          });
          return Response.json({ ok: true, action: 'appended' });
        }
        if (payload.set !== undefined) {
          // Full replace — delete blocks for date, insert single block
          await svc.from('journal_blocks').delete().eq('user_id', userId).eq('date', targetDate);
          if (payload.set) {
            await svc.from('journal_blocks').insert({
              user_id: userId, date: targetDate, position: 0,
              content: `<p>${payload.set}</p>`, project_tags: [], note_tags: [],
            });
          }
          return Response.json({ ok: true, action: 'set' });
        }
      }

      // meals
      if (type === 'meals') {
        if (payload.add) {
          const items = Array.isArray(payload.add) ? payload.add : [payload.add];
          const { data: last } = await svc.from('meal_items').select('position')
            .eq('user_id', userId).eq('date', targetDate).order('position', { ascending: false }).limit(1);
          let nextPos = (last?.[0]?.position ?? -1) + 1;
          await svc.from('meal_items').insert(
            items.map(t => ({ user_id: userId, date: targetDate, position: nextPos++, content: t }))
          );
          return Response.json({ ok: true, added: items.length });
        }
      }

      // activity / workouts
      if (type === 'activity' || type === 'workouts') {
        if (payload.add) {
          const items = Array.isArray(payload.add) ? payload.add : [payload.add];
          await svc.from('workouts').insert(
            items.map(t => ({ user_id: userId, date: targetDate, name: t, source: 'manual' }))
          );
          return Response.json({ ok: true, added: items.length });
        }
      }

      // calendar
      if (type === 'calendar') {
        const { data: settingsRow } = await svc.from('user_settings').select('data')
          .eq('user_id', userId).maybeSingle();
        let accessToken = settingsRow?.data?.googleToken;
        const refreshTok = settingsRow?.data?.googleRefreshToken;
        if (!accessToken && refreshTok) accessToken = await refreshGoogleToken(refreshTok);
        if (!accessToken) return Response.json({ error: 'No Google Calendar token' }, { status: 400 });

        const events = Array.isArray(payload.events) ? payload.events : [payload.events];
        const tz = payload.tz || 'America/Los_Angeles';
        const results = [];
        for (const ev of events) {
          const evDate = ev.date || targetDate;
          let eventBody;
          if (ev.allDay || !ev.startTime) {
            const next = new Date(evDate + 'T12:00:00');
            next.setDate(next.getDate() + 1);
            eventBody = { summary: ev.title, start: { date: evDate }, end: { date: next.toISOString().split('T')[0] } };
          } else {
            const endT = ev.endTime || (() => {
              const [h, m] = ev.startTime.split(':').map(Number);
              return `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            })();
            eventBody = {
              summary: ev.title,
              start: { dateTime: `${evDate}T${ev.startTime}:00`, timeZone: tz },
              end:   { dateTime: `${evDate}T${endT}:00`,         timeZone: tz },
            };
          }
          const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(eventBody),
          });
          const d = await res.json();
          results.push({ title: ev.title, ok: res.ok, id: d.id });
        }
        return Response.json({ ok: true, events: results });
      }
    }

    return Response.json({ error: 'Unknown action or type' }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// ── Token management ─────────────────────────────────────────────────────────

function getUserClient(sessionToken) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${sessionToken}` } } }
  );
}

export async function PUT(request) {
  const sessionToken = (request.headers.get('authorization') || '').replace('Bearer ', '').trim();
  if (!sessionToken) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const userClient = getUserClient(sessionToken);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const token = 'dl_' + Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  const svc = getServiceClient();
  const { data: existing } = await svc.from('user_settings').select('data')
    .eq('user_id', user.id).maybeSingle();
  await svc.from('user_settings').upsert({
    user_id: user.id,
    data: { ...(existing?.data || {}), agentToken: { token, createdAt: new Date().toISOString() } },
  }, { onConflict: 'user_id' });

  return Response.json({ ok: true, token });
}

export async function GET(request) {
  const sessionToken = (request.headers.get('authorization') || '').replace('Bearer ', '').trim();
  if (!sessionToken) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const userClient = getUserClient(sessionToken);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const svc = getServiceClient();
  const { data: row } = await svc.from('user_settings').select('data')
    .eq('user_id', user.id).maybeSingle();
  const tokenData = row?.data?.agentToken;

  if (!tokenData?.token) return Response.json({ exists: false });
  const t = tokenData.token;
  return Response.json({
    exists: true,
    masked: t.slice(0, 7) + '••••••••••••••••' + t.slice(-4),
    createdAt: tokenData.createdAt,
  });
}
