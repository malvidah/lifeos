'use client';

import { useState, useEffect } from 'react';
import { mono } from '@/lib/tokens';

const MODE_OPTIONS = [
  { key: 'walk',    label: 'Walk',    glyph: '🚶' },
  { key: 'bike',    label: 'Bike',    glyph: '🚲' },
  { key: 'transit', label: 'Transit', glyph: '🚊' },
  { key: 'drive',   label: 'Drive',   glyph: '🚗' },
];

// Display an ISO timestamp compactly: "Apr 25 4:00pm" (omitting year if current).
function formatDateTime(iso) {
  if (!iso) return '';
  const d  = new Date(iso);
  const ny = new Date().getFullYear();
  const datePart = d.toLocaleString('en-US',
    d.getFullYear() === ny
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' });
  const hasTime  = d.getHours() !== 0 || d.getMinutes() !== 0;
  if (!hasTime) return datePart;
  const timePart = d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(' ', '').toLowerCase();
  return `${datePart} ${timePart}`;
}

const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,
  january:1,february:2,march:3,april:4,june:6,july:7,august:8,
  september:9,october:10,november:11,december:12 };

// Parse a freeform date/time string. Accepts:
//   "Apr 25", "April 25 2026", "Apr 25 4pm", "Apr 25 4:30pm"
//   "4/25", "4/25/2026", "4/25 4pm"
//   "2026-04-25", "2026-04-25 16:30"
//   "today", "tomorrow", "today 9am"
//   bare time "4pm" / "16:30" → uses fallbackIso's date if provided
// Returns ISO string or null.
function parseDateTimeInput(input, fallbackIso) {
  if (!input) return null;
  const raw = input.trim().toLowerCase();
  if (!raw) return null;

  // Split off a trailing time token if present: "<date stuff> <time>"
  const timeMatch = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b/);
  let hh = 0, mn = 0;
  let datePart = raw;
  if (timeMatch) {
    if (timeMatch[3]) { // "4pm" or "4:30pm"
      hh = parseInt(timeMatch[1], 10) % 12;
      if (timeMatch[3] === 'pm') hh += 12;
      mn = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    } else { // "16:30"
      hh = parseInt(timeMatch[4], 10);
      mn = parseInt(timeMatch[5], 10);
    }
    datePart = raw.replace(timeMatch[0], '').trim();
  }

  // Bare time / empty date — anchor to the previous stop's date when one
  // exists, otherwise today. This makes "4pm" mean "the trip's current day".
  const fallback = fallbackIso ? new Date(fallbackIso) : new Date();
  let yyyy = fallback.getFullYear(), mm = null, dd = null;

  if (!datePart || datePart === 'today') {
    const ref = !datePart ? fallback : new Date();
    yyyy = ref.getFullYear();
    mm   = ref.getMonth() + 1;
    dd   = ref.getDate();
  } else if (datePart === 'tomorrow') {
    const t = new Date(fallback); t.setDate(t.getDate() + 1);
    yyyy = t.getFullYear(); mm = t.getMonth() + 1; dd = t.getDate();
  } else {
    // ISO YYYY-MM-DD
    const iso = datePart.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (iso) { yyyy = +iso[1]; mm = +iso[2]; dd = +iso[3]; }

    // MM/DD or MM/DD/YYYY
    if (mm == null) {
      const slash = datePart.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
      if (slash) {
        mm = +slash[1]; dd = +slash[2];
        if (slash[3]) yyyy = slash[3].length === 2 ? 2000 + +slash[3] : +slash[3];
      }
    }

    // "Month DD [YYYY]"
    if (mm == null) {
      const md = datePart.match(/^([a-z]+)\s+(\d{1,2})(?:\s+(\d{4}))?$/);
      if (md && MONTHS[md[1]]) { mm = MONTHS[md[1]]; dd = +md[2]; if (md[3]) yyyy = +md[3]; }
    }

    // "DD Month [YYYY]"
    if (mm == null) {
      const dm = datePart.match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/);
      if (dm && MONTHS[dm[2]]) { mm = MONTHS[dm[2]]; dd = +dm[1]; if (dm[3]) yyyy = +dm[3]; }
    }
  }

  if (mm == null || dd == null) return null;
  const d = new Date(yyyy, mm - 1, dd, hh, mn);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// Read display name + coords from a stop, with fall-back to its linked place.
// Stops own their own lat/lng/label after the schema migration; the linked
// place is just an optional reference (e.g. when added from the Places list).
function stopName(stop)  { return stop.label || stop.place?.name || 'Untitled stop'; }
function stopColor(stop) { return stop.place?.color || 'var(--dl-accent)'; }

/**
 * Single stop card. Numbered badge, inline-editable label, optional date+time
 * (parsed from natural input), notes, optional mode picker for the segment
 * leaving this stop (hidden when this is the last stop), delete.
 *
 * `derivedDateTime` is the auto-computed time when the stop has no explicit
 * value (= previous stop's time + segment duration). Shown ghost-style.
 * `priorDate` lets a bare-time entry like "4pm" attach to the trip's day
 * instead of today.
 */
