// POST   /api/collections/places  → add a place to a collection { collection_id, place_id }
// DELETE /api/collections/places?collection_id=...&place_id=...
//
// RLS on user_collection_places enforces that the caller must own the
// collection — the join row fails to insert/delete otherwise.

import { withAuth } from '../../_lib/auth.js';
import { isValidUuid } from '@/lib/validate.js';

export const POST = withAuth(async (req, { supabase }) => {
  const { collection_id, place_id } = await req.json().catch(() => ({}));
  if (!collection_id || !isValidUuid(collection_id) || !place_id || !isValidUuid(place_id)) {
    return Response.json({ error: 'collection_id and place_id required' }, { status: 400 });
  }
  const { error } = await supabase
    .from('user_collection_places')
    .upsert({ collection_id, place_id }, { onConflict: 'collection_id,place_id', ignoreDuplicates: true });
  if (error) throw error;
  return Response.json({ ok: true });
});

export const DELETE = withAuth(async (req, { supabase }) => {
  const url = new URL(req.url);
  const collection_id = url.searchParams.get('collection_id');
  const place_id      = url.searchParams.get('place_id');
  if (!collection_id || !isValidUuid(collection_id) || !place_id || !isValidUuid(place_id)) {
    return Response.json({ error: 'collection_id and place_id required' }, { status: 400 });
  }
  const { error } = await supabase
    .from('user_collection_places')
    .delete()
    .eq('collection_id', collection_id)
    .eq('place_id', place_id);
  if (error) throw error;
  return Response.json({ ok: true });
});
