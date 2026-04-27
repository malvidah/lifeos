// GET /api/trip-candidates                  → list pending candidates
// GET /api/trip-candidates?status=accepted   → list by status
// PATCH /api/trip-candidates                 → { id, action: 'accept' | 'reject' }
//   accept → creates a real trip + trip_stops, marks candidate accepted+links trip_id
//   reject → marks candidate rejected
// DELETE /api/trip-candidates?id=...         → permanent delete

import { withAuth } from '../_lib/auth.js';
import { isValidUuid } from '@/lib/validate.js';

export const GET = withAuth(async (req, { supabase, user }) => {
  const status = new URL(req.url).searchParams.get('status') || 'pending';
  const { data, error } = await supabase
    .from('trip_candidates')
    .select('id, source, source_ref, status, name, start_date, end_date, stops, raw, trip_id, created_at')
    .eq('user_id', user.id)
    .eq('status', status)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return Response.json({ candidates: data ?? [] });
});

export const PATCH = withAuth(async (req, { supabase, user }) => {
  const { id, action } = await req.json();
  if (!id || !isValidUuid(id)) {
    return Response.json({ error: 'valid id required' }, { status: 400 });
  }
  if (!['accept', 'reject'].includes(action)) {
    return Response.json({ error: 'action must be accept|reject' }, { status: 400 });
  }

  const { data: cand, error: candErr } = await supabase
    .from('trip_candidates').select('*')
    .eq('id', id).eq('user_id', user.id).maybeSingle();
  if (candErr) throw candErr;
  if (!cand) return Response.json({ error: 'not found' }, { status: 404 });

  if (action === 'reject') {
    await supabase.from('trip_candidates')
      .update({ status: 'rejected', updated_at: new Date().toISOString() })
      .eq('id', id).eq('user_id', user.id);
    return Response.json({ ok: true });
  }

  // ── accept: create the trip + stops, link back ─────────────────────────────
  const { data: trip, error: tripErr } = await supabase
    .from('trips')
    .insert({ user_id: user.id, name: cand.name || 'Trip' })
    .select('id, name')
    .single();
  if (tripErr) throw tripErr;

  // Map candidate stops into trip_stops rows. Skip stops without coords —
  // those would need manual placement and we don't auto-create empties.
  const stopRows = (cand.stops || [])
    .filter(s => s && s.lat != null && s.lng != null)
    .map((s, idx) => ({
      trip_id:    trip.id,
      lat:        s.lat,
      lng:        s.lng,
      label:      s.label || null,
      order_idx:  idx,
      date_time:  s.date_time || null,
    }));

  if (stopRows.length) {
    const { error: stopsErr } = await supabase.from('trip_stops').insert(stopRows);
    if (stopsErr) {
      // Roll back the trip so the user doesn't end up with a half-built one.
      await supabase.from('trips').delete().eq('id', trip.id).eq('user_id', user.id);
      return Response.json({ error: 'Failed to add stops', detail: stopsErr.message }, { status: 500 });
    }
  }

  // Also create a note tagged to the "trips" project with the email summary,
  // so the user has a writable doc for itinerary notes alongside the map.
  // The data-project-tag span is what the project-tag extractor recognises.
  const noteContent = buildTripNoteContent(cand, trip);
  await supabase.from('notes').insert({
    user_id:      user.id,
    title:        cand.name || 'Trip',
    content:      noteContent,
    project_tags: ['trips'],
  });

  await supabase.from('trip_candidates')
    .update({ status: 'accepted', trip_id: trip.id, updated_at: new Date().toISOString() })
    .eq('id', id).eq('user_id', user.id);

  return Response.json({ ok: true, trip, stops: stopRows.length });
});

// HTML-escape a string for safe insertion into note content.
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Build a note body for an accepted trip candidate.
// Includes the project tag chip so editing/saving preserves the tag.
function buildTripNoteContent(cand, trip) {
  const title = cand.name || 'Trip';
  const tagChip = `<span data-project-tag="trips">trips</span>`;
  const tripChip = `<span data-trip-tag="${esc(trip.name)}">${esc(trip.name)}</span>`;
  const dateLine = (cand.start_date || cand.end_date)
    ? `<p>${esc(cand.start_date || '')}${cand.end_date && cand.end_date !== cand.start_date ? ' → ' + esc(cand.end_date) : ''}</p>`
    : '';
  const stopLines = (cand.stops || []).map(s => {
    const when = s.date_time ? new Date(s.date_time).toISOString().slice(0, 16).replace('T', ' ') : '';
    const typeIcon = s.type === 'flight' ? '✈️'
                  : s.type === 'lodging' ? '🏨'
                  : s.type === 'train'   ? '🚆'
                  : s.type === 'bus'     ? '🚌'
                  : '📍';
    return `<p>${typeIcon} ${esc(s.label || 'Stop')}${when ? ` <span style="opacity:0.6">${esc(when)}</span>` : ''}</p>`;
  }).join('');
  const sourceLine = cand.raw?.subject
    ? `<p style="opacity:0.6;font-size:0.85em">From email: ${esc(cand.raw.subject)}</p>`
    : '';
  return [
    `<h1>${esc(title)}</h1>`,
    `<p>${tagChip} · ${tripChip}</p>`,
    dateLine,
    stopLines,
    sourceLine,
  ].filter(Boolean).join('');
}

export const DELETE = withAuth(async (req, { supabase, user }) => {
  const id = new URL(req.url).searchParams.get('id');
  if (!id || !isValidUuid(id)) {
    return Response.json({ error: 'valid id required' }, { status: 400 });
  }
  const { error } = await supabase
    .from('trip_candidates').delete()
    .eq('id', id).eq('user_id', user.id);
  if (error) throw error;
  return Response.json({ ok: true });
});
