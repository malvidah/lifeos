'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

// Broadcast that the trip list (or a name) changed. Listeners (Dashboard's
// trip-names loader) re-fetch so /tr autocomplete stays current.
function notifyTripsChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('daylab:trips-changed'));
  }
}

// Fetch + manage Trips for the current user.
// Lazy: caller passes `enabled` so we don't fetch until trip mode is active.
export function useTrips(token, { enabled }) {
  const [trips, setTrips]               = useState([]);
  const [selectedTrip, setSelectedTrip] = useState(null);  // full trip with stops
  const [loaded, setLoaded]             = useState(false);

  // Load list when trip mode opens.
  useEffect(() => {
    if (!enabled || !token) return;
    api.get('/api/trips', token).then(res => {
      setTrips(res?.trips ?? []);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [enabled, token]);

  const selectTrip = useCallback(async (id) => {
    if (!id) { setSelectedTrip(null); return; }
    const res = await api.get(`/api/trips?id=${id}`, token);
    setSelectedTrip(res?.trip ?? null);
  }, [token]);

  const createTrip = useCallback(async ({ name = 'New trip' } = {}) => {
    const res = await api.post('/api/trips', { name }, token);
    const trip = res?.trip;
    if (trip) { setTrips(t => [trip, ...t]); notifyTripsChanged(); }
    return trip;
  }, [token]);

  const updateTrip = useCallback(async (id, patch) => {
    const res = await api.patch('/api/trips', { id, ...patch }, token);
    const updated = res?.trip;
    if (updated) {
      setTrips(t => t.map(tr => tr.id === id ? { ...tr, ...updated } : tr));
      setSelectedTrip(prev => prev?.id === id ? { ...prev, ...updated } : prev);
      // Names may have changed — refresh autocomplete suggestions.
      if ('name' in patch) notifyTripsChanged();
    }
    return updated;
  }, [token]);

  const deleteTrip = useCallback(async (id) => {
    await api.delete(`/api/trips?id=${id}`, token);
    setTrips(t => t.filter(tr => tr.id !== id));
    setSelectedTrip(prev => prev?.id === id ? null : prev);
    notifyTripsChanged();
  }, [token]);

  // ── Stop CRUD ─────────────────────────────────────────────────────────────
  // Each mutation also refreshes the matching trip's slim stops in the list,
  // so the scroller's derived date span / mode mix stays current.
  // The slim list view stores only { date_time, profile_to_next, order_idx }
  // — we rebuild that array from the full selected stops after each change.

  const _syncListSlim = useCallback((tripId, fullStops) => {
    const slim = (fullStops || []).map(s => ({
      trip_id: tripId,
      date_time: s.date_time,
      profile_to_next: s.profile_to_next,
      order_idx: s.order_idx,
    }));
    setTrips(arr => arr.map(t => t.id === tripId ? { ...t, stops: slim } : t));
  }, []);

  const addStop = useCallback(async ({ trip_id, lat, lng, label = null, place_id = null, date_time = null, profile_to_next = null }) => {
    const res  = await api.post('/api/trips/stops', { trip_id, lat, lng, label, place_id, date_time, profile_to_next }, token);
    const stop = res?.stop;
    if (!stop) return null;
    setSelectedTrip(prev => {
      if (prev?.id !== trip_id) return prev;
      const next = { ...prev, stops: [...(prev.stops || []), stop] };
      _syncListSlim(trip_id, next.stops);
      return next;
    });
    return stop;
  }, [token, _syncListSlim]);

  const updateStop = useCallback(async (stop_id, patch) => {
    const res  = await api.patch('/api/trips/stops', { id: stop_id, ...patch }, token);
    const stop = res?.stop;
    if (!stop) return null;
    setSelectedTrip(prev => {
      if (!prev) return prev;
      const next = { ...prev, stops: prev.stops.map(s => s.id === stop_id ? { ...s, ...stop } : s) };
      _syncListSlim(prev.id, next.stops);
      return next;
    });
    return stop;
  }, [token, _syncListSlim]);

  const deleteStop = useCallback(async (stop_id) => {
    await api.delete(`/api/trips/stops?id=${stop_id}`, token);
    setSelectedTrip(prev => {
      if (!prev) return prev;
      const next = { ...prev, stops: prev.stops.filter(s => s.id !== stop_id) };
      _syncListSlim(prev.id, next.stops);
      return next;
    });
  }, [token, _syncListSlim]);

  const reorderStops = useCallback(async (trip_id, orderedStopIds) => {
    await api.patch('/api/trips/stops', { trip_id, order: orderedStopIds }, token);
    setSelectedTrip(prev => {
      if (!prev || prev.id !== trip_id) return prev;
      const byId = Object.fromEntries(prev.stops.map(s => [s.id, s]));
      const next = { ...prev, stops: orderedStopIds.map((id, i) => ({ ...byId[id], order_idx: i })) };
      _syncListSlim(trip_id, next.stops);
      return next;
    });
  }, [token, _syncListSlim]);

  return {
    trips, selectedTrip, selectTrip, createTrip, updateTrip, deleteTrip,
    addStop, updateStop, deleteStop, reorderStops,
    loaded,
  };
}

// ── Derived helpers (compute from stops, never stored) ──────────────────────

// Earliest + latest date_time across a trip's stops. Returns { start, end } as
// ISO strings, or null fields when no stop has a date.
export function tripDateSpan(stops) {
  if (!stops?.length) return { start: null, end: null };
  let start = null, end = null;
  for (const s of stops) {
    if (!s.date_time) continue;
    if (!start || s.date_time < start) start = s.date_time;
    if (!end   || s.date_time > end)   end   = s.date_time;
  }
  return { start, end };
}

// Distinct modes used between consecutive stops, in segment order.
export function tripModeMix(stops) {
  if (!stops?.length) return [];
  const seen = new Set();
  const out  = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const m = stops[i].profile_to_next;
    if (!m || seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}

// Find the trip whose date span contains today, otherwise the one with the
// nearest edge. Returns -1 when no trips have any dated stops.
export function nearestTripIdx(trips, todayStr) {
  if (!trips?.length) return -1;
  const today = new Date(todayStr + 'T12:00:00').getTime();
  let bestIdx = -1, bestDelta = Infinity;
  trips.forEach((t, i) => {
    const { start, end } = tripDateSpan(t.stops);
    if (!start) return;
    const startMs = new Date(start).getTime();
    const endMs   = new Date(end || start).getTime();
    let delta;
    if (today >= startMs && today <= endMs) delta = 0;
    else if (today < startMs) delta = startMs - today;
    else delta = today - endMs;
    if (delta < bestDelta) { bestDelta = delta; bestIdx = i; }
  });
  return bestIdx;
}
