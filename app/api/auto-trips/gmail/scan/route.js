// POST /api/auto-trips/gmail/scan
//   Pulls recent travel-related Gmail messages, extracts JSON-LD reservation
//   blocks (FlightReservation, LodgingReservation, TrainReservation, etc.)
//   and upserts them as `trip_candidates` for the user to confirm.
//
// Query: ?days=90        — how far back to scan (default 90, max 365)
//
// Returns: { scanned: N, candidates: [...] }
//
// Requires the user to have completed Google OAuth with the gmail.readonly
// scope. If the access token is missing the scope, Gmail will return 403 and
// we surface that to the client so it can prompt re-auth.

import { withAuth } from '../../../_lib/auth.js';
import { withGoogleToken } from '../../../_lib/google.js';

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

// Travel-related Gmail filter: standard "category:travel" plus common booking
// senders. `newer_than:Nd` keeps the result set small even on big inboxes.
function buildQuery(days) {
  return [
    `newer_than:${days}d`,
    '(',
    'category:travel',
    'OR from:(noreply@booking.com OR no-reply@airbnb.com OR airbnb.com',
    'OR delta.com OR united.com OR aa.com OR jetblue.com',
    'OR alaskaair.com OR southwest.com OR lufthansa.com OR ba.com',
    'OR marriott.com OR hilton.com OR hyatt.com OR ihg.com',
    'OR expedia.com OR hotels.com OR kayak.com OR tripadvisor.com',
    'OR amtrak.com)',
    'OR subject:(itinerary OR confirmation OR booking OR reservation)',
    ')',
  ].join(' ');
}

// Decode Gmail's URL-safe base64 message body.
function decodeBody(encoded) {
  if (!encoded) return '';
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  try { return Buffer.from(b64, 'base64').toString('utf8'); } catch { return ''; }
}

// Walk the MIME tree and collect text/html bodies (where JSON-LD lives).
function extractHtmlParts(payload) {
  const out = [];
  const visit = (part) => {
    if (!part) return;
    if (part.mimeType === 'text/html' && part.body?.data) {
      out.push(decodeBody(part.body.data));
    }
    (part.parts || []).forEach(visit);
  };
  visit(payload);
  return out;
}

// Pull every <script type="application/ld+json"> block from raw HTML and
// JSON-parse it. Returns a flat array of @type-tagged objects.
function extractJsonLd(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const flatten = (node) => {
        if (Array.isArray(node)) node.forEach(flatten);
        else if (node && typeof node === 'object') {
          if (node['@type']) out.push(node);
          if (Array.isArray(node['@graph'])) node['@graph'].forEach(flatten);
        }
      };
      flatten(parsed);
    } catch { /* ignore malformed JSON-LD */ }
  }
  return out;
}

// Convert a known reservation @type into a candidate row shape.
// Returns null if we can't extract anything useful.
function reservationToCandidate(node) {
  const type = node['@type'];
  if (!type) return null;

  // Reservations sometimes wrap the actual entity inside `reservationFor`.
  const entity = node.reservationFor || node;
  const startDate = node.startTime || entity.startDate || entity.checkinDate || entity.departureTime;
  const endDate = node.endTime || entity.endDate || entity.checkoutDate || entity.arrivalTime;

  let label = null;
  let lat = null, lng = null;
  let stopType = 'place';

  if (type.includes('Flight')) {
    stopType = 'flight';
    const arr = entity.arrivalAirport;
    label = arr?.name || arr?.iataCode || entity.airline?.name || 'Flight';
    lat = arr?.geo?.latitude ?? null;
    lng = arr?.geo?.longitude ?? null;
  } else if (type.includes('Lodging') || type.includes('Hotel')) {
    stopType = 'lodging';
    label = entity.name || 'Hotel';
    lat = entity.geo?.latitude ?? entity.address?.geo?.latitude ?? null;
    lng = entity.geo?.longitude ?? entity.address?.geo?.longitude ?? null;
  } else if (type.includes('Train') || type.includes('Bus')) {
    stopType = type.includes('Train') ? 'train' : 'bus';
    const arr = entity.arrivalStation;
    label = arr?.name || 'Arrival';
    lat = arr?.geo?.latitude ?? null;
    lng = arr?.geo?.longitude ?? null;
  } else if (type.includes('FoodEstablishment') || type.includes('Reservation')) {
    label = entity.name || 'Reservation';
    lat = entity.geo?.latitude ?? null;
    lng = entity.geo?.longitude ?? null;
  } else {
    return null;
  }

  return {
    type: stopType,
    label,
    lat: typeof lat === 'string' ? parseFloat(lat) : lat,
    lng: typeof lng === 'string' ? parseFloat(lng) : lng,
    date_time: startDate || null,
    end_time: endDate || null,
    raw: node,
  };
}

