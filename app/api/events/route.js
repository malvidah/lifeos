import { withAuth } from '../_lib/auth.js';

// GET /api/events?date=YYYY-MM-DD          → events on that date
// GET /api/events?start=YYYY-MM-DD&end=..  → events in a date range (calendar)
//
// POST /api/events  { date, title, start_time?, end_time?, description?, calendar_id? }
//   Creates event. If google_token provided, also writes to Google Calendar.
//
// PATCH /api/events  { id, ...fields }
// DELETE /api/events?id=UUID

export const GET = withAuth(async (req, { supabase, user }) => {
  const { searchParams } = new URL(req.url);
  const date  = searchParams.get('date');
  const start = searchParams.get('start');
  const end   = searchParams.get('end');

  let query = supabase
    .from('events')
    .select('id, date, start_time, end_time, title, description, google_event_id, calendar_id')
    .eq('user_id', user.id);

  if (date) {
    query = query.eq('date', date);
  } else if (start && end) {
    query = query.gte('date', start).lte('date', end);
  } else {
    return Response.json({ error: 'date or start+end required' }, { status: 400 });
  }

  const { data, error } = await query.order('start_time', { ascending: true, nullsFirst: true });
  if (error) throw error;
  return Response.json({ events: data ?? [] });
});

export const POST = withAuth(async (req, { supabase, user }) => {
  const {
    date, title, start_time = null, end_time = null,
    description = null, calendar_id = null, google_event_id = null,
  } = await req.json();

  if (!date || !title) return Response.json({ error: 'date and title required' }, { status: 400 });

  const { data, error } = await supabase
    .from('events')
    .insert({ user_id: user.id, date, title, start_time, end_time, description, calendar_id, google_event_id })
    .select()
    .single();
  if (error) throw error;

  return Response.json({ event: data });
});

export const PATCH = withAuth(async (req, { supabase, user }) => {
  const { id, ...rest } = await req.json();
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const allowed = ['date', 'title', 'start_time', 'end_time', 'description', 'calendar_id', 'google_event_id'];
  const patch = Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k)));

  const { error } = await supabase
    .from('events').update(patch)
    .eq('id', id).eq('user_id', user.id);
  if (error) throw error;

  return Response.json({ ok: true });
});

export const DELETE = withAuth(async (req, { supabase, user }) => {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabase
    .from('events').delete()
    .eq('id', id).eq('user_id', user.id);
  if (error) throw error;

  return Response.json({ ok: true });
});
