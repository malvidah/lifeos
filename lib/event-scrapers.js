// ─── Portland venue coordinate lookup ────────────────────────────────────────
// Hardcoded coords for known Portland-area venues to avoid geocoding API calls.
// Keys are lowercase venue names; values are { lat, lng }.

const PORTLAND_VENUES = {
  // Parks
  'oregon park': { lat: 45.5050, lng: -122.6190 },
  'irving park': { lat: 45.5487, lng: -122.6509 },
  'iriving park': { lat: 45.5487, lng: -122.6509 },
  'laurelhurst park': { lat: 45.5196, lng: -122.6269 },
  'laurelhurst': { lat: 45.5196, lng: -122.6269 },
  'larelhurst park': { lat: 45.5196, lng: -122.6269 },
  'laurelhurst park picnic area': { lat: 45.5196, lng: -122.6269 },
  'wilshire park': { lat: 45.5580, lng: -122.6266 },
  'colonel summers park': { lat: 45.5142, lng: -122.6470 },
  'colonel summers': { lat: 45.5142, lng: -122.6470 },
  "colonel summer's park": { lat: 45.5142, lng: -122.6470 },
  'col summers park': { lat: 45.5142, lng: -122.6470 },
  'col sums park': { lat: 45.5142, lng: -122.6470 },
  'col. summers park': { lat: 45.5142, lng: -122.6470 },
  'grant park': { lat: 45.5375, lng: -122.6332 },
  'grants park this week': { lat: 45.5050, lng: -122.6420 },
  'peninsula park': { lat: 45.5696, lng: -122.6742 },
  'peninsula park rose fountain': { lat: 45.5696, lng: -122.6742 },
  'holladay park': { lat: 45.5297, lng: -122.6563 },
  'sewallcrest park': { lat: 45.5064, lng: -122.6332 },
  'sewall crest park': { lat: 45.5064, lng: -122.6332 },
  'seawall crest park': { lat: 45.5064, lng: -122.6332 },
  'elizabeth caruthers park': { lat: 45.5052, lng: -122.6717 },
  'kenilworth park': { lat: 45.4920, lng: -122.6332 },
  'overlook park': { lat: 45.5596, lng: -122.6834 },
  'woodstock park': { lat: 45.4803, lng: -122.6095 },
  'sellwood riverfront park': { lat: 45.4633, lng: -122.6583 },
  'sellwood park': { lat: 45.4626, lng: -122.6508 },
  'fernhill park': { lat: 45.5642, lng: -122.6266 },
  'the fields park': { lat: 45.5316, lng: -122.6857 },
  'normandale park': { lat: 45.5254, lng: -122.6095 },
  'jamison square': { lat: 45.5299, lng: -122.6838 },
  'kenton park': { lat: 45.5827, lng: -122.6861 },
  'kenton park splash pad': { lat: 45.5827, lng: -122.6861 },
  'alberta park': { lat: 45.5726, lng: -122.6510 },
  'alberta park bike polo court': { lat: 45.5726, lng: -122.6510 },
  'creston park': { lat: 45.4891, lng: -122.6150 },
  'brentwood park': { lat: 45.4775, lng: -122.6095 },
  'clinton park': { lat: 45.4965, lng: -122.6083 },
  'columbia park': { lat: 45.5764, lng: -122.6887 },
  'columbia park playground': { lat: 45.5764, lng: -122.6887 },
  'coe circle': { lat: 45.5242, lng: -122.6067 },
  'lents park': { lat: 45.4787, lng: -122.5802 },
  'piccolo park': { lat: 45.5039, lng: -122.6414 },
  'fulton park': { lat: 45.4660, lng: -122.6768 },
  'wallace park': { lat: 45.5328, lng: -122.6978 },
  'pittman hydro park': { lat: 45.5647, lng: -122.6883 },
  'glenhaven park': { lat: 45.5454, lng: -122.6030 },
  'northgate park splash pad': { lat: 45.5870, lng: -122.6720 },
  'mt tabor park': { lat: 45.5093, lng: -122.5932 },
  'mount tabor park (east picnic area or picnic area b)': { lat: 45.5093, lng: -122.5932 },
  'mt. tabor bridge view': { lat: 45.5093, lng: -122.5932 },
  'parklane park': { lat: 45.5156, lng: -122.5345 },
  'patton square city park - north maryland avenue': { lat: 45.5656, lng: -122.6795 },
  'ed benedict park (tot lot)': { lat: 45.4845, lng: -122.5663 },
  'lovejoy fountain park': { lat: 45.5099, lng: -122.6872 },
  'hall pond (the big square \'pond\' in the park)': { lat: 45.4858, lng: -122.6397 },
  'lillis albina park': { lat: 45.5496, lng: -122.6677 },
  'mill ends park': { lat: 45.5150, lng: -122.6730 },

  // Ladd's Addition variants
  'ladds addition': { lat: 45.5093, lng: -122.6504 },
  "ladd's addition": { lat: 45.5093, lng: -122.6504 },
  'ladds circle': { lat: 45.5093, lng: -122.6504 },
  "ladd's circle": { lat: 45.5093, lng: -122.6504 },
  "ladd's circle (the big circle!)": { lat: 45.5093, lng: -122.6504 },
  'ladds circle park': { lat: 45.5093, lng: -122.6504 },
  'ladd circle park': { lat: 45.5093, lng: -122.6504 },
  "ladd's addition circle": { lat: 45.5093, lng: -122.6504 },
  'ladds circle park and rose garden': { lat: 45.5093, lng: -122.6504 },
  "ladd's addition center park": { lat: 45.5093, lng: -122.6504 },
  'inside ladd circle': { lat: 45.5093, lng: -122.6504 },

  // Landmarks & plazas
  'salmon street springs': { lat: 45.5148, lng: -122.6724 },
  'gather at salmon street springs': { lat: 45.5148, lng: -122.6724 },
  'vera katz statue': { lat: 45.5139, lng: -122.6682 },
  'vera katz statue. (v.k.s.)': { lat: 45.5139, lng: -122.6682 },
  'vera catz statue at the east bank esplanade.': { lat: 45.5139, lng: -122.6682 },
  'vera kats statue': { lat: 45.5139, lng: -122.6682 },
  'eastbank esplanade': { lat: 45.5258, lng: -122.6657 },
  'blumenauer bridge': { lat: 45.5297, lng: -122.6598 },
  'the zoobomb pyle': { lat: 45.5150, lng: -122.6858 },
  'paul bunyan plaza in kenton': { lat: 45.5826, lng: -122.6918 },
  'ankeny rainbow plaza': { lat: 45.5155, lng: -122.6370 },
  'ankeny rainbow road': { lat: 45.5155, lng: -122.6370 },
  'ankeny rainbow road plaza': { lat: 45.5155, lng: -122.6370 },
  'rainbow road': { lat: 45.5155, lng: -122.6370 },
  'rainbow road street plaza': { lat: 45.5155, lng: -122.6370 },
  'electric blocks': { lat: 45.5079, lng: -122.6607 },
  'taylor electric building': { lat: 45.5079, lng: -122.6607 },
  'red balloon sculpture': { lat: 45.5056, lng: -122.6679 },
  'keep portland weird sign': { lat: 45.5225, lng: -122.6820 },
  'montavilla plaza': { lat: 45.5184, lng: -122.5800 },
  'hawthorne plaza': { lat: 45.5119, lng: -122.6218 },
  'omsi plaza': { lat: 45.5084, lng: -122.6665 },
  'universal plaza': { lat: 45.4514, lng: -122.7799 },
  'poets beach': { lat: 45.5068, lng: -122.6754 },
  'south waterfront park': { lat: 45.5026, lng: -122.6717 },
  'south waterfront and eastbank esplanade': { lat: 45.5060, lng: -122.6710 },
  'lone fir cemetery': { lat: 45.5172, lng: -122.6433 },

  // Bars, restaurants, cafes
  'bar botellon': { lat: 45.5236, lng: -122.6598 },
  'bar botellon  -  606 ne davis': { lat: 45.5236, lng: -122.6598 },
  'gorges beer co.': { lat: 45.5150, lng: -122.6380 },
  'migration brewing on north williams': { lat: 45.5530, lng: -122.6670 },
  'migration brewing': { lat: 45.5530, lng: -122.6670 },
  'migration brewery': { lat: 45.5530, lng: -122.6670 },
  'awaydays': { lat: 45.4988, lng: -122.6456 },
  'cooper mountain ale works': { lat: 45.4309, lng: -122.7879 },
  'prime tap house (tanasbourne)': { lat: 45.5321, lng: -122.8546 },
  'ground breaker brewing': { lat: 45.5108, lng: -122.6603 },
  'bull run pizza': { lat: 45.5224, lng: -122.6366 },
  'crema coffee': { lat: 45.5155, lng: -122.6370 },
  'stacks coffeehouse': { lat: 45.5691, lng: -122.6745 },
  'caffe destino': { lat: 45.5472, lng: -122.6522 },
  'foster food carts': { lat: 45.4862, lng: -122.6014 },
  'bgs food cartel': { lat: 45.4882, lng: -122.8010 },
  'good neighbor pizza': { lat: 45.5746, lng: -122.6729 },
  'the beermongers': { lat: 45.5100, lng: -122.6563 },
  'threshold brewing & blending': { lat: 45.5132, lng: -122.5836 },
  'la perlita': { lat: 45.5656, lng: -122.6803 },
  'pizza jerk ne': { lat: 45.5564, lng: -122.6178 },
  'water avenue coffee': { lat: 45.5076, lng: -122.6650 },
  'fleur de lis bakery & cafe': { lat: 45.5373, lng: -122.6192 },
  'nossa famila coffee': { lat: 45.5048, lng: -122.6530 },
  'plaid pantry': { lat: 45.5720, lng: -122.6810 },
  'two point inn': { lat: 45.5765, lng: -122.7053 },
  'flipside bar and carts': { lat: 45.4759, lng: -122.6148 },
  'rhinestone': { lat: 45.5039, lng: -122.6467 },
  "holman's (aka hello inn)": { lat: 45.5161, lng: -122.6366 },
  'hawthorne ayslum food carts': { lat: 45.5143, lng: -122.6574 },
  'hopscotch portland': { lat: 45.5143, lng: -122.6574 },
  'arborlook food carts start and finish': { lat: 45.5732, lng: -122.6810 },
  'pod 28': { lat: 45.5155, lng: -122.6366 },

  // Bike shops & cycling
  'river city bicycles': { lat: 45.5129, lng: -122.6608 },
  'river city bikes': { lat: 45.5129, lng: -122.6608 },
  'splendid cycles': { lat: 45.5067, lng: -122.6563 },
  'tomcat bikes': { lat: 45.5028, lng: -122.6575 },
  'nomad cycles': { lat: 45.5541, lng: -122.6195 },
  'a convenient cycle': { lat: 45.5095, lng: -122.6600 },
  'bike farm': { lat: 45.5429, lng: -122.6619 },
  'bikes4humanity': { lat: 45.4975, lng: -122.6518 },
  'something cycles': { lat: 45.5227, lng: -122.6575 },
  'upcycles pdx': { lat: 45.5612, lng: -122.6496 },
  'adaptive biketown': { lat: 45.5076, lng: -122.6607 },
  'adaptiave biketown': { lat: 45.5076, lng: -122.6607 },
  'trek bicycle portland slabtown': { lat: 45.5339, lng: -122.6929 },
  'go by bike': { lat: 45.5043, lng: -122.6715 },
  'cycle oregon headquarters': { lat: 45.5095, lng: -122.6600 },

  // Venues from seed sources
  'omsi': { lat: 45.5084, lng: -122.6665 },
  "powell's books": { lat: 45.5231, lng: -122.6814 },
  'literary arts': { lat: 45.5223, lng: -122.6812 },
  'adx portland': { lat: 45.5340, lng: -122.6555 },
  'portland rock gym ne': { lat: 45.5558, lng: -122.6509 },
  'scrap pdx': { lat: 45.5601, lng: -122.6488 },
  'iprc': { lat: 45.5136, lng: -122.6572 },
  'oregon humanities': { lat: 45.5209, lng: -122.6800 },
  'holocene': { lat: 45.5121, lng: -122.6567 },
  'multnomah arts center': { lat: 45.4678, lng: -122.7118 },
  'mazamas': { lat: 45.5109, lng: -122.6851 },
  'woodstock cafe': { lat: 45.4792, lng: -122.6138 },
  'reed college': { lat: 45.4790, lng: -122.6310 },
  'norse hall': { lat: 45.5146, lng: -122.6530 },
  'the redd': { lat: 45.5087, lng: -122.6681 },
  "jumbo's pickleball": { lat: 45.5231, lng: -122.6765 },

  // Music venues (for 19hz scraper)
  'doug fir lounge': { lat: 45.5139, lng: -122.6530 },
  'revolution hall': { lat: 45.5159, lng: -122.6491 },
  'mississippi studios': { lat: 45.5530, lng: -122.6753 },
  'crystal ballroom': { lat: 45.5228, lng: -122.6850 },
  'roseland theater': { lat: 45.5232, lng: -122.6832 },
  'aladdin theater': { lat: 45.5044, lng: -122.6563 },
  'wonder ballroom': { lat: 45.5627, lng: -122.6655 },
  'alberta rose theatre': { lat: 45.5623, lng: -122.6387 },
  'star theater': { lat: 45.5248, lng: -122.6834 },
  'hawthorne theatre': { lat: 45.5119, lng: -122.6149 },
  "dante's": { lat: 45.5232, lng: -122.6816 },
  "kelly's olympian": { lat: 45.5218, lng: -122.6773 },
  'turn turn turn': { lat: 45.5602, lng: -122.6665 },
  'polaris hall': { lat: 45.5630, lng: -122.6720 },
  'bossanova ballroom': { lat: 45.5137, lng: -122.6555 },
  'the goodfoot': { lat: 45.5100, lng: -122.6478 },
  'jack london revue': { lat: 45.5223, lng: -122.6811 },
  'no fun bar': { lat: 45.5060, lng: -122.6546 },
  'valentines': { lat: 45.5172, lng: -122.6533 },
  'the liquor store': { lat: 45.5239, lng: -122.6836 },

  // Schools
  'abernethy elementary': { lat: 45.5050, lng: -122.6420 },
  'abernethy elementary school': { lat: 45.5050, lng: -122.6420 },
  'abernathy elementary': { lat: 45.5050, lng: -122.6420 },
  'abernathy elementary school': { lat: 45.5050, lng: -122.6420 },
  'abernethy elementary, basketball courts': { lat: 45.5050, lng: -122.6420 },
  'abernethy school': { lat: 45.5050, lng: -122.6420 },
  'buckman elementary playground blacktop': { lat: 45.5148, lng: -122.6487 },
  'irvington elementary school playground': { lat: 45.5429, lng: -122.6490 },
  'lewis elementary': { lat: 45.4891, lng: -122.6145 },
  'peninsula elementary school': { lat: 45.5810, lng: -122.6749 },
  'university of portland': { lat: 45.5722, lng: -122.7259 },
  'creston elementary basketball courts': { lat: 45.4891, lng: -122.6150 },

  // Transit
  'beaverton transit center': { lat: 45.4907, lng: -122.8024 },
  'beaverton transit cener': { lat: 45.4907, lng: -122.8024 },
  'goose hollow max station': { lat: 45.5139, lng: -122.6887 },
  'sunset transit centre': { lat: 45.5099, lng: -122.7810 },
  'beaverton central max': { lat: 45.4916, lng: -122.8107 },
  'parkrose transit center': { lat: 45.5492, lng: -122.5611 },
  'gresham transit center': { lat: 45.5029, lng: -122.4338 },
  'mt hood ave max station': { lat: 45.5316, lng: -122.5632 },

  // Other notable venues
  'sidestreet arts (art gallery)': { lat: 45.5161, lng: -122.6366 },
  'sidestreet arts': { lat: 45.5161, lng: -122.6366 },
  'rose city coffee co.': { lat: 45.5028, lng: -122.6575 },
  'gregory heights library': { lat: 45.5548, lng: -122.5927 },
  'albina library': { lat: 45.5405, lng: -122.6710 },
  'moore alley': { lat: 45.5039, lng: -122.6235 },
  'mix tape vintage': { lat: 45.5161, lng: -122.6332 },
  'rose city park methodist church': { lat: 45.5412, lng: -122.6131 },
  'portland stake tabernacle church': { lat: 45.5064, lng: -122.6342 },
  "the people's yoga se hawthorne": { lat: 45.5119, lng: -122.6204 },
  'paper epiphanies': { lat: 45.5039, lng: -122.6432 },
  'milk glass mrkt': { lat: 45.5691, lng: -122.6737 },
  'twentysix cafe': { lat: 45.5429, lng: -122.6573 },
  'rose city golf club': { lat: 45.5470, lng: -122.5912 },
  'franz bakery': { lat: 45.5326, lng: -122.6528 },
  'portland farmers market @ psu': { lat: 45.5113, lng: -122.6827 },
  'psu farmers market': { lat: 45.5113, lng: -122.6827 },
  "mocks crest/skidmore bluffs": { lat: 45.5669, lng: -122.6887 },
  "mock's skidmore bluffcrest": { lat: 45.5669, lng: -122.6887 },
  'mocks crest park': { lat: 45.5669, lng: -122.6887 },
  'n jessup and n omaha ave treeway': { lat: 45.5672, lng: -122.6755 },
  'harry a merlo field': { lat: 45.5722, lng: -122.7259 },

  // Greenways & routes
  'clinton neighborhood greenway': { lat: 45.5017, lng: -122.6185 },
  'the hill': { lat: 45.4727, lng: -122.6109 },
  'top of the hill': { lat: 45.4727, lng: -122.6109 },
  'springwater solstice bike rave': { lat: 45.5067, lng: -122.6563 },
};

