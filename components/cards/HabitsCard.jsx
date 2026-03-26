"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { mono, F } from "@/lib/tokens";
import { api } from "@/lib/api";
import { todayKey } from "@/lib/dates";
import { Shimmer } from "../ui/primitives.jsx";

// ── Streak helpers ───────────────────────────────────────────────────────────
function streakEmoji(streak, frozen) {
  if (frozen) return '\u2744\uFE0F';
  if (streak > 0) return '\uD83D\uDD25';
  return '\uD83D\uDC0E';
}

function streakColor(streak, frozen) {
  if (frozen) return '#7CB8D4';
  if (streak > 0) return 'var(--dl-accent)';
  return 'var(--dl-middle)';
}

function streakBg(streak, frozen) {
  if (frozen) return 'rgba(124,184,212,0.12)';
  if (streak > 0) return 'var(--dl-accent-10, rgba(208,136,40,0.1))';
  return 'transparent';
}

// ── Date helpers ─────────────────────────────────────────────────────────────
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function dayLabel(dateStr) {
  return ['S','M','T','W','R','F','S'][new Date(dateStr + 'T12:00:00').getDay()];
}

function monthLabel(dateStr) {
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][new Date(dateStr + 'T12:00:00').getMonth()];
}

function dayNum(dateStr) {
  return parseInt(dateStr.slice(8), 10);
}

// ── Mode toggle for card header ──────────────────────────────────────────────
const CalIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="12" height="11" rx="2"/><line x1="2" y1="7" x2="14" y2="7"/>
    <line x1="6" y1="3" x2="6" y2="1"/><line x1="10" y1="3" x2="10" y2="1"/>
  </svg>
);
const CountIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="5" width="4" height="4" rx="1"/><rect x="6" y="5" width="4" height="4" rx="1"/><rect x="11" y="5" width="4" height="4" rx="1"/>
  </svg>
);

export function HabitModeBtns({ mode, setMode }) {
  return (
    <div style={{ display: 'flex', gap: 2, background: 'var(--dl-border-15, rgba(128,120,100,0.1))', borderRadius: 100, padding: 2 }}>
      {[{ key: 'calendar', Icon: CalIcon }, { key: 'count', Icon: CountIcon }].map(({ key, Icon }) => {
        const active = mode === key;
        return (
          <button key={key} onClick={e => { e.stopPropagation(); setMode(key); }} style={{
            padding: '3px 6px', borderRadius: 100, cursor: 'pointer', border: 'none',
            background: active ? 'var(--dl-glass-active, var(--dl-accent-13))' : 'transparent',
            color: active ? 'var(--dl-strong)' : 'var(--dl-middle)',
            display: 'flex', alignItems: 'center', transition: 'all 0.15s',
          }}>
            <Icon />
          </button>
        );
      })}
    </div>
  );
}

