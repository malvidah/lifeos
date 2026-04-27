// GET    /api/collections                  → list user's collections w/ counts
// POST   /api/collections                  → create  { name, color? }
// PATCH  /api/collections                  → update  { id, name?, color?, position?, is_public? }
// DELETE /api/collections?id=UUID          → delete (cascades the join rows)
//
// Collections are user-curated lists of places. Different from user_place_types
// (tags like "food" / "bars"). A place can belong to many collections.

import { withAuth } from '../_lib/auth.js';
import { isValidUuid } from '@/lib/validate.js';

export const GET = withAuth(async (_req, { supabase, user }) => {
  // Pull every collection + count of place memberships in one round-trip.
  const { data: collections, error } = await supabase
    .from('user_collections')
    .select('id, name, color, position, is_public, created_at, updated_at')
    .eq('user_id', user.id)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;

  const ids = (collections || []).map(c => c.id);
  let countByCollection = {};
  let placesByCollection = {};
  if (ids.length) {
    const { data: rows } = await supabase
      .from('user_collection_places')
      .select('collection_id, place_id')
      .in('collection_id', ids);
    for (const r of rows || []) {
      countByCollection[r.collection_id] = (countByCollection[r.collection_id] || 0) + 1;
      (placesByCollection[r.collection_id] ||= []).push(r.place_id);
    }
  }

  return Response.json({
    collections: (collections || []).map(c => ({
      ...c,
      place_count: countByCollection[c.id] || 0,
      place_ids:   placesByCollection[c.id] || [],
    })),
  });
});

export const POST = withAuth(async (req, { supabase, user }) => {
  const { name, color } = await req.json().catch(() => ({}));
  if (!name || typeof name !== 'string' || !name.trim()) {
    return Response.json({ error: 'name required' }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('user_collections')
    .insert({ user_id: user.id, name: name.trim(), color: color || null })
    .select('id, name, color, position, is_public, created_at, updated_at')
    .single();
  if (error) {
    if (error.code === '23505') return Response.json({ error: 'name taken' }, { status: 409 });
    throw error;
  }
  return Response.json({ collection: { ...data, place_count: 0, place_ids: [] } });
});

export const PATCH = withAuth(async (req, { supabase, user }) => {
  const { id, ...rest } = await req.json().catch(() => ({}));
  if (!id || !isValidUuid(id)) return Response.json({ error: 'valid id required' }, { status: 400 });

  const allowed = ['name', 'color', 'position', 'is_public'];
  const patch = Object.fromEntries(
    Object.entries(rest).filter(([k]) => allowed.includes(k))
  );
  if (patch.is_public !== undefined) patch.is_public = !!patch.is_public;
  if (Object.keys(patch).length === 0) {
    return Response.json({ error: 'no fields to update' }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('user_collections')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, name, color, position, is_public, updated_at')
    .single();
  if (error) throw error;
  return Response.json({ collection: data });
});

export const DELETE = withAuth(async (req, { supabase, user }) => {
  const id = new URL(req.url).searchParams.get('id');
  if (!id || !isValidUuid(id)) return Response.json({ error: 'valid id required' }, { status: 400 });
  const { error } = await supabase
    .from('user_collections')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) throw error;
  return Response.json({ ok: true });
});