export default function StopCard({ stop, index, isLast, onUpdate, onDelete, derivedDateTime, priorDate }) {
  const [label, setLabel] = useState(stopName(stop));
  // Date input has two display modes: a clean formatted string when not
  // focused ("Apr 25 4pm") and the raw user-typed value while editing.
  const [dateRaw,     setDateRaw]     = useState('');
  const [dateFocused, setDateFocused] = useState(false);
  const [mode,        setMode]        = useState(stop.profile_to_next || '');
  const [notes,       setNotes]       = useState(stop.notes || '');

  // Re-sync local state if a different stop is loaded into this slot.
  useEffect(() => {
    setLabel(stopName(stop));
    setDateRaw('');
    setMode(stop.profile_to_next || '');
    setNotes(stop.notes || '');
  }, [stop.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // When focused, show the user's raw text. Otherwise show the explicit value
  // if set, else the derived value (rendered in a dim/italic style as a ghost).
  const isDerived   = !stop.date_time && !!derivedDateTime;
  const dateDisplay = dateFocused
    ? dateRaw
    : (formatDateTime(stop.date_time) || formatDateTime(derivedDateTime));

  return (
    <div style={{
      flexShrink: 0, width: 220,
      background: 'var(--dl-glass)',
      backdropFilter: 'blur(28px) saturate(1.6)',
      WebkitBackdropFilter: 'blur(28px) saturate(1.6)',
      border: '1px solid var(--dl-glass-border)',
      borderRadius: 10, padding: 8,
      boxShadow: 'var(--dl-glass-shadow)',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      {/* Header: number badge + inline-editable label + delete */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          width: 18, height: 18, borderRadius: '50%',
          background: stopColor(stop),
          color: '#fff', fontFamily: mono, fontSize: 10, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>{index + 1}</span>
        <input
          value={label}
          onChange={e => setLabel(e.target.value)}
          onBlur={() => { if (label.trim() && label !== stopName(stop)) onUpdate(stop.id, { label: label.trim() }); }}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          placeholder="Stop name"
          style={{
            flex: 1, minWidth: 0,
            background: 'transparent', border: 'none', outline: 'none',
            fontFamily: mono, fontSize: 12, fontWeight: 600,
            color: 'var(--dl-strong)', letterSpacing: '0.02em', padding: 0,
          }}
        />
        <button
          onClick={() => onDelete(stop.id)}
          title="Remove from trip"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--dl-middle)', opacity: 0.5, padding: 2,
            display: 'flex', alignItems: 'center',
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Date + time — text input with natural-language parsing.
          Bare time inputs ("4pm") use priorDate as the date anchor so they
          stay on the trip's current day instead of jumping to today. */}
      <input
        value={dateDisplay}
        onFocus={() => {
          // Seed the editable value with whatever the user is currently
          // seeing — explicit time if set, otherwise the derived value.
          // Using stop.date_time alone would blank the field and trick a
          // bare-time entry into resolving against "now".
          setDateRaw(formatDateTime(stop.date_time) || formatDateTime(derivedDateTime));
          setDateFocused(true);
        }}
        onChange={e => setDateRaw(e.target.value)}
        onBlur={() => {
          setDateFocused(false);
          const trimmed = dateRaw.trim();
          if (!trimmed) { if (stop.date_time) onUpdate(stop.id, { date_time: null }); return; }
          const parsed = parseDateTimeInput(trimmed, priorDate || derivedDateTime);
          if (parsed && parsed !== stop.date_time) onUpdate(stop.id, { date_time: parsed });
        }}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setDateRaw(''); e.currentTarget.blur(); } }}
        placeholder="Apr 25 4pm"
        style={{
          width: '100%', background: 'transparent', border: 'none', outline: 'none',
          fontFamily: mono, fontSize: 10,
          color: 'var(--dl-middle)',
          // Ghost the derived time so users can tell it's auto-computed.
          fontStyle: isDerived && !dateFocused ? 'italic' : 'normal',
          opacity: isDerived && !dateFocused ? 0.6 : 1,
          padding: '2px 0',
        }}
      />

      {/* Notes */}
      <input
        value={notes}
        onChange={e => setNotes(e.target.value)}
        onBlur={() => { if (notes !== (stop.notes || '')) onUpdate(stop.id, { notes: notes || null }); }}
        placeholder="Notes…"
        style={{
          width: '100%', background: 'transparent', border: 'none', outline: 'none',
          fontFamily: mono, fontSize: 10, color: 'var(--dl-middle)',
          padding: '2px 0',
        }}
      />

      {/* Mode picker — only relevant when there's a segment after this stop */}
      {!isLast && (
        <div style={{
          display: 'flex', gap: 1, marginTop: 2,
          borderTop: '1px solid var(--dl-glass-border)', paddingTop: 6,
        }}>
          {MODE_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => {
                setMode(opt.key);
                onUpdate(stop.id, { profile_to_next: opt.key });
              }}
              title={`${opt.label} to next stop`}
              style={{
                flex: 1, padding: '4px 0', border: 'none',
                background: mode === opt.key ? 'var(--dl-accent-15)' : 'transparent',
                borderRadius: 6, cursor: 'pointer',
                fontSize: 13, lineHeight: 1,
                opacity: mode === opt.key ? 1 : 0.5,
              }}
            >{opt.glyph}</button>
          ))}
        </div>
      )}
    </div>
  );
}
