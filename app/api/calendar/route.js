// Fetches Google Calendar events server-side.
// Reads Google token from DB, auto-refreshes if expired, no client token needed.

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

function fmtTime(dateTime, tz) {
  if (!dateTime) return "all day";
  const d = new Date(dateTime);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz || "UTC"
  });
}

function localDateKey(dateTimeOrDate, timeZone) {
  if (!dateTimeOrDate) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateTimeOrDate)) return dateTimeOrDate;
  return new Date(dateTimeOrDate).toLocaleDateString("en-CA", { timeZone: timeZone || "UTC" });
}

function eventColor(title = "") {
  const t = title.toLowerCase();
  if (["breakfast","lunch","dinner","snack","food","eat"].some(w => t.includes(w))) return "#9B4A4A";
  if (["climb","run","bike","lift","gym","yoga","swim","walk","sport","fitness","workout"].some(w => t.includes(w))) return "#5A9470";
  if (["doctor","medical","health","scoring","therapy","dentist"].some(w => t.includes(w))) return "#A8864A";
  if (["call","meeting","bootcamp","zoom","standup","sync","interview"].some(w => t.includes(w))) return "#4A7A9B";
  return "#B8A882";
}

function zoomUrl(event) {
  const loc = event.location || "";
  const desc = event.description || "";
  const match = (loc + " " + desc).match(/https?:\/\/([\w.-]*zoom\.us|meet\.google\.com)\/\S+/);
  return match ? match[0].split('"')[0].split("'")[0] : null;
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

async function fetchGCalEvents(accessToken, start, end) {
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", `${start}T00:00:00Z`);
  url.searchParams.set("timeMax", `${end}T23:59:59Z`);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "250");

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return { ok: r.ok, status: r.status, data: r.ok ? await r.json() : null };
}

export async function POST(request) {
  try {
    const { supabase } = getUserClient(request);
    if (!supabase) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return Response.json({ error: "unauthorized" }, { status: 401 });

    const { start, end, tz, token: clientToken } = await request.json();

    // 1. Get stored tokens from DB
    const { data: stored } = await supabase.from('entries').select('data')
      .eq('date', '0000-00-00').eq('type', 'google_token').eq('user_id', user.id)
      .maybeSingle();

    let accessToken = clientToken || stored?.data?.token;
    const refreshToken = stored?.data?.refreshToken;

    if (!accessToken && !refreshToken) {
      return Response.json({ error: "No Google Calendar connection" }, { status: 401 });
    }

    // 2. Try fetching events
    let result = accessToken ? await fetchGCalEvents(accessToken, start, end) : { ok: false, status: 401 };

    // 3. If token expired, refresh and retry
    if (!result.ok && refreshToken) {
      const newToken = await refreshGoogleToken(refreshToken);
      if (newToken) {
        // Save refreshed token to DB
        await supabase.from('entries').upsert(
          { date: '0000-00-00', type: 'google_token', data: { token: newToken, refreshToken }, user_id: user.id, updated_at: new Date().toISOString() },
          { onConflict: 'date,type,user_id' }
        );
        accessToken = newToken;
        result = await fetchGCalEvents(newToken, start, end);
      }
    }

    if (!result.ok) {
      return Response.json({ error: "Calendar fetch failed" }, { status: result.status || 500 });
    }

    const items = result.data?.items || [];

    // Group by local date
    const byDay = {};
    for (const ev of items) {
      const dateStr = ev.start?.dateTime || ev.start?.date;
      const key = localDateKey(dateStr, tz);
      if (!key) continue;
      if (!byDay[key]) byDay[key] = [];
      byDay[key].push({
        id: ev.id,
        title: ev.summary || "(no title)",
        time: ev.start?.date ? "all day" : fmtTime(ev.start?.dateTime, tz),
        endTime: ev.end?.date ? null : fmtTime(ev.end?.dateTime, tz),
        startDateTime: ev.start?.dateTime || null,
        endDateTime: ev.end?.dateTime || null,
        startDate: ev.start?.date || null,
        color: eventColor(ev.summary),
        zoomUrl: zoomUrl(ev),
        allDay: !!ev.start?.date,
      });
    }

    return Response.json({ events: byDay, googleToken: accessToken });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
