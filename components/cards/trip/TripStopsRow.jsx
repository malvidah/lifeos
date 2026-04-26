'use client';

import { useEffect, useState, useMemo } from 'react';
import { mono } from '@/lib/tokens';
import { resolveTripSegments } from '@/lib/routing';
import StopCard from './StopCard.jsx';

/**
 * Bottom-strip row of stop cards for the selected trip. Empty state nudges the
 * user to double-click the map.
 *
 * Resolves the trip's segments so each stop card can show a derived time
 * (= previous stop's date_time + segment duration) when the user hasn't set
 * an explicit one. This propagates forward — set the start node's date+time
 * once and every downstream stop gets a sensible default.
 */
export default function TripStopsRow({ trip, token, onUpdateStop, onDeleteStop, onReorder }) {
  // Drag-reorder. Tracks the index being dragged; the dropped position
  // produces a new ordering that we send up via onReorder.
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);

  const finishDrop = (toIdx) => {
    if (dragIdx == null || dragIdx === toIdx || !onReorder) {
      setDragIdx(null); setOverIdx(null); return;
    }
    const ids = trip.stops.map(s => s.id);
    const [moved] = ids.splice(dragIdx, 1);
    ids.splice(toIdx, 0, moved);
    onReorder(trip.id, ids);
    setDragIdx(null); setOverIdx(null);
  };

  const [segments, setSegments] = useState([]);
  // Refetch segments whenever stops change (coords, order, or mode).
  useEffect(() => {
    let cancelled = false;
    if (!trip.stops || trip.stops.length < 2) { setSegments([]); return; }
    resolveTripSegments(trip.stops, 'walk', token).then(s => { if (!cancelled) setSegments(s); });
    return () => { cancelled = true; };
  }, [trip.stops, token]);

  // Walk the stops forward and derive an effective date_time for each one
  // that doesn't have an explicit value: lastDated + sum(segment durations).
  // Returns ISO string per stop (or null when unknowable).
  const derivedTimes = useMemo(() => {
    const out = [];
    let lastIso = null;
    for (let i = 0; i < (trip.stops?.length || 0); i++) {
      const s = trip.stops[i];
      if (s.date_time) {
        out.push(null); // not derived — explicit
        lastIso = s.date_time;
        continue;
      }
      const seg = segments[i - 1]; // segment leading INTO this stop
      if (lastIso && seg?.duration_s != null) {
        const next = new Date(new Date(lastIso).getTime() + seg.duration_s * 1000).toISOString();
        out.push(next);
        lastIso = next;
      } else {
        out.push(null);
      }
    }
    return out;
  }, [trip.stops, segments]);

  // Most recent dated stop BEFORE index i. Used by StopCard so a time-only
  // entry like "4pm" attaches to the right calendar day instead of today.
  const priorDates = useMemo(() => {
    const out = [];
    let last = null;
    for (let i = 0; i < (trip.stops?.length || 0); i++) {
      out.push(last);
      const eff = trip.stops[i].date_time || derivedTimes[i];
      if (eff) last = eff;
    }
    return out;
  }, [trip.stops, derivedTimes]);

  if (!trip.stops?.length) {
    return (
      <div style={{
        pointerEvents: 'auto', padding: '0 10px',
      }}>
        <div style={{
          fontFamily: mono, fontSize: 11, color: 'var(--dl-middle)',
          textAlign: 'center', padding: '14px 0',
          opacity: 0.7,
          background: 'var(--dl-glass)',
          backdropFilter: 'blur(20px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
          border: '1px dashed var(--dl-glass-border)',
          borderRadius: 12,
        }}>
          Double-click anywhere on the map to add a stop.
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', gap: 6, padding: '0 10px',
      overflowX: 'auto', overflowY: 'hidden',
      scrollbarWidth: 'none', msOverflowStyle: 'none',
      pointerEvents: 'auto',
    }}>
      {trip.stops.map((stop, i) => (
        <div
          key={stop.id}
          draggable
          onDragStart={e => {
            setDragIdx(i);
            e.dataTransfer.effectAllowed = 'move';
            // Required for some browsers to fire drag events at all.
            try { e.dataTransfer.setData('text/plain', stop.id); } catch {}
          }}
          onDragEnter={() => { if (dragIdx != null && dragIdx !== i) setOverIdx(i); }}
          onDragOver={e => { if (dragIdx != null) e.preventDefault(); }}
          onDrop={e => { e.preventDefault(); finishDrop(i); }}
          onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
          style={{
            opacity: dragIdx === i ? 0.4 : 1,
            // Visual cue for the drop target — a colored bar on the leading edge.
            boxShadow: overIdx === i && dragIdx != null && dragIdx !== i
              ? 'inset 3px 0 0 var(--dl-accent)'
              : 'none',
            borderRadius: 10,
            transition: 'opacity 0.12s, box-shadow 0.12s',
          }}
        >
          <StopCard
            stop={stop}
            index={i}
            isLast={i === trip.stops.length - 1}
            onUpdate={onUpdateStop}
            onDelete={onDeleteStop}
            derivedDateTime={derivedTimes[i]}
            priorDate={priorDates[i]}
          />
        </div>
      ))}
    </div>
  );
}
