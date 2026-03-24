import { withAuth } from '../_lib/auth.js';

// GET  /api/discovered              → all discovered places (returns unique country list too)
// POST /api/discovered              → create { name, country, type?, lat?, lng? }
// POST /api/discovered?delete=ID    → delete a discovered place
// POST /api/discovered?deleteCountry=NAME → delete all entries for a country

export const GET = withAuth(async (req, { supabase, user }) => {
  const { data, error } = await supabase
    .from('user_discovered')
    .select('id, name, country, type, lat, lng, created_at')
    .eq('user_id', user.id)
    .order('country');
  if (error) throw error;
  const countries = [...new Set((data ?? []).map(d => d.country))];
  return Response.json({ discovered: data ?? [], countries });
});

export const POST = withAuth(async (req, { supabase, user }) => {
  const { searchParams } = new URL(req.url);
  const deleteId = searchParams.get('delete');
  const deleteCountry = searchParams.get('deleteCountry');

  if (deleteId) {
    const { error } = await supabase
      .from('user_discovered')
      .delete()
      .eq('id', deleteId)
      .eq('user_id', user.id);
    if (error) throw error;
    return Response.json({ ok: true });
  }

  if (deleteCountry) {
    const { error } = await supabase
      .from('user_discovered')
      .delete()
      .eq('country', deleteCountry)
      .eq('user_id', user.id);
    if (error) throw error;
    return Response.json({ ok: true });
  }

  const body = await req.json();
  const { name, country, type, lat, lng } = body;
  if (!name || !country) {
    return Response.json({ error: 'name and country required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('user_discovered')
    .insert({
      user_id: user.id,
      name, country,
      type: type || 'city',
      lat: lat ?? null,
      lng: lng ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return Response.json({ place: data });
});
