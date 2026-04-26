import { withAuth } from '../../_lib/auth.js';

// Stops own their geometry (lat/lng) + label directly. They MAY also link to a
// saved user_places row via place_id, but they don't have to — most stops are
// route-only waypoints (BART stations, lunch spots, etc) that we don't want
// polluting the saved places list.
//
// POST   /api/trips/stops          → create  { trip_id, lat, lng, label?, place_id?, order_idx?, date_time?, profile_to_next?, notes? }
// PATCH  /api/trips/stops          → update  { id, lat?, lng?, label?, order_idx?, date_time?, profile_to_next?, via_waypoints?, notes? }
//                                  → bulk reorder: { trip_id, order: [stop_id_in_order, ...] }
// DELETE /api/trips/stops?id=UUID  → delete

const VALID_PROFILES = ['walk', 'bike', 'transit', 'drive'];

const STOP_SELECT = `
  id, place_id, order_idx, lat, lng, label, date_time, profile_to_next, via_waypoints, notes, created_at,
  place:user_places (id, name, lat, lng, category, color)
`;

// Verify the user owns the trip behind a stop. Returns true/false.
async function userOwnsTrip(supabase, userId, tripId) {
  const { data, error } = await supabase
    .from('trips')
    .select('id')
    .eq('id', tripId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  return !error && !!data;
}

export const POST = withAuth(async (req, { supabase, user }) => {
  const {
    trip_id, lat, lng, label = null, place_id = null,
    order_idx, date_time = null, profile_to_next = null, notes = null,
  } = await req.json();

  if (!trip_id || typeof lat !== 'number' || typeof lng !== 'number') {
    return Response.json({ error: 'trip_id, lat, lng required' }, { status: 400 });
  }
  if (profile_to_next !== null && !VALID_PROFILES.includes(profile_to_next)) {
    return Response.json({ error: 'invalid profile_to_next' }, { status: 400 });
  }
  if (!(await userOwnsTrip(supabase, user.id, trip_id))) {
    return Response.json({ error: 'trip not found' }, { status: 404 });
  }

  // If no order_idx given, append to end.
  let idx = order_idx;
  if (idx == null) {
    const { data: last } = await supabase
      .from('trip_stops')
      .select('order_idx')
      .eq('trip_id', trip_id)
      .order('order_idx', { ascending: false })
      .limit(1)
      .maybeSingle();
    idx = (last?.order_idx ?? -1) + 1;
  }

  const { data, error } = await supabase
    .from('trip_stops')
    .insert({ trip_id, place_id, lat, lng, label, order_idx: idx, date_time, profile_to_next, notes })
    .select(STOP_SELECT)
    .single();
  if (error) throw error;
  return Response.json({ stop: data });
});

export const PATCH = withAuth(async (req, { supabase, user }) => {
  const body = await req.json();

  // Bulk reorder shape: { trip_id, order: [id1, id2, ...] }
  if (body.trip_id && Array.isArray(body.order)) {
    if (!(await userOwnsTrip(supabase, user.id, body.trip_id))) {
      return Response.json({ error: 'trip not found' }, { status: 404 });
    }
    // order_idx is not UNIQUE, so we can write target positions directly without
    // a two-phase bump.
    const updates = body.order.map((id, i) =>
      supabase.from('trip_stops').update({ order_idx: i }).eq('id', id).eq('trip_id', body.trip_id)
    );
    const results = await Promise.all(updates);
    const firstErr = results.find(r => r.error);
    if (firstErr) throw firstErr.error;
    return Response.json({ ok: true });
  }

  // Single-stop update.
  const { id, ...rest } = body;
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });
  if (rest.profile_to_next !== undefined && rest.profile_to_next !== null
      && !VALID_PROFILES.includes(rest.profile_to_next)) {
    return Response.json({ error: 'invalid profile_to_next' }, { status: 400 });
  }

  const allowed = ['order_idx', 'lat', 'lng', 'label', 'date_time', 'profile_to_next', 'via_waypoints', 'notes'];
  const patch = Object.fromEntries(
    Object.entries(rest).filter(([k]) => allowed.includes(k))
  );

  const { data, error } = await supabase
    .from('trip_stops')
    .update(patch)
    .eq('id', id)
    .select(STOP_SELECT)
    .single();
  if (error) throw error;
  return Response.json({ stop: data });
});

export const DELETE = withAuth(async (req, { supabase }) => {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  // RLS policy on trip_stops walks back to trips for ownership — safe.
  const { error } = await supabase.from('trip_stops').delete().eq('id', id);
  if (error) throw error;
  return Response.json({ ok: true });
});
