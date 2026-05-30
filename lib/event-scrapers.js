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
