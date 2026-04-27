'use client';

import { useState, useEffect } from 'react';
import { mono } from '@/lib/tokens';
import { tripDateSpan } from '@/lib/useTrips';

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

/**
 * Trip header — appears in the top-left of the map when a trip is selected.
 * Sits next to the mode toggle pill. Compact glass card with: back arrow,
 * inline-editable name, derived date span, trash.
 */
export default function TripHeader({ trip, onBack, onUpdate, onDelete, readOnly = false }) {
  const [name, setName] = useState(trip.name);
  useEffect(() => { setName(trip.name); }, [trip.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const span = tripDateSpan(trip.stops);
  const spanText = formatSpan(span.start, span.end);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      backdropFilter: 'blur(20px) saturate(1.4)',
      WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
      background: 'var(--dl-glass)',
      border: '1px solid var(--dl-glass-border)',
      borderRadius: 100,
      padding: '4px 8px 4px 6px',
      boxShadow: 'var(--dl-glass-shadow)',
      maxWidth: 320,
    }}>
      <button
        onClick={onBack}
        title="Back to trips"
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--dl-middle)', display: 'flex', alignItems: 'center',
          padding: 2,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
        </svg>
      </button>

      {readOnly ? (
        <span style={{
          minWidth: 100, maxWidth: 200,
          fontFamily: mono, fontSize: 12, fontWeight: 600,
          color: 'var(--dl-strong)', letterSpacing: '0.02em',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{name || 'Trip'}</span>
      ) : (
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={() => { if (name.trim() && name !== trip.name) onUpdate(trip.id, { name: name.trim() }); }}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          placeholder="Trip name"
          style={{
            minWidth: 100, maxWidth: 200,
            background: 'transparent', border: 'none', outline: 'none',
            fontFamily: mono, fontSize: 12, fontWeight: 600,
            color: 'var(--dl-strong)', letterSpacing: '0.02em', padding: 0,
          }}
        />
      )}

      {spanText && (
        <span style={{
          fontFamily: mono, fontSize: 10, color: 'var(--dl-middle)',
          letterSpacing: '0.02em', whiteSpace: 'nowrap',
          paddingLeft: 6, borderLeft: '1px solid var(--dl-glass-border)',
        }}>
          {spanText}
        </span>
      )}

      {/* Public/private toggle — eye icon. Mirrors the note detail toggle. */}
      {!readOnly && <button
        onClick={() => onUpdate(trip.id, { is_public: !trip.is_public })}
        title={trip.is_public ? 'Public — click to make private' : 'Private — click to make public'}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: trip.is_public ? 'var(--dl-accent)' : 'var(--dl-middle)',
          padding: 2, display: 'flex', alignItems: 'center', marginLeft: 'auto',
        }}
      >
        {trip.is_public ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
          </svg>
        )}
      </button>}

      {!readOnly && <button
        onClick={() => {
          if (confirm(`Delete "${trip.name}"? This can't be undone.`)) onDelete(trip.id);
        }}
        title="Delete trip"
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--dl-middle)', opacity: 0.55, padding: 2,
          display: 'flex', alignItems: 'center', marginLeft: 'auto',
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </button>}
    </div>
  );
}
