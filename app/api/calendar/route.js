// Unified Google Calendar API route
// GET    → list events for a date range
// POST   → create event
// PATCH  → update event
// DELETE → delete event
//
// All handlers share the same auth + token-fetch + refresh-on-401 pattern
// via withGoogleToken().

import { withAuth } from '../_lib/auth.js';
import { refreshGoogleToken, saveGoogleToken } from '../_lib/google.js';

// ─── Shared helpers ───────────────────────────────────────────────────────────

function fmtTime(dateTime, tz) {
  if (!dateTime) return "all day";
  return new Date(dateTime).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz || "UTC",
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

function buildEventBody(params) {
  const { title, date, startTime, endTime, allDay, tz } = params;
  const timezone = tz || "America/Los_Angeles";

  if (allDay || !startTime) {
    const nextDay = new Date(date + "T12:00:00");
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDayStr = nextDay.toISOString().split("T")[0];
    return { summary: title, start: { date }, end: { date: nextDayStr } };
  }

  const endT = endTime || (() => {
    const [h, m] = startTime.split(":").map(Number);
    return `${String((h + 1) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  })();

  return {
    summary: title,
    start: { dateTime: `${date}T${startTime}:00`, timeZone: timezone },
    end:   { dateTime: `${date}T${endT}:00`,       timeZone: timezone },
  };
}

// Fetches stored Google token, calls fn(accessToken), refreshes once on 401.
// Returns { ok, status, data, accessToken } — accessToken is always the current valid token.
async function withGoogleToken(supabase, userId, fn, clientToken = null) {
  const { data: stored } = await supabase.from("user_settings").select("data")
    .eq("user_id", userId).maybeSingle();

  let accessToken = clientToken || stored?.data?.googleToken;
  const refreshToken = stored?.data?.googleRefreshToken;

  if (!accessToken && !refreshToken) {
    return { ok: false, status: 401, error: "No Google Calendar connection" };
  }

  let result = accessToken ? await fn(accessToken) : { ok: false, status: 401 };

  if (!result.ok && refreshToken) {
    const newToken = await refreshGoogleToken(refreshToken);
    if (newToken) {
      await saveGoogleToken(supabase, userId, newToken, refreshToken);
      accessToken = newToken;
      result = await fn(newToken);
    }
  }

  return { ...result, accessToken };
}

// ─── GET /api/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD&tz=... ────────────────
// Lists events grouped by local date. Fetches primary + any extra calendars
// stored in user_settings.data.extraCalendars = [{ id, summary, color }].

export const GET = withAuth(async (request, { supabase, user }) => {
  const { searchParams } = new URL(request.url);
  const start = searchParams.get("start");
  const end   = searchParams.get("end");
  const tz    = searchParams.get("tz");

  if (!start || !end) return Response.json({ error: "start and end required" }, { status: 400 });

  // Read extra calendars from user settings (same row withGoogleToken reads for token)
  const { data: stored } = await supabase.from("user_settings").select("data")
    .eq("user_id", user.id).maybeSingle();
  const extraCalendars = stored?.data?.extraCalendars || []; // [{ id, summary, color }]

  const buildUrl = (calId) => {
    const u = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`);
    u.searchParams.set("timeMin", `${start}T00:00:00Z`);
    u.searchParams.set("timeMax", `${end}T23:59:59Z`);
    u.searchParams.set("singleEvents", "true");
    u.searchParams.set("orderBy", "startTime");
    u.searchParams.set("maxResults", "250");
    return u.toString();
  };

  // Fetch all calendars in parallel; extra calendar failures are non-fatal
  const fetchAll = async (token) => {
    const calIds = ['primary', ...extraCalendars.map(c => c.id)];
    const results = await Promise.all(
      calIds.map(calId =>
        fetch(buildUrl(calId), { headers: { Authorization: `Bearer ${token}` } })
          .then(async r => ({ ok: r.ok, status: r.status, calId, data: r.ok ? await r.json() : null }))
          .catch(() => ({ ok: false, status: 500, calId, data: null }))
      )
    );
    const primary = results.find(r => r.calId === 'primary');
    if (!primary?.ok) return { ok: false, status: primary?.status || 500, results };
    return { ok: true, status: 200, results };
  };

  const { ok, status, results, accessToken, error } = await withGoogleToken(
    supabase, user.id, fetchAll
  );

  if (error) return Response.json({ error }, { status });
  if (!ok) return Response.json({ error: "Calendar fetch failed" }, { status: status || 500 });

  // Build a color map: calId → color (for extra calendars, use their stored color)
  const calColorMap = {};
  for (const cal of extraCalendars) calColorMap[cal.id] = cal.color;

  const byDay = {};
  for (const { calId, data: calData, ok: calOk } of results) {
    if (!calOk || !calData?.items) continue;
    const isExtra = calId !== 'primary';
    const calColor = calColorMap[calId]; // undefined for primary → use eventColor()

    for (const ev of calData.items) {
      const dateStr = ev.start?.dateTime || ev.start?.date;
      const key = localDateKey(dateStr, tz);
      if (!key) continue;
      (byDay[key] ??= []).push({
        id:            ev.id,
        calendarId:    calId,
        title:         ev.summary || "(no title)",
        time:          ev.start?.date ? "all day" : fmtTime(ev.start?.dateTime, tz),
        endTime:       ev.end?.date   ? null        : fmtTime(ev.end?.dateTime,   tz),
        startDateTime: ev.start?.dateTime || null,
        endDateTime:   ev.end?.dateTime   || null,
        startDate:     ev.start?.date     || null,
        color:         isExtra ? (calColor || '#4A7A9B') : eventColor(ev.summary),
        zoomUrl:       zoomUrl(ev),
        allDay:        !!ev.start?.date,
      });
    }
  }

  // Sort each day's events chronologically
  for (const key of Object.keys(byDay)) {
    byDay[key].sort((a, b) => {
      const at = a.startDateTime || (a.startDate + 'T00:00:00Z');
      const bt = b.startDateTime || (b.startDate + 'T00:00:00Z');
      return at < bt ? -1 : at > bt ? 1 : 0;
    });
  }

  return Response.json({ events: byDay, googleToken: accessToken });
});

