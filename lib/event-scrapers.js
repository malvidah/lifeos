// ─── Geocoding ─────────────────────────────────────────────────────────────────

const geocodeCache = new Map();

/**
 * Geocode an address string via Nominatim (OpenStreetMap).
 * Returns { lat, lng } or null. Caches results in-memory per sync run.
 * Respects Nominatim's 1 req/sec rate limit.
 */
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
