// Fetches Google Calendar events server-side using a stored OAuth token.
// The client POSTs { token, start, end } — we call GCal and return shaped events.

function fmtTime(dateTime) {
  if (!dateTime) return "all day";
  const d = new Date(dateTime);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles"
  });
}

function localDateKey(dateTimeOrDate, timeZone = "America/Los_Angeles") {
  if (!dateTimeOrDate) return null;
  // All-day events have just a date string
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateTimeOrDate)) return dateTimeOrDate;
  return new Date(dateTimeOrDate).toLocaleDateString("en-CA", { timeZone }); // en-CA = YYYY-MM-DD
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

export async function POST(request) {
  try {
    const { token, start, end } = await request.json();

    // Use env var as fallback if no token passed
    const accessToken = token || process.env.GOOGLE_CALENDAR_TOKEN;
    if (!accessToken) {
      return Response.json({ error: "No Google Calendar token" }, { status: 401 });
    }

    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("timeMin", `${start}T00:00:00-08:00`);
    url.searchParams.set("timeMax", `${end}T23:59:59-08:00`);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "250");

    const r = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!r.ok) {
      const err = await r.text();
      return Response.json({ error: err }, { status: r.status });
    }

    const data = await r.json();
    const items = data.items || [];

    // Group by local date
    const byDay = {};
    for (const ev of items) {
      const dateStr = ev.start?.dateTime || ev.start?.date;
      const key = localDateKey(dateStr);
      if (!key) continue;
      if (!byDay[key]) byDay[key] = [];
      byDay[key].push({
        title: ev.summary || "(no title)",
        time: ev.start?.date ? "all day" : fmtTime(ev.start?.dateTime),
        color: eventColor(ev.summary),
        zoomUrl: zoomUrl(ev),
        allDay: !!ev.start?.date,
      });
    }

    return Response.json({ events: byDay });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
