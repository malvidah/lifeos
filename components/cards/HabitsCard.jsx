"use client";
import { useState, useEffect, useRef, useCallback } from "react";
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
        // Uncomplete: find the completion task for this date and mark done=false
        // We need to find the task ID — fetch tasks for that date
        const res = await api.get(`/api/tasks?date=${cellDate}`, token);
        const tasks = res?.tasks ?? [];
        const cleanHabitText = habit.text.trim().toLowerCase();
        const match = tasks.find(t => {
          const cText = (t.text || '')
            .replace(/\{[^}]+\}/g, '').replace(/\/[hr]\s+\S+/gi, '').replace(/@\d{4}-\d{2}-\d{2}/g, '')
            .trim().toLowerCase();
          return cText === cleanHabitText && t.done;
        });
        if (match) {
          await api.patch('/api/tasks', { id: match.id, done: false }, token);
        }
      } else {
        // Complete: create a completion row via complete-recurring
        await api.post('/api/tasks/complete-recurring', {
          template_id: habit.id,
          date: cellDate,
        }, token);
      }
      // Refresh to get accurate streak counts
      refresh();
      // Notify tasks card to reload (separate event to avoid circular refresh)
      window.dispatchEvent(new CustomEvent('daylab:habits-changed'));
    } catch (err) {
      console.warn('[habits] toggle failed:', err);
      refresh(); // revert optimistic update
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
            <span style={{ fontFamily: mono, fontSize: 13, color: 'var(--dl-strong)', fontWeight: 500, lineHeight: 1, whiteSpace: 'nowrap', flex: 1 }}>
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
        <div style={{ display: 'inline-flex', flexDirection: 'column', minWidth: visibleDates.length * colW }}>

          {/* Header spacer + date header */}
          <div style={{ height: mode === 'calendar' ? 30 : rowH }}>
            {mode === 'calendar' && (
              <div style={{ display: 'flex', height: 30, alignItems: 'flex-end' }}>
                {visibleDates.map((d, i) => {
                  const isToday = d === today;
                  const showMonth = i === 0 || dayNum(d) === 1;
                  return (
                    <div key={d} style={{ width: colW, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', position: 'relative', paddingBottom: 2 }}>
                      {showMonth && (
                        <span style={{ fontFamily: mono, fontSize: 8, color: 'var(--dl-middle)', letterSpacing: '0.04em', textTransform: 'uppercase', position: 'absolute', top: 0 }}>
                          {monthLabel(d)}
                        </span>
                      )}
                      <span style={{ fontFamily: mono, fontSize: 9, color: isToday ? 'var(--dl-accent)' : 'var(--dl-middle)', fontWeight: isToday ? 700 : 400, lineHeight: 1 }}>
                        {dayLabel(d)}
                      </span>
                      <span style={{ fontFamily: mono, fontSize: 9, color: isToday ? 'var(--dl-accent)' : d === date ? 'var(--dl-strong)' : 'var(--dl-middle)', fontWeight: isToday ? 700 : 400, lineHeight: 1 }}>
                        {dayNum(d)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Habit grid rows */}
          {habits.map(h => (
            <div key={h.id} style={{ display: 'flex', height: rowH }}>
              {visibleDates.map(d => {
                const scheduled = h.completions?.hasOwnProperty(d);
                const done = h.completions?.[d] === true;
                const isPast = d <= today;

                if (!scheduled) {
                  return mode === 'calendar' ? <div key={d} style={{ width: colW }} /> : null;
                }

                return (
                  <div key={d} style={{ width: colW, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div
                      onClick={e => {
                        // Don't toggle if we just dragged
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
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
