import { withAuth } from '../_lib/auth.js';

// GET /api/community-events?start=ISO&end=ISO[&category=music]
// POST /api/community-events  { title, starts_at, ... }  (manual event)
// PATCH /api/community-events { id, ...fields }
// DELETE /api/community-events?id=UUID

export const GET = withAuth(async (req, { supabase, user }) => {
  const { searchParams } = new URL(req.url);
  const start    = searchParams.get('start');
  const end      = searchParams.get('end');
  const category = searchParams.get('category');

  if (!start || !end) {
    return Response.json({ error: 'start and end required' }, { status: 400 });
  }

  let query = supabase
    .from('community_events')
    .select('*')
    .eq('user_id', user.id)
    .gte('starts_at', start)
    .lte('starts_at', end);

  if (category) {
    query = query.eq('category', category);
  }

  const { data, error } = await query.order('starts_at', { ascending: true });
  if (error) throw error;

  return Response.json({ events: data ?? [] });
});

export const POST = withAuth(async (req, { supabase, user }) => {
  const body = await req.json();
  const {
    title, description = null, venue = null, address = null,
    lat = null, lng = null, category = 'other',
    starts_at, ends_at = null, cost = null, image_url = null,
    tags = [], source_url = null,
  } = body;

  if (!title || !starts_at) {
    return Response.json({ error: 'title and starts_at required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('community_events')
    .insert({
      user_id: user.id,
      source: 'manual',
      source_url,
      title, description, venue, address, lat, lng,
      category, starts_at, ends_at, cost, image_url, tags,
    })
    .select()
    .single();
  if (error) throw error;

  return Response.json({ event: data });
});

export const PATCH = withAuth(async (req, { supabase, user }) => {
  const { id, ...rest } = await req.json();
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const allowed = [
    'title', 'description', 'venue', 'address', 'lat', 'lng',
    'category', 'starts_at', 'ends_at', 'cost', 'image_url', 'tags',
    'source_url',
  ];
  const patch = Object.fromEntries(
    Object.entries(rest).filter(([k]) => allowed.includes(k))
  );
  patch.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from('community_events')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) throw error;

  return Response.json({ ok: true });
});

export const DELETE = withAuth(async (req, { supabase, user }) => {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabase
    .from('community_events')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) throw error;

  return Response.json({ ok: true });
});