// ── HabitsCard ───────────────────────────────────────────────────────────────
export default function HabitsCard({ date, token, userId, habitMode = 'calendar' }) {
  const [habits, setHabits] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const scrollRef = useRef(null);

  // Drag-to-scroll via window mouse events (no pointer capture — allows cell clicks)
  const dragState = useRef({ dragging: false, startX: 0, scrollStart: 0, moved: false });

  const onMouseDown = useCallback(e => {
    const el = scrollRef.current;
    if (!el) return;
    // Only start drag on left button
    if (e.button !== 0) return;
    dragState.current = { dragging: true, startX: e.clientX, scrollStart: el.scrollLeft, moved: false };
    el.style.cursor = 'grabbing';
  }, []);

  useEffect(() => {
    const onMove = e => {
      const ds = dragState.current;
      if (!ds.dragging) return;
      const dx = e.clientX - ds.startX;
      if (Math.abs(dx) > 3) ds.moved = true;
      if (scrollRef.current) scrollRef.current.scrollLeft = ds.scrollStart - dx;
    };
    const onUp = () => {
      dragState.current.dragging = false;
      if (scrollRef.current) scrollRef.current.style.cursor = 'grab';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  const today = todayKey();
  const startDate = addDays(date || today, -42);
  const endDate = addDays(date || today, 14);

  const dates = [];
  for (let d = startDate; d <= endDate; d = addDays(d, 1)) dates.push(d);

  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  // Re-fetch when tasks are saved
  useEffect(() => {
    window.addEventListener('daylab:tasks-saved', refresh);
    return () => window.removeEventListener('daylab:tasks-saved', refresh);
  }, [refresh]);

  useEffect(() => {
    if (!token || !userId) return;
    let cancelled = false;
    setLoading(true);
    api.get(`/api/habits?start=${startDate}&end=${endDate}`, token)
      .then(data => { if (!cancelled) { setHabits(data?.habits ?? []); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, userId, startDate, endDate, refreshKey]);

  // Auto-scroll to center today
  useEffect(() => {
    if (!scrollRef.current || loading) return;
    const todayIdx = dates.indexOf(today);
    if (todayIdx >= 0) {
      const colW = habitMode === 'count' ? 18 : 28;
      const containerW = scrollRef.current.clientWidth;
      scrollRef.current.scrollLeft = Math.max(0, todayIdx * colW - containerW / 2);
    }
  }, [loading, today, habitMode]);

  // Toggle a habit completion for a specific date
  const toggleCompletion = useCallback(async (habit, cellDate) => {
    if (!token) return;
    const wasDone = habit.completions?.[cellDate] === true;

    // Optimistic update
    setHabits(prev => prev?.map(h => {
      if (h.id !== habit.id) return h;
      const newCompletions = { ...h.completions, [cellDate]: !wasDone };
      return { ...h, completions: newCompletions };
    }));

    try {
      if (wasDone) {
        // Uncomplete: find the completion task for this date and delete it
        const res = await api.get(`/api/tasks?date=${cellDate}`, token);
        const tasks = res?.tasks ?? [];
        const habitKey = (habit.matchKey || habit.text || '').toLowerCase();
        const match = tasks.find(t => {
          // Use same centralized cleaning logic
          const cText = (t.text || '')
            .replace(/\{[^}]+\}/g, '').replace(/\/[hr]\s+\S+/gi, '')
            .replace(/🎯\s*[A-Za-z·\s]+/g, '').replace(/↻\s*[A-Za-z·\s]+/g, '')
            .replace(/@\d{4}-\d{2}-\d{2}/g, '').replace(/\s+/g, ' ')
            .trim().toLowerCase();
          return cText === habitKey && t.done;
        });
        if (match) {
          // Soft-delete the completion row rather than patching done=false
          await api.delete(`/api/tasks?id=${match.id}`, token);
        }
      } else {
        // Complete: create a completion row via complete-recurring
        await api.post('/api/tasks/complete-recurring', {
          template_id: habit.id,
          date: cellDate,
        }, token);
      }
      // Notify tasks card to reload
      window.dispatchEvent(new CustomEvent('daylab:habits-changed'));
      // Delay refresh slightly to let the API settle
      setTimeout(() => refresh(), 300);
    } catch (err) {
      console.warn('[habits] toggle failed:', err);
      refresh();
    }
  }, [token, refresh]);

  if (loading || !habits) {
    return (
      <div style={{ padding: '4px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Shimmer width="80%" height={14} /><Shimmer width="60%" height={14} />
      </div>
    );
  }

  if (habits.length === 0) {
    return (
      <div style={{ fontFamily: mono, fontSize: F.sm, color: 'var(--dl-middle)', padding: '16px 0', textAlign: 'center', letterSpacing: '0.04em' }}>
        No habits yet — use /h in tasks to tag one
      </div>
    );
  }

  const mode = habitMode;
  const colW = mode === 'count' ? 18 : 28;
  const rowH = mode === 'count' ? 18 : 24;
  const cellSize = mode === 'count' ? 14 : 18;

  // In count mode, only show dates where ANY habit is scheduled
  const visibleDates = mode === 'count'
    ? dates.filter(d => habits.some(h => h.completions?.hasOwnProperty(d)))
    : dates;

  // Precompute month boundary indices (where dayNum === 1, excluding first column)
  const monthBoundaries = new Set();
  for (let i = 1; i < visibleDates.length; i++) {
    if (dayNum(visibleDates[i]) === 1) monthBoundaries.add(i);
  }
  const dividerW = 20;

  return (
    <div style={{ display: 'flex', userSelect: 'none', WebkitUserSelect: 'none' }}>
      {/* Left: habit names table with COUNT and BEST columns */}
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 0 }}>
        {/* Header row — aligned with date header */}
        <div style={{ height: mode === 'calendar' ? 30 : rowH, display: 'flex', alignItems: 'flex-end', gap: 0, paddingRight: 10, paddingBottom: 2 }}>
          <span style={{ flex: 1 }} />
          <span style={{ fontFamily: mono, fontSize: 9, color: 'var(--dl-middle)', letterSpacing: '0.06em', textTransform: 'uppercase', width: 44, textAlign: 'center' }}>
            count
          </span>
          <span style={{ fontFamily: mono, fontSize: 9, color: 'var(--dl-middle)', letterSpacing: '0.06em', textTransform: 'uppercase', width: 36, textAlign: 'center' }}>
            best
          </span>
        </div>
        {/* Habit rows */}
        {habits.map(h => (
          <div key={h.id} style={{ height: rowH, display: 'flex', alignItems: 'center', gap: 0, paddingRight: 10 }}>
            <span style={{ fontFamily: mono, fontSize: 12, color: 'var(--dl-strong)', fontWeight: 500, lineHeight: 1, whiteSpace: 'nowrap', flex: 1, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {h.text}
            </span>
            <div style={{ width: 44, display: 'flex', justifyContent: 'center' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 2,
                padding: '1px 5px', borderRadius: 100,
                border: `1.5px solid ${streakColor(h.streak, h.frozen)}`,
                background: streakBg(h.streak, h.frozen),
                fontFamily: mono, fontSize: 11, fontWeight: 600, lineHeight: 1,
                color: streakColor(h.streak, h.frozen), whiteSpace: 'nowrap',
              }}>
                <span style={{ fontSize: 10, lineHeight: 1 }}>{streakEmoji(h.streak, h.frozen)}</span>
                {h.streak}
              </span>
            </div>
            <span style={{ fontFamily: mono, fontSize: 11, color: 'var(--dl-middle)', lineHeight: 1, width: 36, textAlign: 'center' }}>
              {h.bestStreak || '\u2014'}
            </span>
          </div>
        ))}
      </div>

      {/* Right: scrollable grid */}
      <div
        ref={scrollRef}
        onMouseDown={onMouseDown}
        style={{
          flex: 1, overflowX: 'auto', overflowY: 'hidden', cursor: 'grab',
          scrollbarWidth: 'none', msOverflowStyle: 'none',
          margin: '0 -14px 0 0', paddingRight: 14,
          userSelect: 'none', WebkitUserSelect: 'none',
        }}
      >
        <div style={{ display: 'inline-flex', flexDirection: 'column', minWidth: visibleDates.length * colW + monthBoundaries.size * dividerW }}>

          {/* Header spacer + date header */}
          <div style={{ height: mode === 'calendar' ? 30 : rowH }}>
            {mode === 'calendar' && (
              <div style={{ display: 'flex', height: 30, alignItems: 'flex-end' }}>
                {visibleDates.map((d, i) => {
                  const isToday = d === today;
                  const isBoundary = monthBoundaries.has(i);
                  return (
                    <React.Fragment key={d}>
                      {isBoundary && <div style={{ width: dividerW }} />}
                      <div style={{ width: colW, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 2 }}>
                        <span style={{ fontFamily: mono, fontSize: 9, color: isToday ? 'var(--dl-accent)' : 'var(--dl-middle)', fontWeight: isToday ? 700 : 400, lineHeight: 1 }}>
                          {dayLabel(d)}
                        </span>
                        <span style={{ fontFamily: mono, fontSize: 9, color: isToday ? 'var(--dl-accent)' : d === date ? 'var(--dl-strong)' : 'var(--dl-middle)', fontWeight: isToday ? 700 : 400, lineHeight: 1 }}>
                          {dayNum(d)}
                        </span>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            )}
          </div>

          {/* Habit grid rows */}
          {habits.map(h => (
            <div key={h.id} style={{ display: 'flex', height: rowH }}>
              {visibleDates.map((d, i) => {
                const scheduled = h.completions?.hasOwnProperty(d);
                const done = h.completions?.[d] === true;
                const isPast = d <= today;
                const isBoundary = monthBoundaries.has(i);

                // Month divider column
                const divider = isBoundary ? (
                  <MonthDivider key={`div-${d}`} label={monthLabel(d)} height={rowH * habits.length} rowIndex={habits.indexOf(h)} rowH={rowH} />
                ) : null;

                if (!scheduled) {
                  return (
                    <React.Fragment key={d}>
                      {divider}
                      {mode === 'calendar' ? <div style={{ width: colW }} /> : null}
                    </React.Fragment>
                  );
                }

                return (
                  <React.Fragment key={d}>
                    {divider}
                    <div style={{ width: colW, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div
                        onClick={e => {
                          if (dragState.current.moved) return;
                          if (isPast) toggleCompletion(h, d);
                        }}
                        style={{
                          width: cellSize, height: cellSize, borderRadius: 4,
                          background: done ? 'var(--dl-accent)' : 'transparent',
                          border: done ? 'none' : `1.5px solid ${isPast ? 'var(--dl-border2)' : 'var(--dl-border)'}`,
                          opacity: !isPast && !done ? 0.35 : 1,
                          transition: 'all 0.15s',
                          cursor: isPast ? 'pointer' : 'default',
                        }}
                      />
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Month divider — vertical line with rotated month label ───────────────────
function MonthDivider({ label, height, rowIndex, rowH }) {
  // Only render the label + full line on the first habit row
  if (rowIndex !== 0) {
    return <div style={{ width: 20, position: 'relative' }}>
      <div style={{ position: 'absolute', left: 9, top: 0, bottom: 0, width: 1, background: 'var(--dl-border)' }} />
    </div>;
  }

  return (
    <div style={{ width: 20, position: 'relative' }}>
      {/* Vertical line spanning all rows */}
      <div style={{
        position: 'absolute', left: 9, top: -30, width: 1,
        height: height + 30,
        background: 'var(--dl-border)',
      }} />
      {/* Rotated month label centered on the line */}
      <div style={{
        position: 'absolute', left: 0, top: -24, width: 20, height: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{
          fontFamily: mono, fontSize: 8, fontWeight: 600,
          color: 'var(--dl-middle)', letterSpacing: '0.06em',
          textTransform: 'uppercase', whiteSpace: 'nowrap',
          transform: 'rotate(-90deg)',
          background: 'var(--dl-card, var(--dl-bg))',
          padding: '0 2px',
        }}>
          {label}
        </span>
      </div>
    </div>
  );
}
