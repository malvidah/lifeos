"use client";
import { pushHistory } from "@/lib/db";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { serif, mono, F, R } from "@/lib/tokens";
import { toKey, todayKey, shift, dayOffset, offsetToDate, keyToDayNum, MONTHS_FULL, MONTHS_SHORT, DAYS_SHORT } from "@/lib/dates";
import { useIsMobile } from "@/lib/hooks";
import { Card, NavBtn, ChevronBtn } from "../ui/primitives.jsx";
import { api } from "@/lib/api";

const BIG_EVENT_KEYWORDS = /birthday|bday|anniversary|wedding|graduation|party|trip|camping|hike|concert|festival|game.?night|board.?game|vacation|holiday|travel|flight|conference|retreat|summit|christm|thanksgiv|new.?year|halloween|passover|hanukkah|diwali|eid|week.?off|day.?off|surgery|date.?night|show|performance|recital|marathon|race|gala|ceremony|opening.?night|potluck|picnic|reunion|sleepover|road.?trip/i;

function isBigEvent(ev) {
  if (!ev) return false;
  if (ev.allDay || ev.time === 'all day') return true;
  return BIG_EVENT_KEYWORDS.test(ev.title || '');
}

function MonthView({ initYear, initMonth, selected, onSelectDay, onMonthChange, healthDots, events, token }) {
  const [summaries,    setSummaries]    = useState({});
  const [summaryCache, setSummaryCache] = useState({});

  // ── Physics ────────────────────────────────────────────────────────────
  // liveOff = fractional month index (year*12 + month)
  const liveOff    = useRef(initYear * 12 + initMonth);
  const vel        = useRef(0);
  const rafId      = useRef(null);
  const dragBase   = useRef(0);
  const startY     = useRef(0);
  const lastY      = useRef(0);
  const touchVel   = useRef(0);
  const totalDrag  = useRef(0);
  const isDragging = useRef(false);
  const containerRef = useRef(null);
  const [displayOff, setDisplayOff] = useState(initYear * 12 + initMonth);

  // Responsive sizing — derive CELL_H from available height so months pack tight
  // Component is loaded with ssr:false, so window is always available at init
  const [vw, setVw] = useState(() => typeof window !== 'undefined' ? window.innerWidth : 1200);
  useEffect(()=>{
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener('resize', onResize);
    return ()=>window.removeEventListener('resize', onResize);
  },[]);
  const DAY_HDR_H_C = 20;
  const LABEL_H   = 18;
  const MONTH_H   = vw < 600 ? 340 : 400;
  const SCROLL_H_C = MONTH_H - DAY_HDR_H_C;
  const CELL_H    = Math.floor((SCROLL_H_C - LABEL_H - 5 * 2) / 6); // 5 gaps of 2px between 6 rows

  // Use refs for callbacks so mount-only listeners always see fresh values
  const repaint    = useRef(null);
  const cancelRaf  = useRef(null);
  const snapTo     = useRef(null);
  const doMomentum = useRef(null);
  const animateTo  = useRef(null);

  repaint.current = () => setDisplayOff(liveOff.current);

  cancelRaf.current = () => {
    if (rafId.current) { cancelAnimationFrame(rafId.current); rafId.current = null; }
  };

  snapTo.current = (target) => {
    cancelRaf.current();
    liveOff.current = target;
    vel.current = 0;
    repaint.current();
    const yr = Math.floor(target / 12);
    const mo = ((target % 12) + 12) % 12;
    onMonthChange(yr, mo);
  };

  doMomentum.current = () => {
    cancelRaf.current();
    const step = () => {
      vel.current *= 0.88;          // gentle friction — long, smooth coast
      liveOff.current += vel.current;
      const target = Math.round(liveOff.current * 4) / 4; // snap to nearest week (~0.25 month)
      liveOff.current += (target - liveOff.current) * 0.08; // soft spring
      if (Math.abs(vel.current) < 0.0008 && Math.abs(liveOff.current - target) < 0.0008) {
        snapTo.current(target); return;
      }
      repaint.current();
      rafId.current = requestAnimationFrame(step);
    };
    rafId.current = requestAnimationFrame(step);
  };

  animateTo.current = (target) => {
    cancelRaf.current();
    const step = () => {
      const diff = target - liveOff.current;
      if (Math.abs(diff) < 0.001) { snapTo.current(target); return; }
      liveOff.current += diff * 0.12; // softer spring — feels like settling
      repaint.current();
      rafId.current = requestAnimationFrame(step);
    };
    rafId.current = requestAnimationFrame(step);
  };

  useEffect(() => () => cancelRaf.current(), []);

  // Sync when parent changes month (e.g. selecting a date)
  useEffect(() => {
    const target = initYear * 12 + initMonth;
    if (Math.abs(liveOff.current - target) > 0.5) animateTo.current(target);
  }, [initYear, initMonth]); // eslint-disable-line

  // ── Mount-only global listeners (refs keep them fresh) ─────────────────
  useEffect(() => {
    const onMouseMove = (e) => {
      if (!isDragging.current) return;
      const dy = e.clientY - startY.current;
      totalDrag.current = Math.abs(dy);
      // drag DOWN = past (lower liveOff), drag UP = future (higher liveOff)
      liveOff.current = dragBase.current - dy / MONTH_H;
      touchVel.current = -(e.clientY - lastY.current) / MONTH_H;
      lastY.current = e.clientY;
      repaint.current();
    };
    const onMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      vel.current = touchVel.current * 2.0;
      if (Math.abs(vel.current) > 0.008) doMomentum.current();
      else snapTo.current(Math.round(liveOff.current * 4) / 4);
    };
    let wheelTimer = null;
    const onWheel = (e) => {
      if (!containerRef.current?.contains(e.target)) return;
      e.preventDefault();
      cancelRaf.current();
      isDragging.current = false;
      // scroll DOWN = future (deltaY positive → increase liveOff)
      const delta = e.deltaY / (Math.abs(e.deltaY) > 50 ? 600 : 130);
      liveOff.current += delta;
      repaint.current();
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => snapTo.current(Math.round(liveOff.current * 4) / 4), 200);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',   onMouseUp);
    window.addEventListener('wheel',     onWheel, { passive: false });
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',   onMouseUp);
      window.removeEventListener('wheel',     onWheel);
      if (wheelTimer) clearTimeout(wheelTimer);
    };
  }, []); // mount only

  // Touch handlers via JSX
  const handleTouchStart = (e) => {
    cancelRaf.current();
    isDragging.current = true;
    totalDrag.current  = 0;
    startY.current     = e.touches[0].clientY;
    lastY.current      = e.touches[0].clientY;
    dragBase.current   = liveOff.current;
    touchVel.current   = 0;
  };
  const handleTouchMove = (e) => {
    if (!isDragging.current) return;
    e.preventDefault();
    const y  = e.touches[0].clientY;
    const dy = y - startY.current;
    totalDrag.current  = Math.abs(dy);
    liveOff.current    = dragBase.current - dy / MONTH_H; // up=future, down=past
    touchVel.current   = -(y - lastY.current) / MONTH_H;
    lastY.current      = y;
    repaint.current();
  };
  const handleTouchEnd = () => {
    if (!isDragging.current) return;
    isDragging.current = false;
    vel.current = touchVel.current * 2.0;
    if (Math.abs(vel.current) > 0.008) doMomentum.current();
    else snapTo.current(Math.round(liveOff.current * 4) / 4);
  };
  const handleMouseDown = (e) => {
    e.preventDefault();
    cancelRaf.current();
    isDragging.current = true;
    totalDrag.current  = 0;
    startY.current     = e.clientY;
    lastY.current      = e.clientY;
    dragBase.current   = liveOff.current;
    touchVel.current   = 0;
  };

  // ── Load AI summaries ──────────────────────────────────────────────────
  const snappedIdx = Math.round(displayOff);

  useEffect(() => {
    if (!token) return;
    [-1, 0, 1].forEach(offset => {
      const idx = snappedIdx + offset;
      const yr  = Math.floor(idx / 12);
      const mo  = ((idx % 12) + 12) % 12;
      const key = `${yr}-${mo}`;
      if (summaryCache[key] !== undefined) return;
      setSummaryCache(prev => ({ ...prev, [key]: null }));
      api.post('/api/month-summaries', { year: yr, month: mo }, token).then(d => {
        if (d?.summaries) setSummaries(prev => ({ ...prev, ...d.summaries }));
        setSummaryCache(prev => ({ ...prev, [key]: true }));
      }).catch(() => {});
    });
  }, [snappedIdx, token]); // eslint-disable-line

  // ── Helpers ────────────────────────────────────────────────────────────
  const today = todayKey();
  const DAY_NAMES   = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const MONTH_NAMES = ["January","February","March","April","May","June",
                       "July","August","September","October","November","December"];
  const fracOff = displayOff - snappedIdx;
  const N = 2;

  // Build a 42-cell (6-row) continuous grid for a given year/month.
  // Cells before day 1 come from the previous month; cells after the last day
  // come from the next month. Each cell: { day, dateKey, isOverflow }.
  // Memoized — grid structure only depends on year/month, not render state.
  const gridCache = useRef({});
  function buildGrid(yr, mo) {
    const cacheKey = `${yr}-${mo}`;
    if (gridCache.current[cacheKey]) return gridCache.current[cacheKey];
    const firstDow   = new Date(yr, mo, 1).getDay();
    const daysInMonth = new Date(yr, mo + 1, 0).getDate();

    // prev month overflow
    const prevDate   = new Date(yr, mo, 0); // last day of prev month
    const prevDays   = prevDate.getDate();
    const prevMo     = prevDate.getMonth();
    const prevYr     = prevDate.getFullYear();

    // next month
    const nextDate   = new Date(yr, mo + 1, 1);
    const nextMo     = nextDate.getMonth();
    const nextYr     = nextDate.getFullYear();

    const cells = [];
    // leading overflow from previous month
    for (let i = firstDow - 1; i >= 0; i--) {
      const d   = prevDays - i;
      const key = `${prevYr}-${String(prevMo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      cells.push({ day: d, dateKey: key, isOverflow: true });
    }
    // current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${yr}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      cells.push({ day: d, dateKey: key, isOverflow: false });
    }
    // trailing overflow to next month — fill to 42 cells (6 rows)
    let nextDay = 1;
    while (cells.length < 42) {
      const key = `${nextYr}-${String(nextMo+1).padStart(2,'0')}-${String(nextDay).padStart(2,'0')}`;
      cells.push({ day: nextDay, dateKey: key, isOverflow: true });
      nextDay++;
    }
    gridCache.current[cacheKey] = cells;
    return cells;
  }

  // ── Year scrubber state ───────────────────────────────────────────────
  const SCRUB_MIN_YR = 2020;
  const SCRUB_MAX_YR = 2030;
  const SCRUB_RANGE  = SCRUB_MAX_YR - SCRUB_MIN_YR; // 10 years
  const [scrubHover, setScrubHover] = useState(false);
  const [scrubDragging, setScrubDragging] = useState(false);
  const scrubRef = useRef(null);

  const currentYr = Math.floor(snappedIdx / 12);
  const currentMo = ((snappedIdx % 12) + 12) % 12;
  const thumbPct  = Math.max(0, Math.min(1, (currentYr - SCRUB_MIN_YR) / SCRUB_RANGE));

  const scrubJumpToY = (clientY) => {
    if (!scrubRef.current) return;
    const rect = scrubRef.current.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const yr   = Math.round(SCRUB_MIN_YR + pct * SCRUB_RANGE);
    animateTo.current(yr * 12 + currentMo);
  };

  useEffect(() => {
    if (!scrubDragging) return;
    const onMove = (e) => scrubJumpToY(e.touches ? e.touches[0].clientY : e.clientY);
    const onUp   = () => setScrubDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend',  onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend',  onUp);
    };
  }, [scrubDragging]); // eslint-disable-line

  const SCRUB_W    = vw < 600 ? 12 : 18; // narrower on mobile
  const DAY_HDR_H  = DAY_HDR_H_C;
  const SCROLL_H   = SCROLL_H_C;

  return (
    <div style={{ userSelect: 'none', touchAction: 'none' }}>

      {/* ── Fixed top row: scrubber gap + S M T W R F S ── */}
      <div style={{ display: 'flex', alignItems: 'center', height: DAY_HDR_H }}>
        {/* spacer matching scrubber width */}
        <div style={{ width: SCRUB_W, flexShrink: 0 }} />
        {/* day-of-week labels — never scroll */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
                      paddingRight: 4 }}>
          {DAY_NAMES.map((n, i) => (
            <div key={i} style={{
              textAlign: 'center', fontFamily: mono, fontSize: '8px',
              fontWeight: '500', letterSpacing: '0.06em', color: "var(--dl-middle)",
            }}>{n}</div>
          ))}
        </div>
      </div>

      {/* ── Scrollable area: scrubber + calendar pane side by side ── */}
      <div style={{ display: 'flex', height: SCROLL_H, overflow: 'hidden', position: 'relative' }}>

        {/* Year scrubber */}
        <div
          ref={scrubRef}
          onMouseEnter={() => setScrubHover(true)}
          onMouseLeave={() => setScrubHover(false)}
          onMouseDown={e => { e.stopPropagation(); setScrubDragging(true); scrubJumpToY(e.clientY); }}
          onTouchStart={e => { e.stopPropagation(); setScrubDragging(true); scrubJumpToY(e.touches[0].clientY); }}
          style={{
            width: SCRUB_W, flexShrink: 0, position: 'relative',
            cursor: 'ns-resize', display: 'flex', justifyContent: 'center',
            paddingTop: 4, paddingBottom: 4, boxSizing: 'border-box',
          }}
        >
          <div style={{
            width: 1, height: '100%',
            background: scrubHover || scrubDragging ? "var(--dl-border2)" : "var(--dl-border)",
            borderRadius: 1, transition: 'background 0.2s', position: 'relative',
          }}>
            <div style={{
              position: 'absolute', left: '50%', transform: 'translate(-50%, -50%)',
              top: `${thumbPct * 100}%`,
              width: scrubHover || scrubDragging ? 5 : 3,
              height: scrubHover || scrubDragging ? 20 : 14,
              borderRadius: 3,
              background: scrubHover || scrubDragging ? "var(--dl-accent)" : "var(--dl-highlight)",
              transition: 'width 0.15s, height 0.15s, background 0.15s',
            }} />
          </div>
          {(scrubHover || scrubDragging) && (
            <div style={{
              position: 'absolute', left: 20, top: `calc(${thumbPct * 100}% - 8px)`,
              fontFamily: mono, fontSize: '8px', letterSpacing: '0.08em',
              color: "var(--dl-accent)", whiteSpace: 'nowrap', pointerEvents: 'none',
              background: "var(--dl-bg)", padding: '1px 3px', borderRadius: 2,
            }}>{currentYr}</div>
          )}
        </div>

        {/* Main scrollable calendar pane */}
        <div
          ref={containerRef}
          style={{ flex: 1, overflow: 'hidden', position: 'relative',
                   cursor: isDragging.current ? 'grabbing' : 'grab' }}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {Array.from({ length: N * 2 + 1 }, (_, i) => i - N).map(relOffset => {
            const mIdx = snappedIdx + relOffset;
            const yr   = Math.floor(mIdx / 12);
            const mo   = ((mIdx % 12) + 12) % 12;
            const translateY = (relOffset - fracOff) * SCROLL_H;
            const cells = buildGrid(yr, mo);

            return (
              <div key={mIdx} style={{
                position: 'absolute', top: 0, left: 0, right: 0,
                transform: `translateY(${translateY}px)`,
                willChange: 'transform', height: SCROLL_H,
                padding: '0 4px 4px 4px', boxSizing: 'border-box',
                display: 'flex', flexDirection: 'column',
              }}>
                {/* Month name */}
                <div style={{
                  fontFamily: mono, fontSize: F.sm, fontWeight: 'normal',
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                  color: "var(--dl-highlight)", marginTop: 2, marginBottom: 4, flexShrink: 0,
                  paddingLeft: 2, overflow: 'hidden', whiteSpace: 'nowrap',
                }}>{MONTH_NAMES[mo]}</div>

                {/* 6-row grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridTemplateRows: `repeat(6, ${CELL_H}px)`, gap: 2, flex: 1 }}>
                  {cells.map(({ day, dateKey, isOverflow }, idx) => {
                    // Overflow cells are invisible spacers — no content, no border
                    if (isOverflow) return <div key={`sp-${idx}`} style={{ height: CELL_H }} />;

                    const isToday    = dateKey === today;
                    const isSelected = dateKey === selected;
                    const dots       = dateKey <= today ? (healthDots[dateKey] || {}) : {};
                    const summary    = summaries[dateKey];
                    const bigEvents  = (events[dateKey] || []).filter(isBigEvent).slice(0, 2);

                    return (
                      <div key={dateKey}
                        onClick={e => { e.stopPropagation(); if (totalDrag.current < 6) onSelectDay(dateKey); }}
                        style={{
                          height: CELL_H, overflow: 'hidden', borderRadius: 5, padding: '4px 4px 3px',
                          cursor: 'pointer', boxSizing: 'border-box',
                          background: isSelected ? "var(--dl-accent-10)" : isToday ? "var(--dl-accent-05)" : 'transparent',
                          border: `1px solid ${isSelected ? "var(--dl-accent-40)" : isToday ? "var(--dl-accent-20)" : "var(--dl-border-15)"}`,
                          display: 'flex', flexDirection: 'column', gap: 2,
                        }}
                      >
                        {/* Day number */}
                        <div style={{
                          fontFamily: serif, fontSize: '13px', lineHeight: 1,
                          fontWeight: isToday || isSelected ? '700' : 'normal',
                          color: isToday ? "var(--dl-strong)" : isSelected ? "var(--dl-accent)" : "var(--dl-highlight)",
                          flexShrink: 0,
                        }}>{day}</div>

                        {/* Health dots — full+bright >= 85, small+dim below, tiny grey no data */}
                        {dateKey <= today && (
                          <div style={{ display: 'flex', gap: 2, flexShrink: 0, alignItems: 'center' }}>
                            <div style={{ width: dots.sleep>=85?5:3, height: dots.sleep>=85?5:3, borderRadius: '50%', flexShrink: 0, background: dots.sleep>0?"var(--dl-blue)":"var(--dl-middle)", opacity: dots.sleep>=85?1:dots.sleep>0?0.35:0.2 }} />
                            <div style={{ width: dots.readiness>=85?5:3, height: dots.readiness>=85?5:3, borderRadius: '50%', flexShrink: 0, background: dots.readiness>0?"var(--dl-green)":"var(--dl-middle)", opacity: dots.readiness>=85?1:dots.readiness>0?0.35:0.2 }} />
                            <div style={{ width: dots.activity>=85?5:3, height: dots.activity>=85?5:3, borderRadius: '50%', flexShrink: 0, background: dots.activity>0?"var(--dl-accent)":"var(--dl-middle)", opacity: dots.activity>=85?1:dots.activity>0?0.35:0.2 }} />
                            <div style={{ width: dots.recovery>=85?5:3, height: dots.recovery>=85?5:3, borderRadius: '50%', flexShrink: 0, background: dots.recovery>0?"var(--dl-purple)":"var(--dl-middle)", opacity: dots.recovery>=85?1:dots.recovery>0?0.35:0.2 }} />
                          </div>
                        )}

                        {/* Big events:
                             mobile → fixed-height 3px color bars (no text, no height expansion)
                             desktop → text pill as before */}
                        {vw < 600 ? (
                          bigEvents.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0, marginTop: 1 }}>
                              {bigEvents.map((ev, j) => (
                                <div key={j} style={{
                                  height: 3, borderRadius: 2,
                                  background: ev.color || "var(--dl-accent)",
                                  flexShrink: 0,
                                }} title={ev.title} />
                              ))}
                            </div>
                          )
                        ) : (
                          bigEvents.map((ev, j) => (
                            <div key={j} style={{
                              fontFamily: mono, fontSize: '9px', lineHeight: 1.2,
                              color: ev.color || "var(--dl-accent)",
                              background: (ev.color || "var(--dl-accent)") + '28',
                              borderRadius: 3, padding: '2px 3px',
                              overflow: 'hidden', whiteSpace: 'nowrap',
                              textOverflow: 'ellipsis', flexShrink: 0,
                            }}>{ev.title}</div>
                          ))
                        )}

                        {/* AI summary — desktop only, too small to read on mobile */}
                        {vw >= 600 && summary && (
                          <div style={{
                            fontFamily: mono, fontSize: '7.5px', color: "var(--dl-middle)",
                            lineHeight: 1.25, overflow: 'hidden',
                            display: '-webkit-box', WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical', flex: 1, minHeight: 0,
                          }}>{summary}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Calendar card ──────────────────────────────────────────────────────────

// Mobile date picker — horizontal day strip with physics momentum
// Month and year are static labels (snap discretely). Only the day ribbon moves.
function MobileCalPicker({selected, onSelect, events, healthDots={}, desktop=false, onEventClick, onAddClick, collapsed, onToggle, calView, onCalViewChange}) {
  const today = todayKey();
  const DAY_W = 175;

  // Single source of truth: fractional day offset from epoch
  const liveOff    = useRef(dayOffset(selected));
  const vel        = useRef(0);          // px/frame rolling average
  const lastX      = useRef(null);
  const lastT      = useRef(null);
  const totalDrag  = useRef(0);          // total px dragged this gesture
  const rafId      = useRef(null);
  const [, bump]   = useState(0);
  const repaint    = () => bump(n => n + 1);

  function cancelRaf() {
    if (rafId.current) { cancelAnimationFrame(rafId.current); rafId.current = null; }
  }

  // Animate liveOff toward a target with spring ease-out
  function animateTo(target) {
    cancelRaf();
    vel.current = 0;
    const startVal = liveOff.current;
    const startTime = performance.now();
    const DURATION = 280;
    const tick = (now) => {
      const t = Math.min((now - startTime) / DURATION, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      liveOff.current = startVal + (target - startVal) * ease;
      repaint();
      if (t < 1) {
        rafId.current = requestAnimationFrame(tick);
      } else {
        liveOff.current = target;
        repaint();
        onSelect(toKey(offsetToDate(target)));
      }
    };
    rafId.current = requestAnimationFrame(tick);
  }

  function snap() { animateTo(Math.round(liveOff.current)); }

  function runMomentum() {
    cancelRaf();
    const FRICTION = 0.86;
    const tick = () => {
      vel.current *= FRICTION;
      liveOff.current -= vel.current / DAY_W;
      repaint();
      if (Math.abs(vel.current) > 1.5) {
        rafId.current = requestAnimationFrame(tick);
      } else {
        animateTo(Math.round(liveOff.current));
      }
    };
    rafId.current = requestAnimationFrame(tick);
  }

  const onTouchStart = e => {
    cancelRaf();
    vel.current = 0;
    totalDrag.current = 0;
    lastX.current = e.touches[0].clientX;
    lastT.current = performance.now();
  };

  const onTouchMove = e => {
    e.preventDefault();
    const x  = e.touches[0].clientX;
    const t  = performance.now();
    const dt = Math.max(t - lastT.current, 4);
    const dx = x - lastX.current;
    totalDrag.current += Math.abs(dx);
    const newVel = (dx / dt) * 16;
    vel.current = vel.current * 0.5 + newVel * 0.5;
    liveOff.current -= dx / DAY_W;
    lastX.current = x;
    lastT.current = t;
    repaint();
  };

  const onTouchEnd = () => {
    if (totalDrag.current > 8 && Math.abs(vel.current) > 1.5) {
      runMomentum();
    } else {
      snap();
    }
  };

  // Sync when parent forces a date (e.g. "today" button)
  useEffect(() => {
    const n = dayOffset(selected);
    if (Math.round(liveOff.current) !== n) {
      cancelRaf();
      liveOff.current = n;
      vel.current = 0;
      repaint();
    }
  }, [selected]); // eslint-disable-line
  useEffect(() => () => cancelRaf(), []); // eslint-disable-line

  // Derived from liveOff
  const off      = liveOff.current;
  const selInt   = Math.round(off);
  const fracSlot = off - selInt;
  const selDate  = offsetToDate(selInt);
  const selMonth = MONTHS_FULL[selDate.getMonth()];
  const selYear  = selDate.getFullYear();

  // Build day items: enough to fill screen
  const N = 6;
  const dayItems = [];
  for (let i = -N; i <= N; i++) {
    dayItems.push({ d: offsetToDate(selInt + i), i });
  }

  const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  function timeToMins(t) {
    if (!t || t === "all day") return -1;
    const m = t.match(/(\d+):(\d+)\s*(AM|PM)?/i);
    if (!m) return 9999;
    let h = parseInt(m[1]), min = parseInt(m[2]);
    const period = (m[3]||"").toUpperCase();
    if (period === "PM" && h !== 12) h += 12;
    if (period === "AM" && h === 12) h = 0;
    return h * 60 + min;
  }

  const tapDay = (targetOffset) => {
    if (totalDrag.current > 8) return;
    animateTo(targetOffset);
  };

  const MAX_EVENTS = 5;

  return (
    <div style={{userSelect:"none", display:"flex", flexDirection:"column"}}>

      {/* ── Header bar — collapses/expands calendar ─────────────────────── */}
      <div style={{
        display:"flex", alignItems:"center",
        padding:"10px 16px 8px",
        borderBottom:"1px solid var(--dl-border)",
        flexShrink:0, position:'relative',
        cursor: onToggle ? 'pointer' : 'default',
      }} onClick={onToggle}>
        {/* CALENDAR label — left */}
        <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
          {onToggle&&<ChevronBtn collapsed={collapsed} onToggle={e=>{e.stopPropagation();onToggle();}}/>}
          <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:'0.06em',textTransform:'uppercase',color:"var(--dl-highlight)"}}>Calendar</span>
        </div>


        {/* RIGHT: M/D toggle — hidden when collapsed */}
        <div style={{marginLeft:'auto',flexShrink:0,display:'flex',gap:4,alignItems:'center'}} onClick={e=>e.stopPropagation()}>
          {!collapsed && onCalViewChange&&<>
            <button onClick={()=>onCalViewChange('month')}
              style={{fontFamily:mono,fontSize:'10px',letterSpacing:'0.06em',
                padding:'3px 8px',borderRadius:4,cursor:'pointer',
                minHeight:22,minWidth:22,
                background:'none',border:"1px solid var(--dl-border2)",color:"var(--dl-highlight)"}}>M</button>
            <button onClick={()=>onCalViewChange('day')}
              style={{fontFamily:mono,fontSize:'10px',letterSpacing:'0.06em',
                padding:'3px 8px',borderRadius:4,cursor:'pointer',
                minHeight:22,minWidth:22,
                background:"var(--dl-accent-13)",border:"1px solid var(--dl-accent)",color:"var(--dl-accent)"}}>D</button>
          </>}
        </div>
      </div>

      {/* ── Day columns with events ──────────────────────────────────────── */}
      {!collapsed&&<div style={{
        overflow:"hidden", position:"relative",
        touchAction:"none", cursor:"grab",
        padding:"8px 0 12px",
        height: 292,
        flexShrink: 0,
      }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onMouseDown={e => { onTouchStart({touches:[{clientX:e.clientX}]}); }}
        onMouseMove={e => { if(e.buttons!==1)return; onTouchMove({preventDefault:()=>{},touches:[{clientX:e.clientX}]}); }}
        onMouseUp={() => { onTouchEnd(); }}
        onMouseLeave={e => { if(e.buttons===1) onTouchEnd(); }}
      >
        {/* Left / right vignette overlays — in front of scrollable area */}
        <div style={{position:"absolute",top:0,bottom:0,left:0,width:120,pointerEvents:"none",zIndex:2,
          background:"linear-gradient(to right, var(--dl-card) 0%, transparent 100%)"}}/>
        <div style={{position:"absolute",top:0,bottom:0,right:0,width:120,pointerEvents:"none",zIndex:2,
          background:"linear-gradient(to left, var(--dl-card) 0%, transparent 100%)"}}/>
        {/* Scrolling row */}
        <div style={{
          display:"flex", alignItems:"flex-start",
          marginLeft:`calc(50% - ${(N + 0.5) * DAY_W}px)`,
          transform:`translateX(${-fracSlot * DAY_W}px)`,
          willChange:"transform",
        }}>
          {dayItems.map(({d, i}) => {
            const k      = toKey(d);
            const isCtr  = i === 0;
            const isTdy  = k === today;
            const dayEvents = (events[k] || []).slice().sort((a,b) => timeToMins(a.time) - timeToMins(b.time));
            const dist = Math.abs(i);
            const opacity = isCtr ? 1 : Math.max(0.12, 1 - Math.pow(dist / 6, 2) * 0.88);

            return (
              <div key={k}
                onClick={() => tapDay(selInt + i)}
                style={{
                  width:DAY_W, flexShrink:0,
                  padding:"4px 3px",
                  cursor: isCtr ? "default" : "pointer",
                  opacity,
                  transition: "none",
                  borderLeft: isCtr ? `1px solid var(--dl-accent-13)` : "1px solid transparent",
                  borderRight: isCtr ? `1px solid var(--dl-accent-13)` : "1px solid transparent",
                  background: isCtr ? "var(--dl-accent-03)" : "transparent",
                  borderRadius: 6,
                  height: 272,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                }}>
                {/* Date header */}
                <div style={{textAlign:"center", marginBottom:6, paddingTop:2, flexShrink:0}}>
                  <div style={{
                    fontFamily:mono, fontSize:F.sm, letterSpacing:"0.06em",
                    fontWeight: (isCtr && isTdy) ? "700" : "normal",
                    color: (isCtr && isTdy) ? "var(--dl-strong)"
                         : isTdy           ? "var(--dl-orange)"
                         : isCtr           ? "var(--dl-strong)"
                                           : "var(--dl-middle)",
                    marginBottom:3,
                    textTransform:"uppercase",
                  }}>{DAY_NAMES[d.getDay()]} {d.getDate()}</div>
                  {/* Health score dots — full+bright >= 85, small+dim below, tiny grey no data */}
                  {k<=today && <div style={{display:"flex",gap:4,justifyContent:"center",alignItems:"center",marginTop:4,height:10}}>
                    <div style={{width:healthDots[k]?.sleep>=85?9:5,height:healthDots[k]?.sleep>=85?9:5,borderRadius:"50%",background:healthDots[k]?.sleep>0?"var(--dl-blue)":"var(--dl-middle)",opacity:healthDots[k]?.sleep>=85?1:healthDots[k]?.sleep>0?0.35:0.2}}/>
                    <div style={{width:healthDots[k]?.readiness>=85?9:5,height:healthDots[k]?.readiness>=85?9:5,borderRadius:"50%",background:healthDots[k]?.readiness>0?"var(--dl-green)":"var(--dl-middle)",opacity:healthDots[k]?.readiness>=85?1:healthDots[k]?.readiness>0?0.35:0.2}}/>
                    <div style={{width:healthDots[k]?.activity>=85?9:5,height:healthDots[k]?.activity>=85?9:5,borderRadius:"50%",background:healthDots[k]?.activity>0?"var(--dl-accent)":"var(--dl-middle)",opacity:healthDots[k]?.activity>=85?1:healthDots[k]?.activity>0?0.35:0.2}}/>
                    <div style={{width:healthDots[k]?.recovery>=85?9:5,height:healthDots[k]?.recovery>=85?9:5,borderRadius:"50%",background:healthDots[k]?.recovery>0?"var(--dl-purple)":"var(--dl-middle)",opacity:healthDots[k]?.recovery>=85?1:healthDots[k]?.recovery>0?0.35:0.2}}/>
                  </div>}
                </div>

                {/* Event cards — scrollable, fixed + button below */}
                <div style={{display:"flex",flexDirection:"column",flex:1,minHeight:0}}>
                <div style={{display:"flex",flexDirection:"column",gap:2,
                  overflowY:isCtr?"auto":"hidden",flex:1,minHeight:0,
                  scrollbarWidth:"none",msOverflowStyle:"none"}}>
                  {dayEvents.map((ev,j) => (
                    <div key={j}
                      onClick={isCtr && onEventClick ? (e)=>{e.stopPropagation();onEventClick(ev);} : undefined}
                      style={{
                        padding:"2px 5px", borderRadius:4, flexShrink:0,
                        background:`${ev.color||"var(--dl-accent)"}22`,
                        cursor: isCtr && onEventClick ? 'pointer' : 'default',
                        transition:'background 0.1s',
                        opacity: isCtr ? 1 : 0.85,
                      }}
                      onMouseEnter={isCtr&&onEventClick?e=>{e.currentTarget.style.background=`${ev.color||"var(--dl-accent)"}38`;}:undefined}
                      onMouseLeave={isCtr&&onEventClick?e=>{e.currentTarget.style.background=`${ev.color||"var(--dl-accent)"}22`;}:undefined}
                    >
                      <div style={{fontFamily:mono, fontSize:F.sm, color:`${ev.color||"var(--dl-accent)"}`, lineHeight:1.3, opacity: isCtr ? 0.7 : 0.85}}>
                        {ev.time !== "all day" ? ev.time : ""}
                      </div>
                      <div style={{fontFamily:mono, fontSize:F.sm, color:`${ev.color||"var(--dl-accent)"}`,
                        lineHeight:1.3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", opacity: isCtr ? 1 : 0.85}}>
                        {ev.title}
                      </div>
                    </div>
                  ))}

                </div>
                {/* + add button — fixed below scroll, only on selected day */}
                {isCtr && onAddClick && (
                  <button
                    onClick={e=>{e.stopPropagation();onAddClick();}}
                    style={{
                      flexShrink:0,marginTop:4,
                      background:'none',
                      border:"1px solid var(--dl-border2)",
                      borderRadius:5,cursor:'pointer',
                      color:"var(--dl-highlight)",fontFamily:mono,fontSize:F.sm,
                      letterSpacing:'0.04em',textTransform:'uppercase',
                      padding:'5px 0',width:'100%',textAlign:'center',
                      transition:'all 0.15s',
                    }}
                    onMouseEnter={e=>{e.currentTarget.style.color="var(--dl-strong)";e.currentTarget.style.borderColor="var(--dl-strong)";}}
                    onMouseLeave={e=>{e.currentTarget.style.color="var(--dl-highlight)";e.currentTarget.style.borderColor="var(--dl-border2)";}}
                  >+ add</button>
                )}
                </div>
              </div>
            );
          })}
        </div>
      </div>}


    </div>
  );
}
export default function CalendarCard({selected, onSelect, events, setEvents, healthDots, token, collapsed, onToggle, calView, onCalViewChange}) {
  const mobile = useIsMobile();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [active,   setActive]  = useState(null);
  const [form,     setForm]    = useState({title:'',startTime:'',endTime:'',allDay:false});
  const [saving,   setSaving]  = useState(false);
  const [deleting, setDeleting]= useState(false);
  const [saveErr,  setSaveErr] = useState('');
  const [dirty,    setDirty]   = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);

  const isNew = active !== null && !active.id;
  const color = active?.color || "var(--dl-accent)";

  const to12h = t => {
    if (!t || t === 'all day') return 'all day';
    try {
      const [h, m] = t.split(':').map(Number);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
    } catch { return t; }
  };

  const toHHMM = t => {
    if (!t || t === 'all day') return '';
    try {
      // Handle "HH:MM" already
      if (/^\d{1,2}:\d{2}$/.test(t.trim())) {
        const [h,m] = t.trim().split(':').map(Number);
        return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
      }
      // Handle "H:MM AM/PM"
      const pm = /pm/i.test(t), am = /am/i.test(t);
      const match = t.match(/(\d{1,2}):(\d{2})/);
      if (match) {
        let h = parseInt(match[1]), m = parseInt(match[2]);
        if (pm && h < 12) h += 12;
        if (am && h === 12) h = 0;
        return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
      }
      return '';
    } catch { return ''; }
  };

  function openAdd() {
    setActive({});
    setForm({title:'', startTime:'09:00', endTime:'10:00', allDay:false});
    setSaveErr(''); setDirty(false); setEditingTitle(true);
  }

  function openEvent(ev) {
    if (active?.id === ev.id) { closePanel(); return; }
    setActive(ev);
    setForm({
      title: ev.title || '',
      startTime: ev.allDay ? '' : toHHMM(ev.time),
      endTime:   ev.allDay ? '' : toHHMM(ev.endTime),
      allDay:    ev.allDay || ev.time === 'all day',
    });
    setSaveErr(''); setDirty(false); setEditingTitle(false);
  }

  function closePanel() { setActive(null); setSaveErr(''); setDirty(false); }
  function updateForm(patch) {
    setForm(f => {
      const next = {...f, ...patch};
      // When start time changes, adjust end time
      if (patch.startTime && !patch.endTime) {
        const [sh, sm] = patch.startTime.split(':').map(Number);
        const [eh, em] = f.endTime.split(':').map(Number);
        const startMins = sh * 60 + sm;
        const endMins   = eh * 60 + em;
        if (endMins <= startMins) {
          // End is before or equal to start — default to 1 hour later (Google Calendar behavior)
          const newEnd = startMins + 60;
          const nh = Math.floor(newEnd / 60) % 24;
          const nm = newEnd % 60;
          next.endTime = `${String(nh).padStart(2,'0')}:${String(nm).padStart(2,'0')}`;
        }
      }
      // When end time is manually set before start, bump end to 1h after start (like Google)
      if (patch.endTime && !patch.startTime) {
        const [sh, sm] = f.startTime.split(':').map(Number);
        const [eh, em] = patch.endTime.split(':').map(Number);
        if (!isNaN(sh) && (eh * 60 + em) <= (sh * 60 + sm)) {
          const newEnd = sh * 60 + sm + 60;
          const nh = Math.floor(newEnd / 60) % 24;
          const nm = newEnd % 60;
          next.endTime = `${String(nh).padStart(2,'0')}:${String(nm).padStart(2,'0')}`;
        }
      }
      return next;
    });
    setDirty(true);
  }

  async function save() {
    if (!form.title.trim() || saving) return;
    setSaving(true); setSaveErr('');
    try {
      if (isNew) {
        const data = await api.post('/api/calendar', {title:form.title.trim(),date:selected,
          startTime:form.allDay?'':form.startTime,endTime:form.allDay?'':form.endTime,
          allDay:form.allDay,tz}, token);
        if (!data||data.error){ setSaveErr(data?.error||'Failed'); setSaving(false); return; }
        setEvents(prev=>({...prev,[selected]:[...(prev[selected]||[]),
          {id:data.eventId,title:form.title.trim(),
           time:form.allDay?'all day':to12h(form.startTime),
           endTime:form.allDay?null:to12h(form.endTime),allDay:form.allDay,color:'#B8A882'}]}));
        closePanel();
      } else {
        const data = await api.patch('/api/calendar', {eventId:active.id,title:form.title.trim(),date:selected,
          startTime:form.allDay?'':form.startTime,endTime:form.allDay?'':form.endTime,
          allDay:form.allDay,tz}, token);
        if (!data||data.error){ setSaveErr(data?.error||'Failed'); setSaving(false); return; }
        const updated = {...active,title:form.title.trim(),
          time:form.allDay?'all day':to12h(form.startTime),
          endTime:form.allDay?null:to12h(form.endTime),allDay:form.allDay};
        setEvents(prev=>({...prev,[selected]:(prev[selected]||[]).map(e=>e.id===active.id?updated:e)}));
        setActive(updated); setDirty(false);
      }
    } catch(err){ setSaveErr(err.message); }
    setSaving(false);
  }

  async function deleteEvent() {
    if (!active?.id||deleting) return;
    setDeleting(true);
    const snapshot = {...active};
    const dateSnap = selected;
    try {
      const data = await api.delete('/api/calendar', token, {eventId:active.id});
      if (data !== null) {
        setEvents(prev=>({...prev,[selected]:(prev[selected]||[]).filter(e=>e.id!==active.id)}));
        closePanel();
        pushHistory({
          label: `Delete "${snapshot.title}"`,
          undo: async () => {
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const d = await api.post('/api/calendar', {title:snapshot.title, date:dateSnap,
              startTime: snapshot.allDay?'':toHHMM(snapshot.time),
              endTime: snapshot.allDay?'':toHHMM(snapshot.endTime),
              allDay:snapshot.allDay||snapshot.time==='all day', tz}, token);
            if (d?.eventId) {
              const restored = {...snapshot, id:d.eventId};
              setEvents(prev=>({...prev,[dateSnap]:[...(prev[dateSnap]||[]).filter(e=>e.id!==snapshot.id&&e.id!==d.eventId), restored]}));
            }
          },
          redo: async () => {
            await api.delete('/api/calendar', token, {eventId:snapshot.id});
            setEvents(prev=>({...prev,[dateSnap]:(prev[dateSnap]||[]).filter(e=>e.id!==snapshot.id)}));
          },
        });
      }
    } catch{} finally{ setDeleting(false); }
  }

  const prevSelected = useRef(selected);
  useEffect(()=>{
    if(prevSelected.current!==selected){ prevSelected.current=selected; closePanel(); }
  },[selected]); // eslint-disable-line

  const inputBase = {
    background:'transparent', border:'none', outline:'none',
    padding:0, margin:0, color:"var(--dl-strong)",
  };

  // Derive selected date info for header pill
  const selDateObj = selected ? new Date(selected + 'T12:00:00') : new Date();
  const isSelToday = selected === todayKey();
  const pillColor = isSelToday ? "var(--dl-strong)" : "var(--dl-accent)";
  const SEL_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const selPillLabel = `${SEL_MONTHS[selDateObj.getMonth()]} ${selDateObj.getDate()}, ${selDateObj.getFullYear()}`;

  return (
    <Card>
      {calView === 'month' ? (
        <div style={{userSelect:'none',display:'flex',flexDirection:'column'}}>
          {/* Month header — same layout as day view */}
          <div style={{display:'flex',alignItems:'center',padding:'10px 16px 8px',
            borderBottom:"1px solid var(--dl-border)",flexShrink:0,position:'relative',
            cursor:onToggle?'pointer':'default'}} onClick={onToggle}>
            <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
              {onToggle&&<ChevronBtn collapsed={collapsed} onToggle={e=>{e.stopPropagation();onToggle();}}/>}
              <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:'0.06em',textTransform:'uppercase',color:"var(--dl-highlight)"}}>Calendar</span>
            </div>
            {collapsed ? (
              /* Collapsed: day nav arrows only */
              <div style={{position:'absolute',left:'50%',transform:'translateX(-50%)',
                display:'flex',alignItems:'center',gap:10,userSelect:'none',whiteSpace:'nowrap'}}>
                <button onClick={e=>{e.stopPropagation();const n=new Date(selDateObj);n.setDate(n.getDate()-1);onSelect(toKey(n));}}
                  style={{background:'none',border:'none',cursor:'pointer',color:"var(--dl-highlight)",padding:'2px 6px',
                    fontFamily:mono,fontSize:F.md,lineHeight:1,transition:'color 0.15s'}}
                  onMouseEnter={e=>e.currentTarget.style.color="var(--dl-strong)"}
                  onMouseLeave={e=>e.currentTarget.style.color="var(--dl-highlight)"}>‹</button>
                <button onClick={e=>{e.stopPropagation();const n=new Date(selDateObj);n.setDate(n.getDate()+1);onSelect(toKey(n));}}
                  style={{background:'none',border:'none',cursor:'pointer',color:"var(--dl-highlight)",padding:'2px 6px',
                    fontFamily:mono,fontSize:F.md,lineHeight:1,transition:'color 0.15s'}}
                  onMouseEnter={e=>e.currentTarget.style.color="var(--dl-strong)"}
                  onMouseLeave={e=>e.currentTarget.style.color="var(--dl-highlight)"}>›</button>
              </div>
            ) : null}
            {/* M/D toggle — right, hidden when collapsed */}
            <div style={{marginLeft:'auto',display:'flex',gap:4}} onClick={e=>e.stopPropagation()}>
              {!collapsed && <>
              <button onClick={()=>onCalViewChange('month')}
                style={{fontFamily:mono,fontSize:'10px',letterSpacing:'0.06em',
                  padding:'3px 8px',borderRadius:4,cursor:'pointer',
                  minHeight:22,minWidth:22,
                  background:"var(--dl-accent-13)",border:"1px solid var(--dl-accent)",color:"var(--dl-accent)"}}>M</button>
              <button onClick={()=>onCalViewChange('day')}
                style={{fontFamily:mono,fontSize:'10px',letterSpacing:'0.06em',
                  padding:'3px 8px',borderRadius:4,cursor:'pointer',
                  minHeight:22,minWidth:22,
                  background:'none',border:"1px solid var(--dl-border2)",color:"var(--dl-highlight)"}}>D</button>
              </>}
            </div>
          </div>
          {!collapsed&&<MonthView
            initYear={selDateObj.getFullYear()} initMonth={selDateObj.getMonth()}
            selected={selected}
            onSelectDay={d=>onSelect(d)}
            onMonthChange={()=>{}}
            healthDots={healthDots}
            events={events}
            token={token}
          />}
        </div>
      ) : (
        <MobileCalPicker
          selected={selected} onSelect={onSelect}
          events={events} healthDots={healthDots} desktop={!mobile}
          onEventClick={openEvent} onAddClick={openAdd}
          collapsed={collapsed} onToggle={onToggle}
          calView={calView} onCalViewChange={onCalViewChange}
        />
      )}

      {/* ── Event panel ── */}
      {active !== null && (
        <div style={{borderTop:"1px solid var(--dl-border)",padding:'12px 16px'}}>

          {/* Main row: color bar | info | delete | × */}
          <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>

            {/* Color bar */}
            <div style={{width:3,borderRadius:2,background:color,
              flexShrink:0,alignSelf:'stretch',minHeight:34,marginTop:2}}/>

            {/* Info: title + time row */}
            <div style={{flex:1,minWidth:0}}>
              {/* Title */}
              {editingTitle ? (
                <input
                  autoFocus
                  value={form.title}
                  onChange={e=>updateForm({title:e.target.value})}
                  onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();save();setEditingTitle(false);}if(e.key==='Escape')closePanel();}}
                  onBlur={()=>setEditingTitle(false)}
                  placeholder='Event title'
                  style={{...inputBase,fontFamily:serif,fontSize:F.md,width:'100%',
                    display:'block',marginBottom:5}}
                />
              ) : (
                <div
                  onClick={()=>setEditingTitle(true)}
                  style={{fontFamily:serif,fontSize:F.md,color:form.title?"var(--dl-strong)":"var(--dl-highlight)",
                    marginBottom:5,cursor:'text',minHeight:'1.4em'}}
                >
                  {form.title || 'Event title'}
                </div>
              )}

              {/* Time row: times + All Day inline */}
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                {/* Time inputs — hidden when allDay */}
                <div style={{
                  display:'flex',alignItems:'center',gap:5,
                  maxWidth:form.allDay?0:240,
                  overflow:'hidden',
                  opacity:form.allDay?0:1,
                  transition:'max-width 0.25s ease, opacity 0.2s ease',
                }}>
                  <input type='time' value={form.startTime}
                    onChange={e=>updateForm({startTime:e.target.value})}
                    style={{...inputBase,fontFamily:mono,fontSize:F.sm,color:"var(--dl-highlight)",
                      width:96,cursor:'text'}}
                  />
                  <span style={{fontFamily:mono,fontSize:F.sm,color:"var(--dl-highlight)",opacity:0.4}}>–</span>
                  <input type='time' value={form.endTime}
                    onChange={e=>updateForm({endTime:e.target.value})}
                    style={{...inputBase,fontFamily:mono,fontSize:F.sm,color:"var(--dl-highlight)",
                      width:96,cursor:'text'}}
                  />
                </div>

                {/* All Day toggle */}
                <button onClick={()=>updateForm({allDay:!form.allDay})} style={{
                  background:'none',border:'none',cursor:'pointer',padding:0,
                  fontFamily:mono,fontSize:F.sm,letterSpacing:'0.04em',textTransform:'uppercase',
                  color:form.allDay?"var(--dl-accent)":"var(--dl-highlight)",
                  transition:'color 0.2s',
                }}
                onMouseEnter={e=>{if(!form.allDay)e.currentTarget.style.color="var(--dl-strong)";}}
                onMouseLeave={e=>{if(!form.allDay)e.currentTarget.style.color="var(--dl-highlight)";}}>
                  all day
                </button>

                {saving && <span style={{fontFamily:mono,fontSize:F.sm,color:"var(--dl-highlight)",opacity:0.5}}>saving…</span>}
              </div>



              {active.zoomUrl && (
                <a href={active.zoomUrl} target='_blank' rel='noopener noreferrer'
                  style={{display:'inline-block',marginTop:6,fontFamily:mono,fontSize:F.sm,
                    letterSpacing:'0.1em',textTransform:'uppercase',color:"var(--dl-blue)",textDecoration:'none'}}>
                  Join ↗
                </a>
              )}
            </div>

            {/* Right side: trash | cancel | save — horizontal row */}
            <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0,alignSelf:'center'}}>
              {/* Trash — existing events only */}
              {!isNew && active.id && (
                <button onClick={deleteEvent} disabled={deleting} title="Delete" style={{
                  background:'none',border:'none',cursor:deleting?'default':'pointer',
                  color:"var(--dl-red)",padding:6,lineHeight:0,display:'flex',alignItems:'center',justifyContent:'center',
                  opacity:deleting?0.3:0.6,transition:'color 0.15s, opacity 0.15s',
                }}
                onMouseEnter={e=>{if(!deleting){e.currentTarget.style.opacity='1';e.currentTarget.style.color="var(--dl-red)";}}}
                onMouseLeave={e=>{e.currentTarget.style.opacity='0.6';e.currentTarget.style.color="var(--dl-red)";}}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                </button>
              )}
              {/* Cancel × */}
              <button onClick={closePanel} title="Cancel" style={{
                background:'none',border:'none',cursor:'pointer',
                color:"var(--dl-highlight)",padding:6,lineHeight:0,display:'flex',alignItems:'center',justifyContent:'center',
                opacity:0.6,transition:'color 0.15s, opacity 0.15s',
              }}
              onMouseEnter={e=>{e.currentTarget.style.opacity='1';e.currentTarget.style.color="var(--dl-strong)";}}
              onMouseLeave={e=>{e.currentTarget.style.opacity='0.6';e.currentTarget.style.color="var(--dl-highlight)";}}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
              {/* Save ✓ */}
              <button onClick={async()=>{if(form.title.trim()){await save();closePanel();}}} disabled={saving||!form.title.trim()} title="Save" style={{
                background:'none',border:'none',cursor:(saving||!form.title.trim())?'default':'pointer',
                color:"var(--dl-highlight)",padding:6,lineHeight:0,display:'flex',alignItems:'center',justifyContent:'center',
                opacity:(saving||!form.title.trim())?0.3:0.6,transition:'color 0.15s, opacity 0.15s',
              }}
              onMouseEnter={e=>{if(!saving&&form.title.trim()){e.currentTarget.style.opacity='1';e.currentTarget.style.color="var(--dl-green)";}}}
              onMouseLeave={e=>{e.currentTarget.style.opacity=(saving||!form.title.trim())?'0.3':'0.6';e.currentTarget.style.color="var(--dl-highlight)";}}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </button>
            </div>

          </div>

          {saveErr && <div style={{fontFamily:mono,fontSize:F.sm,color:'#A05050',marginTop:8}}>{saveErr}</div>}
        </div>
      )}
    </Card>
  );
}
// ─── Skeleton shimmer ─────────────────────────────────────────────────────────