/**
 * Look up coordinates for a Portland-area venue.
 * Tries exact match on venue name, then on address keywords.
 * Returns { lat, lng } or null.
 */
export function lookupVenueCoords(venue, address) {
  if (venue) {
    const key = venue.toLowerCase().trim();
    if (PORTLAND_VENUES[key]) return PORTLAND_VENUES[key];
    for (const [k, v] of Object.entries(PORTLAND_VENUES)) {
      if (key.includes(k) || k.includes(key)) return v;
    }
  }
  if (address) {
    const addrKey = address.toLowerCase().trim();
    for (const [k, v] of Object.entries(PORTLAND_VENUES)) {
      if (addrKey.includes(k)) return v;
    }
  }
  return null;
}

// ─── Geocoding (fallback for non-Portland or unknown venues) ─────────────────

const geocodeCache = new Map();

export async function geocodeAddress(address) {
  if (!address) return null;
  const key = address.toLowerCase().trim();
  if (geocodeCache.has(key)) return geocodeCache.get(key);

  try {
    const q = encodeURIComponent(address.replace(/\s+/g, ' ').trim());
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=us`,
      {
        headers: { 'User-Agent': 'DayLab/1.0 (community-events)' },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) { geocodeCache.set(key, null); return null; }
    const data = await res.json();
    if (data.length > 0) {
      const result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      geocodeCache.set(key, result);
      await new Promise(r => setTimeout(r, 600));
      return result;
    }
  } catch {}
  geocodeCache.set(key, null);
  return null;
}

// ─── iCal / event-source parsing helpers ──────────────────────────────────────

/**
 * Parse an iCal DTSTART/DTEND value into an ISO string.
 * Handles: 20260530T190000Z, 20260530T190000, TZID=America/Los_Angeles:20260530T190000, 20260530
 */
function parseIcalDate(value) {
  if (!value) return null;

  // Strip any TZID prefix (e.g. "TZID=America/Los_Angeles:20260530T190000")
  const colonIdx = value.indexOf(':');
  const raw = colonIdx > -1 && !value.startsWith('http') ? value.slice(colonIdx + 1) : value;

  // Basic format: YYYYMMDD or YYYYMMDDTHHmmss or YYYYMMDDTHHmmssZ
  const cleaned = raw.replace(/[^0-9TZ]/g, '');
  if (cleaned.length === 8) {
    // Date only: YYYYMMDD
    const y = cleaned.slice(0, 4);
    const m = cleaned.slice(4, 6);
    const d = cleaned.slice(6, 8);
    return `${y}-${m}-${d}T00:00:00Z`;
  }

  // YYYYMMDDTHHmmss or YYYYMMDDTHHmmssZ
  const match = cleaned.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!match) return null;

  const [, y, mo, d, h, mi, s, z] = match;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${z || 'Z'}`;
}

/**
 * Unfold iCal continuation lines (lines starting with a space or tab are
 * continuations of the previous line).
 */
function unfold(text) {
  return text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}

/**
 * Unescape iCal text values: \\n → newline, \\, → comma, \\\\ → backslash.
 */
function unescapeIcal(value) {
  if (!value) return value;
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\\\/g, '\\');
}

