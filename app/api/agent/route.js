import { createClient } from '@supabase/supabase-js';
import { refreshGoogleToken, saveGoogleToken } from '../_lib/google.js';
import { rateLimit } from '../_lib/rateLimit.js';

const SERVICE = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    // ── Auth: resolve personal token → user_id ──────────────────────────
    const auth = request.headers.get('authorization') || '';
    const personalToken = auth.replace('Bearer ', '').trim();
    if (!personalToken?.startsWith('dl_')) {
      return Response.json({ error: 'Invalid token' }, { status: 401 });
    }

    const svc = SERVICE();
    const { data: tokenRow } = await svc
      .from('entries')
      .select('user_id')
      .eq('type', 'agent_token')
      .eq('date', 'global')
      .eq('data->>token', personalToken)
      .maybeSingle();

    if (!tokenRow?.user_id) {
      return Response.json({ error: 'Token not found' }, { status: 401 });
    }
    const userId = tokenRow.user_id;

    // ── Rate limit: 120/hour per token ──────────────────────────────────
    const rl = rateLimit(`agent:${personalToken}`, { max: 120, windowMs: 60 * 60 * 1000 });
    if (!rl.ok) return Response.json({ error: `Rate limited. Retry in ${rl.retryAfter}s` }, { status: 429 });

    const body = await request.json();
    const { action, type, date, payload } = body;

    // ── READ ────────────────────────────────────────────────────────────
    if (action === 'read') {
      if (type === 'all') {
        const { data: rows } = await svc.from('entries')
          .select('type, data')
          .eq('date', date)
          .eq('user_id', userId);
        const result = {};
        for (const r of rows || []) result[r.type] = r.data;
        return Response.json({ ok: true, date, data: result });
      }
      const { data: row } = await svc.from('entries')
        .select('data')
        .eq('date', date)
        .eq('type', type)
        .eq('user_id', userId)
        .maybeSingle();
      return Response.json({ ok: true, date, type, data: row?.data ?? null });
    }

    // ── WRITE ───────────────────────────────────────────────────────────
    if (action === 'write') {
      const targetDate = date || new Date().toISOString().split('T')[0];

      // tasks
      if (type === 'tasks') {
        const { data: existing } = await svc.from('entries').select('data')
          .eq('date', targetDate).eq('type', 'tasks').eq('user_id', userId).maybeSingle();
        const current = Array.isArray(existing?.data) ? existing.data : [];
        const cleaned = current.filter(r => r.text?.trim());

        if (payload.add) {
          const items = Array.isArray(payload.add) ? payload.add : [payload.add];
          const newRows = items.map(t => ({ id: crypto.randomUUID(), text: t, done: false }));
          await svc.from('entries').upsert(
            { date: targetDate, type: 'tasks', data: [...cleaned, ...newRows], user_id: userId, updated_at: new Date().toISOString() },
            { onConflict: 'date,type,user_id' }
          );
          return Response.json({ ok: true, added: items.length, tasks: newRows });
        }
        if (payload.complete) {
          const updated = current.map(r =>
            r.text?.toLowerCase().includes(payload.complete.toLowerCase()) ? { ...r, done: true } : r
          );
          await svc.from('entries').upsert(
            { date: targetDate, type: 'tasks', data: updated, user_id: userId, updated_at: new Date().toISOString() },
            { onConflict: 'date,type,user_id' }
          );
          return Response.json({ ok: true, action: 'completed', match: payload.complete });
        }
        if (payload.delete) {
          const updated = current.filter(r => !r.text?.toLowerCase().includes(payload.delete.toLowerCase()));
          await svc.from('entries').upsert(
            { date: targetDate, type: 'tasks', data: updated, user_id: userId, updated_at: new Date().toISOString() },
            { onConflict: 'date,type,user_id' }
          );
          return Response.json({ ok: true, action: 'deleted', match: payload.delete });
        }
      }

      // notes
      if (type === 'notes' || type === 'journal') {
        const { data: existing } = await svc.from('entries').select('data')
          .eq('date', targetDate).eq('type', 'journal').eq('user_id', userId).maybeSingle();
        if (payload.append) {
          const current = existing?.data || '';
          const updated = current ? current + '\n\n' + payload.append : payload.append;
          await svc.from('entries').upsert(
            { date: targetDate, type: 'journal', data: updated, user_id: userId, updated_at: new Date().toISOString() },
            { onConflict: 'date,type,user_id' }
          );
          return Response.json({ ok: true, action: 'appended' });
        }
        if (payload.set !== undefined) {
          await svc.from('entries').upsert(
            { date: targetDate, type: 'journal', data: payload.set, user_id: userId, updated_at: new Date().toISOString() },
            { onConflict: 'date,type,user_id' }
          );
          return Response.json({ ok: true, action: 'set' });
        }
      }

      // meals / activity — add rows
      if (type === 'meals' || type === 'activity' || type === 'workouts') {
        const { data: existing } = await svc.from('entries').select('data')
          .eq('date', targetDate).eq('type', type).eq('user_id', userId).maybeSingle();
        const current = Array.isArray(existing?.data) ? existing.data : [];
        if (payload.add) {
          const items = Array.isArray(payload.add) ? payload.add : [payload.add];
          const newRows = items.map(t => ({ id: crypto.randomUUID(), text: t, kcal: null }));
          await svc.from('entries').upsert(
            { date: targetDate, type, data: [...current.filter(r => r.text?.trim()), ...newRows], user_id: userId, updated_at: new Date().toISOString() },
            { onConflict: 'date,type,user_id' }
          );
          return Response.json({ ok: true, added: items.length });
        }
      }

      // calendar
      if (type === 'calendar') {
        const { data: stored } = await svc.from('entries').select('data')
          .eq('date', '0000-00-00').eq('type', 'google_token').eq('user_id', userId).maybeSingle();
        let accessToken = stored?.data?.token;
        const refreshTok = stored?.data?.refreshToken;
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
              end: { dateTime: `${evDate}T${endT}:00`, timeZone: tz },
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

// ── Token management ────────────────────────────────────────────────────────
export async function PUT(request) {
  // Generate a new personal token for the authenticated user
  const auth = request.headers.get('authorization') || '';
  const sessionToken = auth.replace('Bearer ', '').trim();
  if (!sessionToken) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${sessionToken}` } } }
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const svc = SERVICE();
  const token = 'dl_' + Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  await svc.from('entries').upsert(
    { date: 'global', type: 'agent_token', user_id: user.id, data: { token, createdAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
    { onConflict: 'date,type,user_id' }
  );
  return Response.json({ ok: true, token });
}

export async function GET(request) {
  // Check if a token exists (return masked version)
  const auth = request.headers.get('authorization') || '';
  const sessionToken = auth.replace('Bearer ', '').trim();
  if (!sessionToken) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${sessionToken}` } } }
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const svc = SERVICE();
  const { data: row } = await svc.from('entries').select('data')
    .eq('date', 'global').eq('type', 'agent_token').eq('user_id', user.id).maybeSingle();

  if (!row?.data?.token) return Response.json({ exists: false });
  const t = row.data.token;
  return Response.json({ exists: true, masked: t.slice(0, 7) + '••••••••••••••••' + t.slice(-4), createdAt: row.data.createdAt });
}
