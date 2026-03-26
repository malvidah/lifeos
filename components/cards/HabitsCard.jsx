"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { mono, F } from "@/lib/tokens";
import { api } from "@/lib/api";
import { todayKey } from "@/lib/dates";
import { Shimmer } from "../ui/primitives.jsx";

// ── Streak state helpers ─────────────────────────────────────────────────────
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

// ── Date helpers ─────────────────────────────────────────────────────────────
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function dayLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return ['S','M','T','W','R','F','S'][d.getDay()];
}

function monthLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
}

function dayNum(dateStr) {
  return parseInt(dateStr.slice(8), 10);
}

// ── Drag-to-scroll hook ──────────────────────────────────────────────────────
function useDragScroll(ref) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const scrollStart = useRef(0);

  const onMouseDown = useCallback(e => {
    if (!ref.current) return;
    dragging.current = true;
    startX.current = e.clientX;
    scrollStart.current = ref.current.scrollLeft;
    ref.current.style.cursor = 'grabbing';
    ref.current.style.userSelect = 'none';
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onMove = e => {
      if (!dragging.current) return;
      const dx = e.clientX - startX.current;
      el.scrollLeft = scrollStart.current - dx;
    };
    const onUp = () => {
      dragging.current = false;
      el.style.cursor = 'grab';
      el.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [ref]);

  return { onMouseDown };
}

// ── Mode toggle for card header ──────────────────────────────────────────────
const CalIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="12" height="11" rx="2"/>
    <line x1="2" y1="7" x2="14" y2="7"/>
    <line x1="6" y1="3" x2="6" y2="1"/>
    <line x1="10" y1="3" x2="10" y2="1"/>
  </svg>
);

const CountIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="5" width="4" height="4" rx="1"/>
    <rect x="6" y="5" width="4" height="4" rx="1"/>
    <rect x="11" y="5" width="4" height="4" rx="1"/>
  </svg>
);

