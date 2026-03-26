"use client";
import { useState, useEffect, useRef } from "react";
import { mono, F } from "@/lib/tokens";
import { api } from "@/lib/api";
import { todayKey } from "@/lib/dates";
import { Shimmer } from "../ui/primitives.jsx";

// ── Streak state helpers ─────────────────────────────────────────────────────
// streak > 0 + not frozen → fire (active streak)
// frozen → snowflake (one miss forgiven)
// streak === 0 → horse (get back on)
function streakEmoji(streak, frozen) {
  if (frozen) return '\u2744\uFE0F'; // snowflake
  if (streak > 0) return '\uD83D\uDD25'; // fire
  return '\uD83D\uDC0E'; // horse
}

function streakColor(streak, frozen) {
  if (frozen) return '#7CB8D4'; // frost blue
  if (streak > 0) return 'var(--dl-accent)'; // orange
  return 'var(--dl-middle)'; // muted
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

// ── HabitsCard ───────────────────────────────────────────────────────────────
export default function HabitsCard({ date, token, userId }) {
  const [habits, setHabits] = useState(null);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef(null);

  // Show 28 days centered around selected date (21 before, 7 after)
  const today = todayKey();
  const startDate = addDays(date || today, -21);
  const endDate = addDays(date || today, 7);

  // Generate column dates
  const dates = [];
  for (let d = startDate; d <= endDate; d = addDays(d, 1)) {
    dates.push(d);
  }

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
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [token, userId, startDate, endDate]);

  // Auto-scroll to show today on mount
  useEffect(() => {
    if (!scrollRef.current || loading) return;
    const todayIdx = dates.indexOf(today);
    if (todayIdx >= 0) {
      const colWidth = 28;
      const offset = Math.max(0, (todayIdx - 4) * colWidth);
      scrollRef.current.scrollLeft = offset;
    }
  }, [loading, today]);

  if (loading || !habits) {
    return (
      <div style={{ padding: '4px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Shimmer width="80%" height={13} />
        <Shimmer width="60%" height={13} />
      </div>
    );
  }

  if (habits.length === 0) {
    return (
      <div style={{
        fontFamily: mono, fontSize: F.sm, color: 'var(--dl-middle)',
        padding: '12px 0', textAlign: 'center', letterSpacing: '0.04em',
      }}>
        No habits yet — use /h in tasks to tag one
      </div>
    );
  }

  const colW = 28;
  const rowH = 28;
  const nameW = 100;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Grid */}
      <div style={{ display: 'flex' }}>
        {/* Habit names column */}
        <div style={{ width: nameW, flexShrink: 0, paddingTop: rowH }}>
          {habits.map(h => (
            <div key={h.id} style={{
              height: rowH, display: 'flex', alignItems: 'center', gap: 4,
              paddingRight: 8,
            }}>
              <span style={{ fontSize: 13, lineHeight: 1 }}>
                {streakEmoji(h.streak, h.frozen)}
              </span>
              <span style={{
                fontFamily: mono, fontSize: 11, color: 'var(--dl-strong)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                flex: 1, lineHeight: 1,
              }}>
                {h.text}
              </span>
              <span style={{
                fontFamily: mono, fontSize: 10,
                color: streakColor(h.streak, h.frozen),
                fontWeight: 600, lineHeight: 1, flexShrink: 0,
              }}>
                {h.streak}
              </span>
            </div>
          ))}
        </div>

        {/* Scrollable grid */}
        <div ref={scrollRef} style={{
          flex: 1, overflowX: 'auto', overflowY: 'hidden',
          scrollbarWidth: 'none', msOverflowStyle: 'none',
        }}>
          <div style={{ display: 'inline-flex', flexDirection: 'column', minWidth: dates.length * colW }}>
            {/* Date header row */}
            <div style={{ display: 'flex', height: rowH }}>
              {dates.map((d, i) => {
                const isToday = d === today;
                const isSelected = d === date;
                const showMonth = i === 0 || dayNum(d) === 1;
                return (
                  <div key={d} style={{
                    width: colW, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 0,
                    position: 'relative',
                  }}>
                    {showMonth && (
                      <span style={{
                        fontFamily: mono, fontSize: 8, color: 'var(--dl-middle)',
                        letterSpacing: '0.04em', textTransform: 'uppercase',
                        position: 'absolute', top: -1,
                      }}>
                        {monthLabel(d)}
                      </span>
                    )}
                    <span style={{
                      fontFamily: mono, fontSize: 9,
                      color: isToday ? 'var(--dl-accent)' : 'var(--dl-middle)',
                      fontWeight: isToday ? 700 : 400,
                      lineHeight: 1, marginTop: 8,
                    }}>
                      {dayLabel(d)}
                    </span>
                    <span style={{
                      fontFamily: mono, fontSize: 9,
                      color: isToday ? 'var(--dl-accent)' : isSelected ? 'var(--dl-strong)' : 'var(--dl-middle)',
                      fontWeight: isToday ? 700 : 400,
                      lineHeight: 1,
                    }}>
                      {dayNum(d)}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Habit rows */}
            {habits.map(h => (
              <div key={h.id} style={{ display: 'flex', height: rowH }}>
                {dates.map(d => {
                  const scheduled = h.completions?.hasOwnProperty(d);
                  const done = h.completions?.[d] === true;
                  const isPast = d <= today;

                  if (!scheduled) {
                    return <div key={d} style={{ width: colW }} />;
                  }

                  return (
                    <div key={d} style={{
                      width: colW, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <div style={{
                        width: 16, height: 16, borderRadius: 4,
                        border: `1.5px solid ${done ? 'var(--dl-accent)' : isPast ? 'var(--dl-border2)' : 'var(--dl-border)'}`,
                        background: done ? 'var(--dl-accent)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.15s',
                        cursor: isPast ? 'pointer' : 'default',
                        opacity: !isPast && !done ? 0.4 : 1,
                      }}>
                        {done && (
                          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="1.5,5 4,7.5 8.5,2"/>
                          </svg>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
