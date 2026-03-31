import { withAuth } from '../_lib/auth.js';

// GET /api/drawings          → list all drawings (id, title, thumbnail only — no strokes)
// GET /api/drawings?id=UUID  → single drawing with full strokes
// POST /api/drawings         → create  { title?, strokes?, thumbnail? }
// PATCH /api/drawings        → update  { id, title?, strokes?, thumbnail? }
// DELETE /api/drawings?id=UUID → soft delete

export const GET = withAuth(async (req, { supabase, user }) => {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (id) {
    const { data, error } = await supabase
      .from('drawings')
      .select('id, title, strokes, thumbnail, created_at, updated_at')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return Response.json({ drawing: data });
  }

  // List: omit strokes (potentially large) for the selector strip
  const { data, error } = await supabase
    .from('drawings')
    .select('id, title, thumbnail, created_at, updated_at')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return Response.json({ drawings: data ?? [] });
});

export const POST = withAuth(async (req, { supabase, user }) => {
  const { title = 'Untitled', strokes = [], thumbnail = null } = await req.json();

  const { data, error } = await supabase
    .from('drawings')
    .insert({ user_id: user.id, title, strokes, thumbnail })
    .select('id, title, thumbnail, created_at, updated_at')
    .single();
  if (error) throw error;
  return Response.json({ drawing: data });
});

export const PATCH = withAuth(async (req, { supabase, user }) => {
  const body = await req.json();
  const { id, ...rest } = body;
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const patch = {};
  if (rest.title     !== undefined) patch.title     = rest.title;
  if (rest.strokes   !== undefined) patch.strokes   = rest.strokes;
  if (rest.thumbnail !== undefined) patch.thumbnail = rest.thumbnail;

  const { data, error } = await supabase
    .from('drawings')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .select('id, title, thumbnail, updated_at')
    .single();
  if (error) throw error;
  return Response.json({ drawing: data });
});

export const DELETE = withAuth(async (req, { supabase, user }) => {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabase
    .from('drawings')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) throw error;
  return Response.json({ ok: true });
});