/**
 * Parse iCal text into an array of event objects.
 * Returns: [{ title, description, starts_at, ends_at, location, url }]
 */
export function parseIcal(text) {
  const unfolded = unfold(text);
  const events = [];

  // Split into VEVENT blocks
  const blocks = unfolded.split('BEGIN:VEVENT');
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].split('END:VEVENT')[0];
    if (!block) continue;

    const lines = block.split(/\r?\n/);
    const props = {};

    for (const line of lines) {
      // Match property name (possibly with params) and value
      const m = line.match(/^([A-Z][A-Z0-9_-]*)(;[^:]*)?:(.*)/);
      if (!m) continue;
      const [, name, params, value] = m;
      const key = name.toUpperCase();

      // For DTSTART/DTEND, include params (may contain TZID)
      if (key === 'DTSTART' || key === 'DTEND') {
        props[key] = params ? `${params}:${value}` : value;
      } else if (!props[key]) {
        props[key] = value;
      }
    }

    const title = unescapeIcal(props.SUMMARY || '').trim();
    if (!title && !props.DTSTART) continue;

    events.push({
      title: title || '(untitled)',
      description: unescapeIcal(props.DESCRIPTION || '') || null,
      starts_at: parseIcalDate(props.DTSTART),
      ends_at: parseIcalDate(props.DTEND) || null,
      location: unescapeIcal(props.LOCATION || '') || null,
      url: (props.URL || '').trim() || null,
      uid: (props.UID || '').trim() || null,
    });
  }

  return events;
}

