'use client';

import { useEffect, useRef } from 'react';
import { mono } from '@/lib/tokens';

// Card geometry (smaller than TripScroller — just name + count fits comfortably).
const CARD_W = 160;
const ALL_CARD_W = 140;
const GAP = 8;

/**
 * Bottom-strip horizontal scroller of "collection" cards (place categories).
 *
 * Two-step interaction (mirrors TripScroller):
 *   1st click on a card → previews the collection (parent filters markers +
 *                          fits map bounds, scroller centres + highlights it)
 *   2nd click on the same card → parent enters detail mode (PlacesRow opens)
 *
 * The leading "ALL" card represents `selectedCollection === null`.
 */
export default function CollectionScroller({
  collections,        // [{ id, name, color, count, is_public }, ...]
  totalCount,         // count for the ALL card
  selectedCollection, // null = ALL; string = category name
  onPreview,          // (name | null) => void
  onEnterDetail,      // (name | null) => void
  onTogglePublic,     // (collection: {id, name, is_public}) => void — when omitted, toggle hides
}) {
  const scrollRef = useRef(null);
  const dragRef   = useRef({ down: false, startX: 0, scrollLeft: 0, moved: false });

  // Smoothly centre the previewed card when it changes.
  useEffect(() => {
    if (!scrollRef.current) return;
    const idx = selectedCollection == null
      ? -1 // ALL is first; no separate index needed
      : collections.findIndex(c => c.name === selectedCollection);
    const left = idx < 0
      ? 0
      : (ALL_CARD_W + GAP) + idx * (CARD_W + GAP) - (scrollRef.current.clientWidth - CARD_W) / 2;
    scrollRef.current.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [selectedCollection, collections]);

  const handleClick = (key) => {
    if (dragRef.current.moved) return;
    // key === null  → ALL card
    // key === name  → category card
    if (key === selectedCollection) onEnterDetail(key);
    else onPreview(key);
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
          display: 'flex', gap: GAP, padding: '0 10px',
          overflowX: 'auto', overflowY: 'hidden',
          scrollbarWidth: 'none', msOverflowStyle: 'none',
          pointerEvents: 'auto', userSelect: 'none', WebkitUserSelect: 'none',
          cursor: 'grab',
        }}
      >
        {/* ALL card — always first */}
        <CollectionCard
          label="All"
          count={totalCount}
          color={null}
          selected={selectedCollection == null}
          width={ALL_CARD_W}
          onClick={() => handleClick(null)}
        />

        {collections.map(c => (
          <CollectionCard
            key={c.name}
            label={c.name}
            count={c.count}
            color={c.color}
            selected={selectedCollection === c.name}
            width={CARD_W}
            onClick={() => handleClick(c.name)}
            isPublic={!!c.is_public}
            onTogglePublic={onTogglePublic ? (e) => { e.stopPropagation(); onTogglePublic(c); } : null}
          />
        ))}
      </div>
    </div>
  );
}

function CollectionCard({ label, count, color, selected, width, onClick, isPublic, onTogglePublic }) {
  const tint = color || 'var(--dl-accent)';
  return (
    <div
      onClick={onClick}
      style={{
        flexShrink: 0, width, height: 70,
        backdropFilter: 'blur(20px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
        background: selected
          ? (color ? `${color}22` : 'var(--dl-accent-15)')
          : 'var(--dl-glass)',
        border: selected
          ? `1.5px solid ${tint}`
          : '1px solid var(--dl-glass-border)',
        borderRadius: 12, padding: 10,
        boxShadow: 'var(--dl-glass-shadow)',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        alignItems: 'flex-start', textAlign: 'left',
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
        {color && (
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
        )}
        <span style={{
          fontFamily: mono, fontSize: 12, fontWeight: 600,
          color: selected ? tint : 'var(--dl-strong)',
          letterSpacing: '0.04em', textTransform: 'uppercase',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
        }}>
          {label}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
        <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--dl-middle)' }}>
          {count} {count === 1 ? 'place' : 'places'}
        </span>
        {onTogglePublic && (
          <button
            onClick={onTogglePublic}
            title={isPublic ? 'Public — click to make private' : 'Private — click to make public'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1,
              color: isPublic ? 'var(--dl-accent)' : 'var(--dl-middle)',
              display: 'flex', alignItems: 'center',
            }}
          >
            {isPublic ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
