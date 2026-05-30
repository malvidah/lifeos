import { withAuth } from '../../_lib/auth.js';
import { fetchIcalEvents } from '../../../../lib/event-scrapers.js';

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
      return { upserted: 0, message: `Scraper '${source.scraper_key}' not yet implemented` };
    default:
      return { upserted: 0, message: `Unknown source_type: ${source.source_type}` };
  }
}

async function syncIcal(supabase, userId, source) {
  if (!source.url) throw new Error('iCal source has no URL');

  const events = await fetchIcalEvents(source.url);
  let upserted = 0;

  for (const evt of events) {
    if (!evt.starts_at) continue;

    const row = {
      user_id: userId,
      source: source.name,
      source_url: evt.url || source.url,
      source_event_id: evt.uid || null,
      title: evt.title,
      description: evt.description,
      venue: evt.location || source.venue || null,
      lat: source.lat || null,
      lng: source.lng || null,
      category: source.category || 'community',
      starts_at: evt.starts_at,
      ends_at: evt.ends_at,
      tags: [],
      updated_at: new Date().toISOString(),
    };

    // Upsert by dedup key if we have a source_event_id, otherwise just insert
    if (row.source_event_id) {
      const { error } = await supabase
        .from('community_events')
        .upsert(row, { onConflict: 'user_id,source,source_event_id' });
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('community_events')
        .insert(row);
      if (error) throw error;
    }
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

    const startsAt = evt.time
      ? `${evt.date}T${evt.time}`
      : `${evt.date}T00:00:00`;
    const endsAt = evt.endtime
      ? `${evt.date}T${evt.endtime}`
      : null;

    const row = {
      user_id: userId,
      source: source.name,
      source_url: evt.shareable || source.url,
      source_event_id: evt.caldaily_id || evt.id || null,
      title: evt.title,
      description: evt.details || null,
      venue: evt.venue || source.venue || null,
      address: evt.address || null,
      lat: source.lat || null,
      lng: source.lng || null,
      category: source.category || 'outdoors',
      starts_at: startsAt,
      ends_at: endsAt,
      cost: evt.cost || null,
      tags: [],
      updated_at: new Date().toISOString(),
    };

    if (row.source_event_id) {
      const { error } = await supabase
        .from('community_events')
        .upsert(row, { onConflict: 'user_id,source,source_event_id' });
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('community_events')
        .insert(row);
      if (error) throw error;
    }
    upserted++;
  }

  return { upserted };
}
