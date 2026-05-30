import { withAuth } from '../../_lib/auth.js';

const PORTLAND_SOURCES = [
  { name: 'Shift2Bikes', source_type: 'ical', url: 'https://shift2bikes.org/api/calendar.ics', category: 'outdoors', venue: null, lat: 45.5231, lng: -122.6765 },
  { name: '19hz Portland', source_type: 'scraper', scraper_key: '19hz', category: 'music', venue: null, lat: 45.5231, lng: -122.6765 },
  { name: 'OMSI', source_type: 'ical', url: 'https://www.omsi.edu/calendar/?ical=1', category: 'lectures', venue: 'OMSI', lat: 45.5084, lng: -122.6665 },
  { name: 'Literary Arts', source_type: 'scraper', scraper_key: 'literary-arts', category: 'lectures', venue: 'Literary Arts', lat: 45.5223, lng: -122.6812 },
  { name: 'ADX Portland', source_type: 'scraper', scraper_key: 'adx', category: 'art', venue: 'ADX Portland', lat: 45.5340, lng: -122.6555 },
  { name: 'Portland Rock Gym NE', source_type: 'scraper', scraper_key: 'prg', category: 'sports', venue: 'Portland Rock Gym NE', lat: 45.5558, lng: -122.6509 },
  { name: 'SCRAP PDX', source_type: 'scraper', scraper_key: 'scrap', category: 'art', venue: 'SCRAP PDX', lat: 45.5601, lng: -122.6488 },
  { name: 'River City Bicycles', source_type: 'scraper', scraper_key: 'rivercity', category: 'outdoors', venue: 'River City Bicycles', lat: 45.5049, lng: -122.6561 },
  { name: 'IPRC', source_type: 'scraper', scraper_key: 'iprc', category: 'art', venue: 'IPRC', lat: 45.5136, lng: -122.6572 },
  { name: "Powell's Books", source_type: 'scraper', scraper_key: 'powells', category: 'lectures', venue: "Powell's Books", lat: 45.5231, lng: -122.6814 },
  { name: 'Oregon Humanities', source_type: 'scraper', scraper_key: 'or-humanities', category: 'lectures', venue: 'Oregon Humanities', lat: 45.5209, lng: -122.6800 },
  { name: 'Holocene', source_type: 'scraper', scraper_key: 'holocene', category: 'music', venue: 'Holocene', lat: 45.5121, lng: -122.6567 },
  { name: 'Multnomah Arts Center', source_type: 'scraper', scraper_key: 'mac', category: 'art', venue: 'Multnomah Arts Center', lat: 45.4678, lng: -122.7118 },
  { name: 'Mazamas', source_type: 'scraper', scraper_key: 'mazamas', category: 'outdoors', venue: 'Mazamas', lat: 45.5109, lng: -122.6851 },
  { name: 'Woodstock Cafe', source_type: 'scraper', scraper_key: 'woodstock', category: 'community', venue: 'Woodstock Cafe', lat: 45.4792, lng: -122.6138 },
  { name: 'Reed College', source_type: 'scraper', scraper_key: 'reed', category: 'lectures', venue: 'Reed College', lat: 45.4790, lng: -122.6310 },
  { name: 'Norse Hall', source_type: 'scraper', scraper_key: 'norse-hall', category: 'community', venue: 'Norse Hall', lat: 45.5146, lng: -122.6530 },
  { name: 'The Redd', source_type: 'scraper', scraper_key: 'the-redd', category: 'food', venue: 'The Redd', lat: 45.5087, lng: -122.6681 },
  { name: 'NerdNite PDX', source_type: 'scraper', scraper_key: 'nerdnite', category: 'lectures', venue: null, lat: 45.5231, lng: -122.6765 },
  { name: "Jumbo's Pickleball", source_type: 'scraper', scraper_key: 'jumbos', category: 'sports', venue: "Jumbo's Pickleball", lat: 45.5231, lng: -122.6765 },
];

export const POST = withAuth(async (req, { supabase, user }) => {
  let added = 0;
  for (const src of PORTLAND_SOURCES) {
    const { data: existing } = await supabase
      .from('event_sources')
      .select('id')
      .eq('user_id', user.id)
      .eq('name', src.name)
      .maybeSingle();

    if (existing) continue;

    const { error } = await supabase
      .from('event_sources')
      .insert({ user_id: user.id, ...src });
    if (!error) added++;
  }

  return Response.json({ added, total: PORTLAND_SOURCES.length });
});