// ─── POST /api/calendar — create event ───────────────────────────────────────

export const POST = withAuth(async (request, { supabase, user }) => {
  const body = await request.json();
  const { title, date } = body;
  if (!title || !date) return Response.json({ error: "title and date required" }, { status: 400 });

  const eventBody = buildEventBody(body);

  const { ok, status, data, error } = await withGoogleToken(
    supabase, user.id,
    (token) => fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(eventBody),
    }).then(async r => ({ ok: r.ok, status: r.status, data: await r.json() }))
  );

  if (error) return Response.json({ error }, { status });
  if (!ok) return Response.json({ error: data?.error?.message || "Calendar create failed" }, { status: status || 500 });

  return Response.json({ ok: true, eventId: data.id });
});

// ─── PATCH /api/calendar — update event ──────────────────────────────────────

export const PATCH = withAuth(async (request, { supabase, user }) => {
  const body = await request.json();
  const { eventId, title, date } = body;
  if (!eventId || !title || !date) return Response.json({ error: "eventId, title and date required" }, { status: 400 });

  const eventBody = buildEventBody(body);

  const { ok, status, data, error } = await withGoogleToken(
    supabase, user.id,
    (token) => fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(eventBody),
    }).then(async r => ({ ok: r.ok, status: r.status, data: await r.json() }))
  );

  if (error) return Response.json({ error }, { status });
  if (!ok) return Response.json({ error: data?.error?.message || "Calendar update failed" }, { status: status || 500 });

  return Response.json({ ok: true });
});

// ─── DELETE /api/calendar — delete event ─────────────────────────────────────

export const DELETE = withAuth(async (request, { supabase, user }) => {
  const { eventId } = await request.json();
  if (!eventId) return Response.json({ error: "eventId required" }, { status: 400 });

  const { ok, status, error } = await withGoogleToken(
    supabase, user.id,
    (token) => fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => ({ ok: r.ok || r.status === 204, status: r.status }))
  );

  if (error) return Response.json({ error }, { status });
  if (!ok) return Response.json({ error: "Calendar delete failed" }, { status: status || 500 });

  return Response.json({ ok: true });
});
