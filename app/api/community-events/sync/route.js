import { withAuth } from '../../_lib/auth.js';
import { fetchIcalEvents, scrape19hz, lookupVenueCoords, geocodeAddress } from '../../../../lib/event-scrapers.js';

// POST /api/community-events/sync
// Body: { source_id?: string }  — sync one source, or all enabled sources if omitted

export const POST = withAuth(async (req, { supabase, user }) => {
  const body = await req.json().catch(() => ({}));
  const { source_id } = body;

  // Fetch sources to sync
  let query = supabase
    .from('event_sources')
    .select('*')
    .eq('user_id', user.id)
    .eq('enabled', true);

  if (source_id) {
    query = query.eq('id', source_id);
  }

  const { data: sources, error: srcErr } = await query;
  if (srcErr) throw srcErr;

  if (!sources || sources.length === 0) {
    return Response.json({ synced: 0, results: [] });
  }

  const results = [];

  for (const source of sources) {
    try {
      const result = await syncSource(supabase, user.id, source);
      results.push({ source_id: source.id, name: source.name, ...result });

      // Update last_synced_at
      await supabase
        .from('event_sources')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('id', source.id)
        .eq('user_id', user.id);
    } catch (err) {
      results.push({
        source_id: source.id,
        name: source.name,
        error: err.message,
        upserted: 0,
      });
    }
  }

  const totalUpserted = results.reduce((sum, r) => sum + (r.upserted || 0), 0);
  return Response.json({ synced: totalUpserted, results });
});

async function syncSource(supabase, userId, source) {
  switch (source.source_type) {
    case 'ical':
      return syncIcal(supabase, userId, source);
    case 'shift2bikes':
      return syncShift2Bikes(supabase, userId, source);
    case 'rss':
      return { upserted: 0, message: 'RSS sync not yet implemented' };
    case 'scraper':
      if (source.scraper_key === '19hz') return sync19hz(supabase, userId, source);
      return { upserted: 0, message: `Scraper '${source.scraper_key}' not yet implemented` };
    default:
      return { upserted: 0, message: `Unknown source_type: ${source.source_type}` };
  }
}

async function upsertEvent(supabase, row) {
  if (row.source_event_id) {
    const { data: existing } = await supabase
      .from('community_events')
      .select('id')
      .eq('user_id', row.user_id)
      .eq('source', row.source)
      .eq('source_event_id', row.source_event_id)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('community_events')
        .update(row)
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('community_events')
        .insert(row);
      if (error) throw error;
    }
  } else {
    const { error } = await supabase
      .from('community_events')
      .insert(row);
    if (error) throw error;
  }
}

async function syncIcal(supabase, userId, source) {
  if (!source.url) throw new Error('iCal source has no URL');

  const events = await fetchIcalEvents(source.url);
  let upserted = 0;

  for (const evt of events) {
    if (!evt.starts_at) continue;

    const location = evt.location || source.venue || null;
    const geo = lookupVenueCoords(location, null);

    const row = {
      user_id: userId,
      source: source.name,
      source_url: evt.url || source.url,
      source_event_id: evt.uid || null,
      title: evt.title,
      description: evt.description,
      venue: location,
      lat: geo?.lat || source.lat || null,
      lng: geo?.lng || source.lng || null,
      category: source.category || 'community',
      starts_at: evt.starts_at,
      ends_at: evt.ends_at,
      tags: [],
      updated_at: new Date().toISOString(),
    };

    await upsertEvent(supabase, row);
    upserted++;
  }

  return { upserted };
}

async function syncShift2Bikes(supabase, userId, source) {
  if (!source.url) throw new Error('Shift2Bikes source has no URL');

  const now = new Date();
  const startdate = now.toISOString().slice(0, 10);
  const enddate = new Date(now.getTime() + 90 * 86400000).toISOString().slice(0, 10);

  const res = await fetch(`${source.url}?startdate=${startdate}&enddate=${enddate}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Shift2Bikes API error: ${res.status}`);
  const data = await res.json();
  const events = data.events || [];
  let upserted = 0;

  for (const evt of events) {
    if (!evt.date || !evt.title) continue;

    const tz = '-07:00';
    const startsAt = evt.time
      ? `${evt.date}T${evt.time}${tz}`
      : `${evt.date}T00:00:00${tz}`;
    const endsAt = evt.endtime
      ? `${evt.date}T${evt.endtime}${tz}`
      : null;

    const venueName = evt.venue || source.venue || null;
    const geo = lookupVenueCoords(venueName, evt.address);

    const row = {
      user_id: userId,
      source: source.name,
      source_url: evt.shareable || source.url,
      source_event_id: evt.caldaily_id || evt.id || null,
      title: evt.title,
      description: evt.details || null,
      venue: venueName,
      address: evt.address || null,
      lat: geo?.lat || source.lat || null,
      lng: geo?.lng || source.lng || null,
      category: source.category || 'outdoors',
      starts_at: startsAt,
      ends_at: endsAt,
      cost: evt.cost || null,
      tags: [],
      updated_at: new Date().toISOString(),
    };

    await upsertEvent(supabase, row);
    upserted++;
  }

  return { upserted };
}

async function sync19hz(supabase, userId, source) {
  const events = await scrape19hz();
  let upserted = 0;

  for (const evt of events) {
    if (!evt.starts_at || !evt.title) continue;

    const geo = lookupVenueCoords(evt.venue, evt.address);

    const row = {
      user_id: userId,
      source: source.name,
      source_url: evt.url || null,
      source_event_id: evt.uid || null,
      title: evt.title,
      venue: evt.venue || null,
      address: evt.address || null,
      lat: geo?.lat || source.lat || null,
      lng: geo?.lng || source.lng || null,
      category: 'music',
      starts_at: evt.starts_at,
      cost: evt.cost || null,
      tags: [],
      updated_at: new Date().toISOString(),
    };

    await upsertEvent(supabase, row);
    upserted++;
  }

  return { upserted };
}
