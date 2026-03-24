import { withAuth } from '../_lib/auth.js';

// GET /api/location?date=YYYY-MM-DD       → single location
// GET /api/location?start=...&end=...      → date range
// POST /api/location { date, lat, lng }    → upsert + reverse-geocode

export const GET = withAuth(async (req, { supabase, user }) => {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');
  const start = searchParams.get('start');
  const end = searchParams.get('end');

  if (date) {
    const { data, error } = await supabase
      .from('user_locations')
      .select('date, lat, lng, city, country')
      .eq('user_id', user.id)
      .eq('date', date)
      .maybeSingle();
    if (error) throw error;
    return Response.json({ location: data });
  }

  if (start && end) {
    const { data, error } = await supabase
      .from('user_locations')
      .select('date, lat, lng, city, country')
      .eq('user_id', user.id)
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: true });
    if (error) throw error;
    return Response.json({ locations: data ?? [] });
  }

  return Response.json({ error: 'date or start+end required' }, { status: 400 });
});

export const POST = withAuth(async (req, { supabase, user }) => {
  const { date, lat, lng } = await req.json();
  if (!date || lat == null || lng == null) {
    return Response.json({ error: 'date, lat, lng required' }, { status: 400 });
  }

  // Reverse geocode via Nominatim (free, no key)
  let city = null, country = null;
  try {
    const geoRes = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10`,
      { headers: { 'User-Agent': 'DayLab/1.0' } }
    );
    if (geoRes.ok) {
      const geo = await geoRes.json();
      city = geo.address?.city || geo.address?.town || geo.address?.village || geo.address?.county || null;
      country = geo.address?.country_code?.toUpperCase() || null;
    }
  } catch {}

  const { data, error } = await supabase
    .from('user_locations')
    .upsert({
      user_id: user.id,
      date,
      lat,
      lng,
      city,
      country,
    }, { onConflict: 'user_id,date' })
    .select('date, lat, lng, city, country')
    .single();

  if (error) throw error;
  return Response.json({ location: data });
});
