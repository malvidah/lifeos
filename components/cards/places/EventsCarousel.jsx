"use client";
import { useState, useRef, useMemo } from "react";
import { mono, F } from "@/lib/tokens";

const CATEGORY_COLORS = {
  music: '#C084FC',
  art: '#F472B6',
  outdoors: '#4ADE80',
  lectures: '#60A5FA',
  sports: '#FB923C',
  food: '#FBBF24',
  community: '#2DD4BF',
  other: '#94A3B8',
};

const CATEGORY_ICONS = {
  music: '🎵',
  art: '🎨',
  outdoors: '🏔️',
  lectures: '📚',
  sports: '⚡',
  food: '🍴',
  community: '🤝',
  other: '📅',
};

const FILTER_OPTIONS = [
  { key: null, label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
];

export function categoryColor(cat) {
  return CATEGORY_COLORS[(cat || '').toLowerCase()] || CATEGORY_COLORS.other;
}

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const eventDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((eventDay - today) / 86400000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays > 1 && diffDays < 7) {
    return d.toLocaleDateString('en-US', { weekday: 'long' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}

export default function EventsCarousel({
  events,
  selectedEventId,
  onSelect,
  timeFilter,
  onTimeFilterChange,
  categoryFilter,
  onCategoryFilterChange,
}) {
  const scrollRef = useRef(null);
  const dragRef = useRef({ down: false, startX: 0, scrollLeft: 0, moved: false });

  const categories = useMemo(() => {
    const cats = new Set();
    events.forEach(e => cats.add((e.category || 'other').toLowerCase()));
    return [...cats].sort();
  }, [events]);

  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0,
      pointerEvents: 'auto',
      display: 'flex', flexDirection: 'column', gap: 6,
      padding: '0 0 8px',
    }}>
      {/* Filters row */}
      <div style={{
        display: 'flex', gap: 6, padding: '0 10px',
        overflowX: 'auto', scrollbarWidth: 'none',
      }}>
        {/* Time filters */}
        {FILTER_OPTIONS.map(opt => (
          <button key={opt.key ?? 'all'} onClick={() => onTimeFilterChange(opt.key)}
            style={{
              fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
              background: timeFilter === opt.key ? 'var(--dl-accent-15)' : 'var(--dl-glass)',
              color: timeFilter === opt.key ? 'var(--dl-accent)' : 'var(--dl-middle)',
              border: '1px solid var(--dl-glass-border)',
              borderRadius: 100, padding: '4px 10px', cursor: 'pointer',
              whiteSpace: 'nowrap', flexShrink: 0,
              backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
              transition: 'all 0.15s',
            }}
          >{opt.label}</button>
        ))}
        <div style={{ width: 1, background: 'var(--dl-border)', margin: '4px 2px', flexShrink: 0 }} />
        {/* Category filters */}
        {categories.map(cat => (
          <button key={cat} onClick={() => onCategoryFilterChange(categoryFilter === cat ? null : cat)}
            style={{
              fontFamily: mono, fontSize: 10, letterSpacing: '0.04em',
              background: categoryFilter === cat ? categoryColor(cat) + '22' : 'var(--dl-glass)',
              color: categoryFilter === cat ? categoryColor(cat) : 'var(--dl-middle)',
              border: '1px solid var(--dl-glass-border)',
              borderRadius: 100, padding: '4px 10px', cursor: 'pointer',
              whiteSpace: 'nowrap', flexShrink: 0,
              backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
              transition: 'all 0.15s',
            }}
          >{CATEGORY_ICONS[cat] || '📅'} {cat}</button>
        ))}
      </div>

      {/* Events cards */}
      <div
        ref={scrollRef}
        onMouseDown={e => {
          dragRef.current = { down: true, startX: e.clientX, scrollLeft: scrollRef.current.scrollLeft, moved: false };
        }}
        onMouseMove={e => {
          if (!dragRef.current.down) return;
          const dx = e.clientX - dragRef.current.startX;
          if (Math.abs(dx) > 3) dragRef.current.moved = true;
          scrollRef.current.scrollLeft = dragRef.current.scrollLeft - dx;
        }}
        onMouseUp={() => { dragRef.current.down = false; }}
        onMouseLeave={() => { dragRef.current.down = false; }}
        style={{
          display: 'flex', gap: 8, padding: '0 10px',
          overflowX: 'auto', overflowY: 'hidden',
          scrollbarWidth: 'none', msOverflowStyle: 'none',
          cursor: 'grab', userSelect: 'none', WebkitUserSelect: 'none',
        }}
      >
        {events.length === 0 && (
          <div style={{
            fontFamily: mono, fontSize: 11, color: 'var(--dl-middle)',
            padding: '16px 10px', whiteSpace: 'nowrap',
          }}>No upcoming events</div>
        )}
        {events.map(event => {
          const isSelected = event.id === selectedEventId;
          const color = categoryColor(event.category);
          return (
            <div
              key={event.id}
              data-event-id={event.id}
              onClick={() => {
                if (dragRef.current.moved) { dragRef.current.moved = false; return; }
                onSelect(isSelected ? null : event);
              }}
              style={{
                flex: '0 0 220px', width: 220, minHeight: 80,
                background: 'var(--dl-glass)',
                backdropFilter: 'blur(20px) saturate(1.4)',
                WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
                border: `1px solid ${isSelected ? color : 'var(--dl-glass-border)'}`,
                borderRadius: 10, padding: '10px 12px',
                cursor: 'pointer',
                opacity: isSelected ? 1 : 0.85,
                transition: 'all 0.15s',
                display: 'flex', flexDirection: 'column', gap: 4,
                borderTop: `2px solid ${color}`,
              }}
            >
              {/* Date + time */}
              <div style={{
                fontFamily: mono, fontSize: 10, letterSpacing: '0.04em',
                color, display: 'flex', gap: 6, alignItems: 'center',
              }}>
                <span>{formatDate(event.starts_at)}</span>
                {event.starts_at && <span style={{ opacity: 0.7 }}>{formatTime(event.starts_at)}</span>}
              </div>

              {/* Title */}
              <div style={{
                fontFamily: mono, fontSize: 12, fontWeight: 500, color: 'var(--dl-strong)',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                overflow: 'hidden', lineHeight: 1.3,
              }}>{event.title}</div>

              {/* Venue + cost */}
              <div style={{
                fontFamily: mono, fontSize: 10, color: 'var(--dl-middle)',
                display: 'flex', gap: 6, alignItems: 'center',
                overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
              }}>
                {event.venue && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{event.venue}</span>}
                {event.cost && <span style={{ flexShrink: 0, color }}>· {event.cost}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function EventDetailCard({ event, onClose, onOpenUrl }) {
  if (!event) return null;
  const color = categoryColor(event.category);
  return (
    <div style={{
      position: 'absolute', bottom: 10, left: 10, right: 10,
      zIndex: 1002,
      maxWidth: 360,
      background: 'var(--dl-glass)',
      backdropFilter: 'blur(20px) saturate(1.4)',
      WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
      border: `1px solid var(--dl-glass-border)`,
      borderRadius: 14, padding: 16,
      pointerEvents: 'auto',
      borderTop: `3px solid ${color}`,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
            color, marginBottom: 4,
            display: 'flex', gap: 6, alignItems: 'center',
          }}>
            <span>{CATEGORY_ICONS[event.category] || '📅'}</span>
            <span>{event.category || 'event'}</span>
          </div>
          <div style={{
            fontFamily: mono, fontSize: 15, fontWeight: 600, color: 'var(--dl-strong)',
            lineHeight: 1.3,
          }}>{event.title}</div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--dl-middle)', fontSize: 18, lineHeight: 1, padding: 4, flexShrink: 0,
        }}>×</button>
      </div>

      <div style={{
        fontFamily: mono, fontSize: 11, color: 'var(--dl-highlight)',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ color }}>📅</span>
          <span>{formatDate(event.starts_at)} {formatTime(event.starts_at)}
            {event.ends_at && ` – ${formatTime(event.ends_at)}`}
          </span>
        </div>
        {event.venue && (
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ color }}>📍</span>
            <span>{event.venue}</span>
          </div>
        )}
        {event.cost && (
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ color }}>💰</span>
            <span>{event.cost}</span>
          </div>
        )}
      </div>

      {event.description && (
        <div style={{
          fontFamily: mono, fontSize: 11, color: 'var(--dl-middle)',
          lineHeight: 1.5, maxHeight: 80, overflow: 'auto',
        }}>{event.description}</div>
      )}

      {event.source_url && (
        <button onClick={() => onOpenUrl(event.source_url)} style={{
          fontFamily: mono, fontSize: 10, letterSpacing: '0.04em',
          color, background: color + '15', border: `1px solid ${color}33`,
          borderRadius: 8, padding: '6px 12px', cursor: 'pointer',
          textAlign: 'center', transition: 'all 0.15s',
        }}>View on {event.source || 'website'} →</button>
      )}

      <div style={{
        fontFamily: mono, fontSize: 9, color: 'var(--dl-middle)', opacity: 0.5,
        letterSpacing: '0.04em',
      }}>via {event.source}</div>
    </div>
  );
}
