import { withAuth } from '../_lib/auth.js';

// GET /api/trips           → list all trips with the slim stop fields needed
//                            to derive date span + mode mix on the scroller.
// GET /api/trips?id=UUID   → single trip with full stops (joined to places).
// POST /api/trips          → create  { name? }
// PATCH /api/trips         → update  { id, name? }
// DELETE /api/trips?id=UUID → soft delete

export const GET = withAuth(async (req, { supabase, user }) => {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (id) {
    const { data: trip, error: tripErr } = await supabase
      .from('trips')
      .select('id, name, created_at, updated_at')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .eq('id', id)
      .maybeSingle();
    if (tripErr) throw tripErr;
    if (!trip) return Response.json({ trip: null });

    const { data: stops, error: stopsErr } = await supabase
      .from('trip_stops')
      .select(`
        id, place_id, order_idx, lat, lng, label, date_time, profile_to_next, via_waypoints, notes, created_at,
        place:user_places (id, name, lat, lng, category, color)
      `)
      .eq('trip_id', id)
      .order('order_idx', { ascending: true });
    if (stopsErr) throw stopsErr;

    return Response.json({ trip: { ...trip, stops: stops ?? [] } });
  }

  // List: include just enough from stops to compute date span + mode mix client-side.
  // Two queries (trips + stops) is simpler than a SQL aggregation and the volumes are small.
  const { data: trips, error } = await supabase
    .from('trips')
    .select('id, name, created_at, updated_at')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });
  if (error) throw error;

  const ids = (trips ?? []).map(t => t.id);
  let stopsByTrip = {};
  if (ids.length) {
    const { data: stops, error: stopsErr } = await supabase
      .from('trip_stops')
      .select('trip_id, date_time, profile_to_next, order_idx')
      .in('trip_id', ids)
      .order('order_idx', { ascending: true });
    if (stopsErr) throw stopsErr;
    for (const s of stops ?? []) {
      (stopsByTrip[s.trip_id] ||= []).push(s);
    }
  }

  const result = (trips ?? []).map(t => ({ ...t, stops: stopsByTrip[t.id] ?? [] }));
  return Response.json({ trips: result });
});

export const POST = withAuth(async (req, { supabase, user }) => {
  const { name = 'Untitled trip' } = await req.json();

  const { data, error } = await supabase
    .from('trips')
    .insert({ user_id: user.id, name })
    .select('id, name, created_at, updated_at')
    .single();
  if (error) throw error;
  return Response.json({ trip: { ...data, stops: [] } });
});

export const PATCH = withAuth(async (req, { supabase, user }) => {
  const { id, ...rest } = await req.json();
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const allowed = ['name'];
  const patch = Object.fromEntries(
    Object.entries(rest).filter(([k]) => allowed.includes(k))
  );
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('trips')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .select('id, name, updated_at')
    .single();
  if (error) throw error;
  return Response.json({ trip: data });
});

export const DELETE = withAuth(async (req, { supabase, user }) => {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabase
    .from('trips')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) throw error;
  return Response.json({ ok: true });
});
