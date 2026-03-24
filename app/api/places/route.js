import { withAuth } from '../_lib/auth.js';

// GET  /api/places          → all saved places
// POST /api/places          → create { lat, lng, name, category?, notes?, color? }
// POST /api/places?delete=ID → delete a place

export const GET = withAuth(async (req, { supabase, user }) => {
  const { data, error } = await supabase
    .from('user_places')
    .select('id, lat, lng, name, category, notes, color, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return Response.json({ places: data ?? [] });
});

export const POST = withAuth(async (req, { supabase, user }) => {
  const { searchParams } = new URL(req.url);
  const deleteId = searchParams.get('delete');

  if (deleteId) {
    const { error } = await supabase
      .from('user_places')
      .delete()
      .eq('id', deleteId)
      .eq('user_id', user.id);
    if (error) throw error;
    return Response.json({ ok: true });
  }

  const body = await req.json();
  const { lat, lng, name, category, notes, color } = body;
  if (lat == null || lng == null || !name) {
    return Response.json({ error: 'lat, lng, name required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('user_places')
    .insert({
      user_id: user.id,
      lat, lng, name,
      category: category || 'pin',
      notes: notes || null,
      color: color || null,
    })
    .select()
    .single();
  if (error) throw error;
  return Response.json({ place: data });
});
