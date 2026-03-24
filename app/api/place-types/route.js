import { withAuth } from '../_lib/auth.js';

// GET  /api/place-types           → all types for user
// POST /api/place-types           → create { name, color }
// POST /api/place-types?delete=ID → delete a type

export const GET = withAuth(async (req, { supabase, user }) => {
  const { data, error } = await supabase
    .from('user_place_types')
    .select('id, name, color, position')
    .eq('user_id', user.id)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return Response.json({ types: data ?? [] });
});

export const POST = withAuth(async (req, { supabase, user }) => {
  const { searchParams } = new URL(req.url);
  const deleteId = searchParams.get('delete');

  if (deleteId) {
    const { error } = await supabase
      .from('user_place_types')
      .delete()
      .eq('id', deleteId)
      .eq('user_id', user.id);
    if (error) throw error;
    return Response.json({ ok: true });
  }

  const { name, color } = await req.json();
  if (!name || !color) {
    return Response.json({ error: 'name and color required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('user_place_types')
    .upsert({ user_id: user.id, name: name.trim(), color }, { onConflict: 'user_id,name' })
    .select()
    .single();
  if (error) throw error;
  return Response.json({ type: data });
});