// Group multiple reservations from the same email into a single candidate trip.
// Sets candidate.name from the most distinctive stop label.
function buildCandidateFromMessage(msgId, subject, fromHeader, stops) {
  if (!stops.length) return null;
  const dates = stops.map(s => s.date_time).filter(Boolean).map(d => new Date(d)).sort((a, b) => a - b);
  const start = dates[0]?.toISOString().slice(0, 10) || null;
  const end = dates[dates.length - 1]?.toISOString().slice(0, 10) || null;
  // Prefer a destination label (lodging > flight arrival > whatever)
  const lodging = stops.find(s => s.type === 'lodging');
  const flight  = stops.find(s => s.type === 'flight');
  const labelSource = lodging || flight || stops[0];
  const name = labelSource?.label ? `Trip · ${labelSource.label}` : (subject || 'Trip');
  return {
    source: 'gmail',
    source_ref: msgId,
    status: 'pending',
    name,
    start_date: start,
    end_date: end,
    stops,
    raw: { subject, from: fromHeader, stops },
  };
}

export const POST = withAuth(async (req, { supabase, user }) => {
  const url = new URL(req.url);
  const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get('days') || '90', 10)));
  const maxResults = Math.min(100, Math.max(5, parseInt(url.searchParams.get('limit') || '50', 10)));

  // 1. List matching message IDs.
  const listResult = await withGoogleToken(supabase, user.id, async (accessToken) => {
    const u = new URL(`${GMAIL_BASE}/messages`);
    u.searchParams.set('q', buildQuery(days));
    u.searchParams.set('maxResults', String(maxResults));
    const r = await fetch(u, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (r.status === 401) return { ok: false, status: 401 };
    if (!r.ok) {
      const errBody = await r.text();
      return { ok: false, status: r.status, error: errBody };
    }
    return { ok: true, data: await r.json() };
  });

  if (!listResult.ok) {
    if (listResult.status === 403) {
      return Response.json({
        error: 'Gmail access denied — reconnect Google with Gmail scope',
        needsReauth: true,
      }, { status: 403 });
    }
    return Response.json({ error: 'Gmail list failed', detail: listResult.error }, { status: listResult.status || 500 });
  }

  const messageIds = (listResult.data?.messages || []).map(m => m.id);

  // 2. For each message, fetch full content and extract JSON-LD candidates.
  // Skip ones we already have (saves Gmail API quota — we still hit "list" but
  // bail early on the per-message fetch).
  const { data: existing } = await supabase
    .from('trip_candidates')
    .select('source_ref')
    .eq('user_id', user.id).eq('source', 'gmail');
  const seen = new Set((existing || []).map(r => r.source_ref));
  const fresh = messageIds.filter(id => !seen.has(id));

  const candidates = [];
  for (const id of fresh) {
    const msgResult = await withGoogleToken(supabase, user.id, async (accessToken) => {
      const r = await fetch(`${GMAIL_BASE}/messages/${id}?format=full`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!r.ok) return { ok: false, status: r.status };
      return { ok: true, data: await r.json() };
    });
    if (!msgResult.ok) continue;

    const msg = msgResult.data;
    const headers = msg.payload?.headers || [];
    const subject = headers.find(h => h.name?.toLowerCase() === 'subject')?.value || '';
    const fromHeader = headers.find(h => h.name?.toLowerCase() === 'from')?.value || '';

    const htmlParts = extractHtmlParts(msg.payload);
    const reservations = htmlParts.flatMap(extractJsonLd);
    const stops = reservations.map(reservationToCandidate).filter(Boolean);

    const candidate = buildCandidateFromMessage(id, subject, fromHeader, stops);
    if (candidate) candidates.push({ ...candidate, user_id: user.id });
  }

  // 3. Bulk upsert (no-op for already-seen due to unique constraint).
  let inserted = [];
  if (candidates.length) {
    const { data, error } = await supabase
      .from('trip_candidates')
      .upsert(candidates, { onConflict: 'user_id,source,source_ref', ignoreDuplicates: true })
      .select('id, name, start_date, end_date, stops, source, source_ref, status');
    if (error) {
      return Response.json({ error: 'Failed to save candidates', detail: error.message }, { status: 500 });
    }
    inserted = data || [];
  }

  return Response.json({
    scanned: messageIds.length,
    skipped: messageIds.length - fresh.length,
    candidates: inserted,
  });
});
