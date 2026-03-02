// Creates a Google Calendar event using the stored OAuth token

export async function POST(request) {
  try {
    const { title, date, startTime, endTime, allDay, googleToken } = await request.json();
    if (!title || !date) return Response.json({ error: 'title and date required' }, { status: 400 });
    if (!googleToken) return Response.json({ error: 'no_google_token' }, { status: 404 });

    let eventBody;
    if (allDay || !startTime) {
      const nextDay = new Date(date + 'T12:00:00');
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDayStr = nextDay.toISOString().split('T')[0];
      eventBody = {
        summary: title,
        start: { date },
        end:   { date: nextDayStr },
      };
    } else {
      const tz = 'America/Los_Angeles'; // fallback; client sends tz
      const endT = endTime || (() => {
        const [h, m] = startTime.split(':').map(Number);
        return `${String((h+1)%24).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      })();
      eventBody = {
        summary: title,
        start: { dateTime: `${date}T${startTime}:00`, timeZone: tz },
        end:   { dateTime: `${date}T${endT}:00`,   timeZone: tz },
      };
    }

    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: { Authorization: `Bearer ${googleToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(eventBody),
    });

    const data = await res.json();
    if (!res.ok) return Response.json({ error: data.error?.message || 'gcal_error' }, { status: res.status });
    return Response.json({ ok: true, eventId: data.id });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