/**
 * Scrape 19hz.info PNW event listing for Portland events.
 * Returns: [{ title, starts_at, venue, address, cost, url, uid }]
 */
export async function scrape19hz() {
  const res = await fetch('https://19hz.info/eventlisting_PNW.php', {
    headers: { 'Accept': 'text/html' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`19hz fetch failed: ${res.status}`);
  const html = await res.text();

  const events = [];
  // Each event is a row of <td> cells. Pattern:
  // td[0]: date+time, td[1]: title+link @ venue (city), td[2]: empty, td[3]: cost, td[4]: crew, td[5]: alt link, td[6]: sort date
  const rowPattern = /<td>(.*?)<\/td>\s*<td>(.*?)<td><\/td>\s*<td>(.*?)<\/td>\s*<td>(.*?)<\/td>\s*<td>(.*?)<\/td>\s*<td>(.*?)<\/td>/gi;
  let m;
  while ((m = rowPattern.exec(html)) !== null) {
    const [, dateCell, titleCell, costCell, crewCell, altCell, sortCell] = m;

    // Only Portland events
    if (!titleCell.includes('Portland, OR') && !titleCell.includes('portland, or')) continue;

    // Extract sort date
    const sortMatch = sortCell.match(/(\d{4}\/\d{2}\/\d{2})/);
    if (!sortMatch) continue;
    const sortDate = sortMatch[1].replace(/\//g, '-');

    // Extract time from dateCell
    const timeMatch = dateCell.match(/\((\d{1,2}(?::\d{2})?(?:am|pm)?)/i);
    let startsAt = `${sortDate}T00:00:00`;
    if (timeMatch) {
      let t = timeMatch[1].toLowerCase();
      let [h, min] = t.replace(/[ap]m/, '').split(':').map(Number);
      if (isNaN(min)) min = 0;
      if (t.includes('pm') && h < 12) h += 12;
      if (t.includes('am') && h === 12) h = 0;
      startsAt = `${sortDate}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
    }

    // Extract title and link
    const linkMatch = titleCell.match(/<a[^>]+href='([^']*)'[^>]*>(.*?)<\/a>/);
    const title = linkMatch ? linkMatch[2].replace(/<[^>]+>/g, '').trim() : titleCell.replace(/<[^>]+>/g, '').trim();
    const url = linkMatch ? linkMatch[1] : null;

    // Extract venue: text after " @ " and before " (Portland"
    const venueMatch = titleCell.replace(/<[^>]+>/g, '').match(/@\s*(.+?)\s*\(Portland/i);
    const venue = venueMatch ? venueMatch[1].trim() : null;

    // Extract address from venue portion
    const addrMatch = titleCell.replace(/<[^>]+>/g, '').match(/@\s*(.+?)\s*\(/);
    const address = addrMatch ? addrMatch[1].trim() : null;

    // Cost
    const cost = costCell.replace(/<[^>]+>/g, '').trim() || null;

    events.push({
      title,
      starts_at: startsAt,
      venue,
      address,
      cost,
      url,
      uid: `19hz-${sortDate}-${title.slice(0, 30).replace(/\W+/g, '-').toLowerCase()}`,
    });
  }

  return events;
}

/**
 * Fetch an iCal URL and return parsed events.
 */
export async function fetchIcalEvents(url) {
  const res = await fetch(url, {
    headers: { 'Accept': 'text/calendar, text/plain, */*' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Failed to fetch iCal: ${res.status} ${res.statusText}`);
  const text = await res.text();
  return parseIcal(text);
}
