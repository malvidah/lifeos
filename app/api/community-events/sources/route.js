import { withAuth } from '../../_lib/auth.js';

// GET  /api/community-events/sources         → list user's event sources
// POST /api/community-events/sources         → create a new source
// PATCH /api/community-events/sources        → update a source
// DELETE /api/community-events/sources?id=UUID → delete a source

export const GET = withAuth(async (req, { supabase, user }) => {
  const { data, error } = await supabase
    .from('event_sources')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;

  return Response.json({ sources: data ?? [] });
});

export const POST = withAuth(async (req, { supabase, user }) => {
  const body = await req.json();
  const {
    name, source_type, url = null, scraper_key = null,
    category = 'community', venue = null, lat = null, lng = null,
  } = body;

  if (!name || !source_type) {
    return Response.json({ error: 'name and source_type required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('event_sources')
    .insert({
      user_id: user.id,
      name, source_type, url, scraper_key,
      category, venue, lat, lng,
    })
    .select()
    .single();
  if (error) throw error;

  return Response.json({ source: data });
});

export const PATCH = withAuth(async (req, { supabase, user }) => {
  const { id, ...rest } = await req.json();
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const allowed = [
    'name', 'source_type', 'url', 'scraper_key',
    'category', 'venue', 'lat', 'lng', 'enabled',
  ];
  const patch = Object.fromEntries(
    Object.entries(rest).filter(([k]) => allowed.includes(k))
  );

  const { error } = await supabase
    .from('event_sources')
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
    .from('event_sources')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) throw error;

  return Response.json({ ok: true });
});
