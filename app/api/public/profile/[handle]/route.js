// GET /api/public/profile/[handle]
//   Unauthenticated. Returns the profile + the user's public notes & trips.
//   Uses the service client to bypass RLS — same pattern as
//   /api/public/project/[token].

import { getServiceClient } from '../../../_lib/auth.js';

export async function GET(_req, { params }) {
  const { handle: rawHandle } = await params;
  const handle = (rawHandle || '').toLowerCase().trim();
  if (!handle) return Response.json({ error: 'missing handle' }, { status: 400 });

  const sb = getServiceClient();

  // Look up the user by handle (case-insensitive). user_settings.data->>'handle'
  // is what the unique partial index covers.
  const { data: settingsRow, error: sErr } = await sb
    .from('user_settings')
    .select('user_id, data')
    .filter('data->>handle', 'eq', handle)
    .maybeSingle();
  if (sErr) return Response.json({ error: 'lookup failed' }, { status: 500 });
  if (!settingsRow) return Response.json({ error: 'not found' }, { status: 404 });

  const data = settingsRow.data || {};
  if (!data.profile_public) {
    // Profile exists but the user hasn't toggled it public — surface as 404
    // so we don't leak the existence of private accounts.
    return Response.json({ error: 'not found' }, { status: 404 });
  }

  const userId = settingsRow.user_id;

  const profile = {
    handle: data.handle,
    display_name: data.display_name || null,
    bio:          data.bio          || null,
    avatar_url:   data.avatar_url   || null,
    banner_url:   data.banner_url   || null,
  };

  // Public notes (limit 100, newest first)
  const { data: notes } = await sb
    .from('notes')
    .select('id, title, content, project_tags, status, updated_at')
    .eq('user_id', userId)
    .eq('is_public', true)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(100);

  // Public trips with slim stops (lat/lng/label) so the profile page can
  // render mini-maps the same way the notes grid does.
  const { data: trips } = await sb
    .from('trips')
    .select('id, name, created_at, updated_at')
    .eq('user_id', userId)
    .eq('is_public', true)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(100);

  let stopsByTrip = {};
  if ((trips || []).length) {
    const ids = trips.map(t => t.id);
    const { data: stops } = await sb
      .from('trip_stops')
      .select('trip_id, lat, lng, label, date_time, profile_to_next, order_idx')
      .in('trip_id', ids)
      .order('order_idx', { ascending: true });
    for (const s of stops || []) (stopsByTrip[s.trip_id] ||= []).push(s);
  }
  const tripsOut = (trips || []).map(t => ({ ...t, stops: stopsByTrip[t.id] ?? [] }));

  // Public collections (place categories) + the places that fall under them.
  const { data: collections } = await sb
    .from('user_place_types')
    .select('id, name, color, position, is_public')
    .eq('user_id', userId)
    .eq('is_public', true)
    .order('position', { ascending: true });

  const publicCategoryNames = new Set((collections || []).map(c => c.name.toLowerCase()));
  let publicPlaces = [];
  if (publicCategoryNames.size > 0) {
    const { data: ps } = await sb
      .from('user_places')
      .select('id, name, lat, lng, category, color, notes')
      .eq('user_id', userId);
    publicPlaces = (ps || []).filter(p => publicCategoryNames.has((p.category || '').toLowerCase()));
  }

  return Response.json({
    profile,
    notes: notes ?? [],
    trips: tripsOut,
    collections: collections ?? [],
    places: publicPlaces,
  });
}
