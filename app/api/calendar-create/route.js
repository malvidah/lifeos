// Creates a Google Calendar event — handles token refresh server-side

import { createClient } from '@supabase/supabase-js';

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

async function refreshGoogleToken(refreshToken) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) return null;
  return data.access_token;
}

async function createGCalEvent(accessToken, eventBody) {
  const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(eventBody),
  });
  return { ok: r.ok, status: r.status, data: await r.json() };
}

export async function POST(request) {
  try {
    const { supabase } = getUserClient(request);
    if (!supabase) return Response.json({ error: 'unauthorized' }, { status: 401 });
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

    const { title, date, startTime, endTime, allDay, tz } = await request.json();
    if (!title || !date) return Response.json({ error: 'title and date required' }, { status: 400 });

    // Get stored tokens
    const { data: stored } = await supabase.from('entries').select('data')
      .eq('date', '0000-00-00').eq('type', 'google_token').eq('user_id', user.id)
      .maybeSingle();

    let accessToken = stored?.data?.token;
    const refreshToken = stored?.data?.refreshToken;
    if (!accessToken && !refreshToken) {
      return Response.json({ error: 'No Google Calendar connection' }, { status: 401 });
    }

    // Build event body
    let eventBody;
    const timezone = tz || 'America/Los_Angeles';
    if (allDay || !startTime) {
      const nextDay = new Date(date + 'T12:00:00');
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDayStr = nextDay.toISOString().split('T')[0];
      eventBody = { summary: title, start: { date }, end: { date: nextDayStr } };
    } else {
      const endT = endTime || (() => {
        const [h, m] = startTime.split(':').map(Number);
        return `${String((h+1)%24).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      })();
      eventBody = {
        summary: title,
        start: { dateTime: `${date}T${startTime}:00`, timeZone: timezone },
        end:   { dateTime: `${date}T${endT}:00`,       timeZone: timezone },
      };
    }

    // Try creating event
    let result = await createGCalEvent(accessToken, eventBody);

    // If token expired, refresh and retry
    if (!result.ok && refreshToken) {
      const newToken = await refreshGoogleToken(refreshToken);
      if (newToken) {
        await supabase.from('entries').upsert(
          { date: '0000-00-00', type: 'google_token', data: { token: newToken, refreshToken }, user_id: user.id, updated_at: new Date().toISOString() },
          { onConflict: 'date,type,user_id' }
        );
        result = await createGCalEvent(newToken, eventBody);
      }
    }

    if (!result.ok) {
      return Response.json({ error: result.data?.error?.message || 'Calendar create failed' }, { status: result.status || 500 });
    }

    return Response.json({ ok: true, eventId: result.data.id });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
