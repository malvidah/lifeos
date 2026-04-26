'use client';

import { useEffect, useRef, useState } from 'react';
import { mono } from '@/lib/tokens';
import { nearestTripIdx, tripDateSpan, tripModeMix } from '@/lib/useTrips';

// Single-character glyph per travel mode. Kept short so a row of them fits
// comfortably in the trip card meta line.
const MODE_GLYPH = {
  walk:    '🚶',
  bike:    '🚲',
  transit: '🚊',
  drive:   '🚗',
};

// Format an ISO timestamp as "May 9" (or with year if not current year).
function formatDay(iso) {
  if (!iso) return '';
  const d  = new Date(iso);
  const ny = new Date().getFullYear();
  return d.toLocaleString('en-US',
    d.getFullYear() === ny
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatSpan(start, end) {
  if (!start) return '';
  if (!end || end === start) return formatDay(start);
  return `${formatDay(start)} – ${formatDay(end)}`;
}

// Past = trip's last dated stop is before today.
function isPast(span, todayStr) {
  if (!span.end && !span.start) return false;
  const last = (span.end || span.start).slice(0, 10);
  return last < todayStr;
}

// Card geometry — kept in one place so the centring math always stays in sync.
const CARD_W = 240;
const NEW_TILE_W = 200;
const GAP = 8;

/**
 * Bottom-strip horizontal scroller of trip cards.
 *
 * Two-step interaction:
 *   1st click on a card → previews it (parent shows the route on the map,
 *                          this scroller centres + highlights the card)
 *   2nd click on the same card → parent enters detail mode
 * Click a different card → just previews that one.
 */
export default function TripScroller({ trips, todayStr, previewedId, onPreview, onEnterDetail, onCreate }) {
  const scrollRef = useRef(null);
  const dragRef   = useRef({ down: false, startX: 0, scrollLeft: 0, moved: false });
  const [centred, setCentred] = useState(false);

  // Centre the scroll on the trip closest to today on first paint.
  useEffect(() => {
    if (centred || !trips.length || !scrollRef.current) return;
    const idx = nearestTripIdx(trips, todayStr);
    if (idx < 0) { setCentred(true); return; }
    const left = (NEW_TILE_W + GAP) + idx * (CARD_W + GAP) - (scrollRef.current.clientWidth - CARD_W) / 2;
    scrollRef.current.scrollLeft = Math.max(0, left);
    setCentred(true);
  }, [trips, todayStr, centred]);

  // Smoothly centre the previewed card when it changes.
  useEffect(() => {
    if (!previewedId || !scrollRef.current) return;
    const idx = trips.findIndex(t => t.id === previewedId);
    if (idx < 0) return;
    const left = (NEW_TILE_W + GAP) + idx * (CARD_W + GAP) - (scrollRef.current.clientWidth - CARD_W) / 2;
    scrollRef.current.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [previewedId, trips]);

  // Click handler routing: same card → detail; different / first card → preview.
  const handleCardClick = (id) => {
    if (dragRef.current.moved) return;
    if (id === previewedId) onEnterDetail(id);
    else onPreview(id);
  };

  return (
    <div style={{ pointerEvents: 'none' }}>
      <div
        ref={scrollRef}
        onMouseDown={e => {
          const d = dragRef.current;
          d.down = true; d.moved = false;
          d.startX = e.clientX;
          d.scrollLeft = scrollRef.current.scrollLeft;
        }}
        onMouseMove={e => {
          const d = dragRef.current;
          if (!d.down) return;
          e.preventDefault();
          const dx = e.clientX - d.startX;
          if (Math.abs(dx) > 5) d.moved = true;
          scrollRef.current.scrollLeft = d.scrollLeft - dx;
        }}
        onMouseUp={() => { dragRef.current.down = false; }}
        onMouseLeave={() => { dragRef.current.down = false; }}
        style={{
          display: 'flex', gap: 8, padding: '0 10px',
          overflowX: 'auto', overflowY: 'hidden',
          scrollbarWidth: 'none', msOverflowStyle: 'none',
          pointerEvents: 'auto', userSelect: 'none', WebkitUserSelect: 'none',
          cursor: 'grab',
        }}
      >
        {/* "+ new trip" tile, always first */}
        <button
          onClick={() => { if (!dragRef.current.moved) onCreate(); }}
          style={{
            flexShrink: 0, width: 200, height: 100,
            backdropFilter: 'blur(28px) saturate(1.6)',
            WebkitBackdropFilter: 'blur(28px) saturate(1.6)',
            background: 'var(--dl-glass)',
            border: '1.5px dashed var(--dl-glass-border)',
            borderRadius: 12, padding: 10,
            boxShadow: 'var(--dl-glass-shadow)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 6, cursor: 'pointer',
            color: 'var(--dl-middle)', fontFamily: mono, fontSize: 11,
            letterSpacing: '0.04em', textTransform: 'uppercase',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New trip
        </button>

        {trips.map(trip => {
          const span  = tripDateSpan(trip.stops);
          const modes = tripModeMix(trip.stops);
          const dim   = isPast(span, todayStr);
          const stopCount = trip.stops?.length ?? 0;
          const isPreviewed = trip.id === previewedId;
          return (
            <button
              key={trip.id}
              onClick={() => handleCardClick(trip.id)}
              style={{
                flexShrink: 0, width: CARD_W, height: 100,
                backdropFilter: 'blur(20px) saturate(1.4)',
                WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
                background: 'var(--dl-glass)',
                border: isPreviewed ? '1.5px solid var(--dl-accent)' : '1px solid var(--dl-glass-border)',
                borderRadius: 12, padding: 10,
                boxShadow: 'var(--dl-glass-shadow)',
                display: 'flex', flexDirection: 'column',
                alignItems: 'flex-start', textAlign: 'left',
                cursor: 'pointer',
                opacity: dim && !isPreviewed ? 0.55 : 1,
                transition: 'opacity 0.15s, border-color 0.15s',
              }}
            >
              <div style={{
                fontFamily: mono, fontSize: 12, fontWeight: 600,
                color: 'var(--dl-strong)', letterSpacing: '0.02em',
                lineHeight: 1.3, width: '100%',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {trip.name}
              </div>
              <div style={{
                fontFamily: mono, fontSize: 10, color: 'var(--dl-middle)',
                marginTop: 3,
              }}>
                {formatSpan(span.start, span.end) || (stopCount ? `${stopCount} stop${stopCount === 1 ? '' : 's'}` : 'Empty')}
              </div>
              {modes.length > 0 && (
                <div style={{
                  marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: 14, lineHeight: 1,
                }}>
                  {modes.map(m => <span key={m} title={m}>{MODE_GLYPH[m] || '•'}</span>)}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