export function HabitModeBtns({ mode, setMode }) {
  return (
    <div style={{
      display: 'flex', gap: 2,
      background: 'var(--dl-border-15, rgba(128,120,100,0.1))',
      borderRadius: 100, padding: 2,
    }}>
      {[{ key: 'calendar', Icon: CalIcon }, { key: 'count', Icon: CountIcon }].map(({ key, Icon }) => {
        const active = mode === key;
        return (
          <button key={key} onClick={e => { e.stopPropagation(); setMode(key); }} style={{
            padding: '3px 6px', borderRadius: 100, cursor: 'pointer', border: 'none',
            background: active ? 'var(--dl-glass-active, var(--dl-accent-13))' : 'transparent',
            color: active ? 'var(--dl-strong)' : 'var(--dl-middle)',
            display: 'flex', alignItems: 'center',
            transition: 'all 0.15s',
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
  const { onMouseDown } = useDragScroll(scrollRef);

  const today = todayKey();
  const startDate = addDays(date || today, -42);
  const endDate = addDays(date || today, 14);

  const dates = [];
  for (let d = startDate; d <= endDate; d = addDays(d, 1)) dates.push(d);

  // Re-fetch when tasks are saved (new habit added, completion toggled, etc.)
  useEffect(() => {
    const onTasksSaved = () => setRefreshKey(k => k + 1);
    window.addEventListener('daylab:tasks-saved', onTasksSaved);
    return () => window.removeEventListener('daylab:tasks-saved', onTasksSaved);
  }, []);

  useEffect(() => {
    if (!token || !userId) return;
    let cancelled = false;
    setLoading(true);

    api.get(`/api/habits?start=${startDate}&end=${endDate}`, token)
      .then(data => {
        if (cancelled) return;
        setHabits(data?.habits ?? []);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [token, userId, startDate, endDate, refreshKey]);

  // Auto-scroll to center today
  useEffect(() => {
    if (!scrollRef.current || loading) return;
    const todayIdx = dates.indexOf(today);
    if (todayIdx >= 0) {
      const colW = 30;
      const containerW = scrollRef.current.clientWidth;
      const offset = Math.max(0, todayIdx * colW - containerW / 2);
      scrollRef.current.scrollLeft = offset;
    }
  }, [loading, today, habitMode]);

  if (loading || !habits) {
    return (
      <div style={{ padding: '4px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Shimmer width="80%" height={14} />
        <Shimmer width="60%" height={14} />
      </div>
    );
  }

  if (habits.length === 0) {
    return (
      <div style={{
        fontFamily: mono, fontSize: F.sm, color: 'var(--dl-middle)',
        padding: '16px 0', textAlign: 'center', letterSpacing: '0.04em',
      }}>
        No habits yet — use /h in tasks to tag one
      </div>
    );
  }

  const mode = habitMode;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {habits.map(h => (
        <HabitRow key={h.id} habit={h} dates={dates} today={today} date={date}
          mode={mode} scrollRef={scrollRef} onMouseDown={onMouseDown} />
      ))}
    </div>
  );
}

// ── Single habit row ─────────────────────────────────────────────────────────
function HabitRow({ habit, dates, today, date, mode, scrollRef, onMouseDown }) {
  const h = habit;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* Name row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 15, lineHeight: 1 }}>
          {streakEmoji(h.streak, h.frozen)}
        </span>
        <span style={{
          fontFamily: mono, fontSize: 13, color: 'var(--dl-strong)',
          fontWeight: 500, lineHeight: 1,
        }}>
          {h.text}
        </span>
        <span style={{
          fontFamily: mono, fontSize: 13,
          color: streakColor(h.streak, h.frozen),
          fontWeight: 700, lineHeight: 1, marginLeft: 2,
        }}>
          {h.streak}
        </span>
        {h.bestStreak > 0 && (
          <span style={{
            fontFamily: mono, fontSize: 11,
            color: 'var(--dl-middle)', lineHeight: 1,
          }}>
            best {h.bestStreak}
          </span>
        )}
      </div>

      {/* Grid area */}
      {mode === 'calendar' ? (
        <CalendarStrip habit={h} dates={dates} today={today} date={date}
          scrollRef={scrollRef} onMouseDown={onMouseDown} />
      ) : (
        <CountStrip habit={h} dates={dates} today={today} />
      )}
    </div>
  );
}

// ── Calendar mode: draggable date strip ──────────────────────────────────────
function CalendarStrip({ habit, dates, today, date, scrollRef, onMouseDown }) {
  const colW = 30;

  return (
    <div ref={scrollRef} onMouseDown={onMouseDown} style={{
      overflowX: 'auto', overflowY: 'hidden', cursor: 'grab',
      scrollbarWidth: 'none', msOverflowStyle: 'none',
      margin: '0 -14px', padding: '0 14px',
    }}>
      <div style={{ display: 'inline-flex', flexDirection: 'column', minWidth: dates.length * colW }}>
        {/* Date header */}
        <div style={{ display: 'flex', height: 24 }}>
          {dates.map((d, i) => {
            const isToday = d === today;
            const showMonth = i === 0 || dayNum(d) === 1;
            return (
              <div key={d} style={{
                width: colW, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'flex-end', position: 'relative',
              }}>
                {showMonth && (
                  <span style={{
                    fontFamily: mono, fontSize: 8, color: 'var(--dl-middle)',
                    letterSpacing: '0.04em', textTransform: 'uppercase',
                    position: 'absolute', top: -2,
                  }}>
                    {monthLabel(d)}
                  </span>
                )}
                <span style={{
                  fontFamily: mono, fontSize: 9,
                  color: isToday ? 'var(--dl-accent)' : 'var(--dl-middle)',
                  fontWeight: isToday ? 700 : 400, lineHeight: 1,
                }}>
                  {dayLabel(d)}
                </span>
                <span style={{
                  fontFamily: mono, fontSize: 9,
                  color: isToday ? 'var(--dl-accent)' : d === date ? 'var(--dl-strong)' : 'var(--dl-middle)',
                  fontWeight: isToday ? 700 : 400, lineHeight: 1,
                }}>
                  {dayNum(d)}
                </span>
              </div>
            );
          })}
        </div>

        {/* Checkbox row */}
        <div style={{ display: 'flex', height: 28 }}>
          {dates.map(d => {
            const scheduled = habit.completions?.hasOwnProperty(d);
            const done = habit.completions?.[d] === true;
            const isPast = d <= today;

            if (!scheduled) return <div key={d} style={{ width: colW }} />;

            return (
              <div key={d} style={{
                width: colW, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <CheckBox done={done} isPast={isPast} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Count mode: compact checkboxes, no gaps ──────────────────────────────────
function CountStrip({ habit, dates, today }) {
  const scheduledDates = dates.filter(d => habit.completions?.hasOwnProperty(d));

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
      {scheduledDates.map(d => {
        const done = habit.completions?.[d] === true;
        const isPast = d <= today;
        return <CheckBox key={d} done={done} isPast={isPast} size={14} />;
      })}
    </div>
  );
}

// ── Shared checkbox ──────────────────────────────────────────────────────────
function CheckBox({ done, isPast, size = 16 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 4,
      border: `1.5px solid ${done ? 'var(--dl-accent)' : isPast ? 'var(--dl-border2)' : 'var(--dl-border)'}`,
      background: done ? 'var(--dl-accent)' : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all 0.15s',
      cursor: isPast ? 'pointer' : 'default',
      opacity: !isPast && !done ? 0.4 : 1,
      flexShrink: 0,
    }}>
      {done && (
        <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 10 10" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1.5,5 4,7.5 8.5,2"/>
        </svg>
      )}
    </div>
  );
}
