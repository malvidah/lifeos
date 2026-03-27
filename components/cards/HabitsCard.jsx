"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { mono, F, projectColor } from "@/lib/tokens";
import { api } from "@/lib/api";
import { todayKey } from "@/lib/dates";
import { useProjectNames } from "@/lib/contexts";
import { Shimmer } from "../ui/primitives.jsx";
import { showToast } from "../ui/Toast.jsx";

// ── Streak helpers ───────────────────────────────────────────────────────────
// 🎯 target  = on a streak (count > 0, below best)
// 🔥 fire    = hot streak (count >= best, new territory or matched)
// ❄️ frozen  = missed once, freeze consumed, count preserved
// 🐴 horse   = reset (count = 0)
function streakEmoji(streak, frozen, bestStreak) {
  if (frozen) return '\u2744\uFE0F';
  if (streak === 0) return '\uD83D\uDC0E';
  if (bestStreak > 0 && streak >= bestStreak) return '\uD83D\uDD25';
  return '\uD83C\uDFAF';
}

function streakTooltip(streak, frozen, bestStreak) {
  if (frozen) return 'Freeze used \u2014 streak preserved';
  if (streak === 0) return 'Streak reset';
  if (bestStreak > 0 && streak >= bestStreak) return 'At your best!';
  return 'On a streak';
}

function streakColor(streak, frozen, bestStreak) {
  if (frozen) return '#7CB8D4';
  if (streak === 0) return 'var(--dl-middle)';
  if (bestStreak > 0 && streak >= bestStreak) return 'var(--dl-accent)';
  return 'var(--dl-green, #7A9E6E)';
}

function streakBg(streak, frozen, bestStreak) {
  if (frozen) return 'rgba(124,184,212,0.12)';
  if (streak === 0) return 'transparent';
  if (bestStreak > 0 && streak >= bestStreak) return 'var(--dl-accent-10, rgba(208,136,40,0.1))';
  return 'rgba(122,158,110,0.12)';
}

// Recalculate streak from completions map (client-side, for optimistic updates)
function recalcStreak(completions, todayStr) {
  // Get all scheduled dates up to today, sorted
  const pastDates = Object.keys(completions).filter(d => d <= todayStr).sort();
  let streak = 0, bestStreak = 0, freezes = 0, frozen = false;
  let running = 0, consecutiveForFreeze = 0;
  for (const d of pastDates) {
    if (completions[d]) {
      running++;
      consecutiveForFreeze++;
      frozen = false;
      if (running > bestStreak) bestStreak = running;
      if (consecutiveForFreeze >= 7) { consecutiveForFreeze = 0; if (freezes < 2) freezes++; }
    } else {
      consecutiveForFreeze = 0;
      if (freezes > 0) { freezes--; frozen = true; }
      else { running = 0; frozen = false; }
    }
  }
  streak = running;
  return { streak, bestStreak, frozen, freezes };
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

function yearLabel(dateStr) {
  return dateStr.slice(0, 4);
}

// ── Health achievement habits (read-only, synced from health scores) ─────────
const HEALTH_METRICS = [
  { key: 'sleep',     label: 'Sleep',     field: 'sleep_score' },
  { key: 'readiness', label: 'Readiness', field: 'readiness_score' },
  { key: 'activity',  label: 'Activity',  field: 'activity_score' },
  { key: 'recovery',  label: 'Recovery',  field: 'recovery_score' },
];
const HEALTH_THRESHOLD = 85;

function buildHealthHabits(scores, startDate, endDate, today) {
  // scores: [{ date, sleep_score, readiness_score, activity_score, recovery_score }]
  const scoreByDate = {};
  for (const s of scores) { if (s.date) scoreByDate[s.date] = s; }

  return HEALTH_METRICS.map(metric => {
    // Build completions map — every day is "scheduled", ≥85 = done
    const completions = {};
    let d = startDate;
    while (d <= endDate) {
      const score = scoreByDate[d]?.[metric.field];
      if (d <= today) {
        completions[d] = score != null && score >= HEALTH_THRESHOLD;
      } else {
        completions[d] = false; // future: scheduled but not done (shows dimmed)
      }
      d = addDays(d, 1);
    }

    // Same Duolingo-style streak logic as task habits
    let streak = 0, bestStreak = 0, freezes = 0, frozen = false;
    let running = 0, consecutiveForFreeze = 0;
    let checkDate = startDate;
    while (checkDate <= today) {
      if (completions[checkDate]) {
        running++;
        consecutiveForFreeze++;
        frozen = false;
        if (running > bestStreak) bestStreak = running;
        if (consecutiveForFreeze >= 7) {
          consecutiveForFreeze = 0;
          if (freezes < 2) freezes++;
        }
      } else {
        consecutiveForFreeze = 0;
        if (freezes > 0) { freezes--; frozen = true; }
        else { running = 0; frozen = false; }
      }
      checkDate = addDays(checkDate, 1);
    }
    streak = running;

    return {
      id: `__health__:${metric.key}`,
      text: metric.label,
      matchKey: metric.key,
      schedule: 'daily',
      completions,
      streak,
      bestStreak,
      frozen,
      freezes,
      project_tags: ['health'],
      _isHealth: true,
    };
  });
}

// ── HabitsCard ───────────────────────────────────────────────────────────────
// ── Habit filter toggle for card header ───────────────────────────────────────
const TasksIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="12" height="12" rx="2.5"/>
  </svg>
);
const SyncIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="8" cy="8" r="6"/>
  </svg>
);
const AllIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="12" height="12" rx="2.5"/>
    <circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none"/>
  </svg>
);

// ── Schedule options for habit creation ───────────────────────────────────────
const SCHEDULE_OPTIONS = [
  { key: 'daily', label: 'Daily', chip: 'Daily', search: 'daily everyday' },
  { key: 'weekdays', label: 'Weekdays (M·T·W·R·F)', chip: 'M·T·W·R·F', search: 'weekdays weekday mtwrf' },
  { key: 'mwf', label: 'M·W·F', chip: 'M·W·F', search: 'mwf monday wednesday friday' },
  { key: 'tr', label: 'T·R', chip: 'T·R', search: 'tr tuesday thursday' },
  { key: 'weekends', label: 'Weekends (S·U)', chip: 'S·U', search: 'weekends weekend saturday sunday' },
  { key: 'mon', label: 'Monday', chip: 'M', search: 'monday mon' },
  { key: 'tue', label: 'Tuesday', chip: 'T', search: 'tuesday tue' },
  { key: 'wed', label: 'Wednesday', chip: 'W', search: 'wednesday wed' },
  { key: 'thu', label: 'Thursday', chip: 'R', search: 'thursday thu' },
  { key: 'fri', label: 'Friday', chip: 'F', search: 'friday fri' },
  { key: 'sat', label: 'Saturday', chip: 'S', search: 'saturday sat' },
  { key: 'sun', label: 'Sunday', chip: 'U', search: 'sunday sun' },
];

export function HabitFilterBtns({ filter, setFilter }) {
  const btns = [
    { key: 'tasks', icon: <TasksIcon />, ariaLabel: 'Show task habits' },
    { key: 'synced', icon: <SyncIcon />, ariaLabel: 'Show synced habits' },
    { key: 'all', icon: <AllIcon />, ariaLabel: 'Show all habits' },
  ];
  return (
    <div style={{ display: 'flex', gap: 2, background: 'var(--dl-border-15, rgba(128,120,100,0.1))', borderRadius: 100, padding: 2 }}>
      {btns.map(b => {
        const active = filter === b.key;
        return (
          <button key={b.key} onClick={e => { e.stopPropagation(); setFilter(b.key); }} aria-label={b.ariaLabel} aria-pressed={active} style={{
            fontFamily: mono, fontSize: '10px', padding: '3px 6px',
            borderRadius: 100, cursor: 'pointer', border: 'none',
            background: active ? 'var(--dl-glass-active, var(--dl-accent-13))' : 'transparent',
            color: active ? 'var(--dl-strong)' : 'var(--dl-middle)',
            display: 'flex', alignItems: 'center', gap: 3, transition: 'all 0.15s',
          }}>
            {b.icon}
          </button>
        );
      })}
    </div>
  );
}

// ── Add Habit button for card header ──────────────────────────────────────────
export function AddHabitBtn({ onClick }) {
  return (
    <button onClick={e => { e.stopPropagation(); onClick(); }} aria-label="Add habit" style={{
      fontFamily: mono, fontSize: 14, lineHeight: 1,
      width: 22, height: 22, borderRadius: 100,
      border: '1.5px solid var(--dl-border2)',
      background: 'transparent', color: 'var(--dl-middle)',
      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all 0.15s',
    }}>+</button>
  );
}

// ── Autocomplete dropdown field ───────────────────────────────────────────────
function AutocompleteField({ value, onChange, onSelect, options, placeholder, label, autoFocus }) {
  const [open, setOpen] = useState(false);
  const [hlIdx, setHlIdx] = useState(0);
  const ref = useRef(null);
  const listRef = useRef(null);

  const q = value.toLowerCase().trim();
  const filtered = q
    ? options.filter(o => o.label.toLowerCase().includes(q) || (o.search || '').includes(q))
    : options;

  useEffect(() => { setHlIdx(0); }, [value]);

  // Close on outside click
  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const pick = (opt) => {
    onSelect(opt);
    setOpen(false);
  };

  const onKeyDown = e => {
    if (!open || filtered.length === 0) {
      if (e.key === 'ArrowDown' && filtered.length > 0) { setOpen(true); e.preventDefault(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHlIdx(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHlIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && filtered[hlIdx]) { e.preventDefault(); pick(filtered[hlIdx]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[hlIdx];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [hlIdx]);

  return (
    <div ref={ref} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <span style={{ fontFamily: mono, fontSize: 9, color: 'var(--dl-middle)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 2 }}>{label}</span>
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        style={{
          fontFamily: mono, fontSize: 12, width: '100%', boxSizing: 'border-box',
          background: 'transparent', border: '1.5px solid var(--dl-border2)',
          borderRadius: 6, padding: '4px 8px', color: 'var(--dl-strong)',
          outline: 'none', letterSpacing: '0.02em',
        }}
      />
      {open && filtered.length > 0 && (
        <div ref={listRef} style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
          marginTop: 2, maxHeight: 160, overflowY: 'auto',
          background: 'var(--dl-card, var(--dl-bg))', border: '1px solid var(--dl-border)',
          borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}>
          {filtered.map((opt, i) => (
            <div
              key={opt.key}
              onMouseDown={e => { e.preventDefault(); pick(opt); }}
              onMouseEnter={() => setHlIdx(i)}
              style={{
                fontFamily: mono, fontSize: 11, padding: '5px 8px',
                cursor: 'pointer', letterSpacing: '0.02em',
                background: i === hlIdx ? 'var(--dl-accent-10, rgba(208,136,40,0.1))' : 'transparent',
                color: i === hlIdx ? 'var(--dl-strong)' : 'var(--dl-middle)',
              }}
            >{opt.label}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Inline habit creation form ────────────────────────────────────────────────
function HabitCreationForm({ token, onCreated, onCancel }) {
  const [name, setName] = useState('');
  const [projectText, setProjectText] = useState('');
  const [selectedProject, setSelectedProject] = useState(null);
  const [scheduleText, setScheduleText] = useState('');
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const projectNames = useProjectNames();

  const projectOptions = (projectNames || []).map(p => ({ key: p, label: p, search: p.toLowerCase() }));

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const canSubmit = name.trim() && selectedSchedule && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const parts = [name.trim()];
    if (selectedProject) parts.push(`{${selectedProject.key}}`);
    parts.push(`{h:${selectedSchedule.key}:${selectedSchedule.chip}}`);
    const text = parts.join(' ');
    const today = todayKey();
    try {
      await api.post('/api/tasks', { date: today, text, done: false }, token);
      window.dispatchEvent(new CustomEvent('daylab:habits-changed'));
      onCreated();
    } catch (err) {
      showToast('Failed to create habit', 'error');
      setSubmitting(false);
    }
  };

  return (
    <div style={{ padding: '8px 0 4px', borderTop: '1px solid var(--dl-border)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        {/* Habit name — plain text */}
        <div style={{ flex: 2, minWidth: 0 }}>
          <span style={{ fontFamily: mono, fontSize: 9, color: 'var(--dl-middle)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 2 }}>HABIT</span>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && canSubmit) submit(); }}
            placeholder="Habit name..."
            style={{
              fontFamily: mono, fontSize: 12, width: '100%', boxSizing: 'border-box',
              background: 'transparent', border: '1.5px solid var(--dl-border2)',
              borderRadius: 6, padding: '4px 8px', color: 'var(--dl-strong)',
              outline: 'none', letterSpacing: '0.02em',
            }}
          />
        </div>

        {/* Project — autocomplete */}
        <AutocompleteField
          value={projectText}
          onChange={v => { setProjectText(v); setSelectedProject(null); }}
          onSelect={opt => { setProjectText(opt.label); setSelectedProject(opt); }}
          options={projectOptions}
          placeholder="Optional..."
          label="PROJECT"
        />

        {/* Repeats — autocomplete */}
        <AutocompleteField
          value={scheduleText}
          onChange={v => { setScheduleText(v); setSelectedSchedule(null); }}
          onSelect={opt => { setScheduleText(opt.label); setSelectedSchedule(opt); }}
          options={SCHEDULE_OPTIONS}
          placeholder="Daily, M·W·F..."
          label="REPEATS"
        />

        {/* Submit */}
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <span style={{ fontFamily: mono, fontSize: 9, color: 'transparent', letterSpacing: '0.06em', display: 'block', marginBottom: 2 }}>&nbsp;</span>
          <button onClick={submit} disabled={!canSubmit} style={{
            fontFamily: mono, fontSize: 10, padding: '5px 12px',
            borderRadius: 6, border: 'none', cursor: canSubmit ? 'pointer' : 'default',
            background: 'var(--dl-accent)', color: 'var(--dl-bg)',
            opacity: canSubmit ? 1 : 0.4,
            fontWeight: 600, letterSpacing: '0.04em', transition: 'all 0.15s',
          }}>ADD</button>
        </div>
      </div>
    </div>
  );
}

export default function HabitsCard({ date, token, userId, project, habitFilter = 'all', onSelectDate, showCreateForm, onCreateDone }) {
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
  const startDate = addDays(today, -365);
  const endDate = addDays(today, 14);


  const dates = [];
  for (let d = startDate; d <= endDate; d = addDays(d, 1)) dates.push(d);

  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  // Re-fetch when tasks are saved — debounced to avoid overwriting optimistic state.
  // The 2s delay lets the optimistic update remain visible while the API settles.
  const refreshTimerRef = useRef(null);
  useEffect(() => {
    const handler = () => {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(refresh, 2000);
    };
    window.addEventListener('daylab:tasks-saved', handler);
    return () => {
      window.removeEventListener('daylab:tasks-saved', handler);
      clearTimeout(refreshTimerRef.current);
    };
  }, [refresh]);

  useEffect(() => {
    if (!token || !userId) return;
    let cancelled = false;
    // Only show loading shimmer on initial fetch — refreshes update silently
    if (!habits) setLoading(true);

    // Fetch task-based habits and health scores in parallel
    Promise.all([
      api.get(`/api/habits?start=${startDate}&end=${endDate}&today=${today}`, token),
      api.get(`/api/health/scores?start=${startDate}&end=${endDate}`, token).catch(() => null),
    ]).then(([habitsData, healthData]) => {
      if (cancelled) return;
      const taskHabits = habitsData?.habits ?? [];

      // Build health achievement habits from score data
      const healthHabits = buildHealthHabits(healthData?.rows ?? [], startDate, endDate, today);

      setHabits([...taskHabits, ...healthHabits]);
      setLoading(false);
    }).catch(() => { if (!cancelled) { setLoading(false); showToast('Failed to load habits', 'error'); } });

    return () => { cancelled = true; };
  }, [token, userId, startDate, endDate, refreshKey]);

  // Auto-scroll to center today (accounting for month dividers before today)
  useEffect(() => {
    if (!scrollRef.current || loading) return;
    const scrollTarget = date || today;
    const targetIdx = dates.indexOf(scrollTarget);
    if (targetIdx >= 0) {
      const colW = 28;
      const divW = 28;
      // Count month boundaries before target index
      let dividers = 0;
      for (let i = 1; i <= targetIdx; i++) {
        if (dayNum(dates[i]) === 1) dividers++;
      }
      const targetOffset = targetIdx * colW + dividers * divW;
      const containerW = scrollRef.current.clientWidth;
      scrollRef.current.scrollLeft = Math.max(0, targetOffset - containerW / 2);
    }
  }, [loading, date, today]);

  // Toggle a habit completion for a specific date
  const toggleCompletion = useCallback((habit, cellDate) => {
    if (!token) return;
    const wasDone = habit.completions?.[cellDate] === true;

    // Optimistic update — recalculate streak client-side (instant)
    setHabits(prev => prev?.map(h => {
      if (h.id !== habit.id) return h;
      const newCompletions = { ...h.completions, [cellDate]: !wasDone };
      const streakData = h._isHealth ? {} : recalcStreak(newCompletions, today);
      return { ...h, completions: newCompletions, ...streakData };
    }));

    // Fire-and-forget API call — don't block UI
    const apiCall = wasDone
      ? api.delete(`/api/tasks/complete-recurring?habit_id=${habit.id}&date=${cellDate}`, token)
      : api.post('/api/tasks/complete-recurring', { template_id: habit.id, date: cellDate }, token);

    apiCall.then(() => {
      window.dispatchEvent(new CustomEvent('daylab:habits-changed'));
    }).catch(err => {
      console.warn('[habits] toggle failed:', err);
      showToast('Failed to save habit', 'error');
      refresh(); // revert optimistic update on error
    });
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
        {showCreateForm ? (
          <HabitCreationForm token={token} onCreated={() => { onCreateDone?.(); refresh(); }} onCancel={() => onCreateDone?.()} />
        ) : (
          'No habits yet — use /h in tasks to tag one'
        )}
      </div>
    );
  }

  const colW = 28;
  const rowH = 24;
  const cellSize = 18;

  // Filter by project and habit type
  let filteredHabits = project
    ? habits.filter(h => h.project_tags?.some(t => t.toLowerCase() === project.toLowerCase()))
    : habits;

  if (habitFilter === 'tasks') filteredHabits = filteredHabits.filter(h => !h._isHealth);
  else if (habitFilter === 'synced') filteredHabits = filteredHabits.filter(h => h._isHealth);

  if (filteredHabits.length === 0) {
    return (
      <div style={{ fontFamily: mono, fontSize: F.sm, color: 'var(--dl-middle)', padding: '16px 0', textAlign: 'center', letterSpacing: '0.04em' }}>
        {project ? 'No habits in this project' : habitFilter === 'tasks' ? 'No task habits yet — use /h in tasks' : habitFilter === 'synced' ? 'No synced health data yet' : 'No habits yet'}
      </div>
    );
  }

  const visibleDates = dates;

  const monthBoundaries = new Set();
  for (let i = 1; i < visibleDates.length; i++) {
    if (dayNum(visibleDates[i]) === 1) monthBoundaries.add(i);
  }
  const dividerW = 28;

  // Habit name row component
  const HabitNameRow = ({ h }) => (
    <div style={{ height: rowH, display: 'flex', alignItems: 'center', gap: 0, paddingRight: 10 }}>
      <span style={{ fontFamily: mono, fontSize: 12, color: 'var(--dl-strong)', fontWeight: 500, lineHeight: 1, whiteSpace: 'nowrap', flex: 1, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {h.text}
      </span>
      <div style={{ width: 52, display: 'flex', justifyContent: 'center', gap: 2, alignItems: 'center' }}>
        <span title={streakTooltip(h.streak, h.frozen, h.bestStreak)} style={{
          display: 'inline-flex', alignItems: 'center', gap: 2,
          padding: '1px 5px', borderRadius: 100,
          border: `1.5px solid ${streakColor(h.streak, h.frozen, h.bestStreak)}`,
          background: streakBg(h.streak, h.frozen, h.bestStreak),
          fontFamily: mono, fontSize: 11, fontWeight: 600, lineHeight: 1,
          color: streakColor(h.streak, h.frozen, h.bestStreak), whiteSpace: 'nowrap',
        }}>
          <span role="img" aria-label={streakTooltip(h.streak, h.frozen, h.bestStreak)} style={{ fontSize: 10, lineHeight: 1 }}>{streakEmoji(h.streak, h.frozen, h.bestStreak)}</span>
          {h.streak}
        </span>
        {/* Freeze dots — small frost indicators showing banked freezes */}
        {h.freezes > 0 && (
          <span style={{ display: 'flex', gap: 1 }}>
            {Array.from({ length: h.freezes }, (_, i) => (
              <span key={i} style={{ width: 4, height: 4, borderRadius: 2, background: '#7CB8D4', flexShrink: 0 }} />
            ))}
          </span>
        )}
      </div>
      <span style={{ fontFamily: mono, fontSize: 11, color: 'var(--dl-middle)', lineHeight: 1, width: 36, textAlign: 'center' }}>
        {h.bestStreak || '\u2014'}
      </span>
    </div>
  );

  // Grid row for a single habit
  const HabitGridRow = ({ h, allVisibleHabits }) => {
    const tag = h.project_tags?.[0];
    const baseColor = tag ? projectColor(tag) : null;
    const fillColor = baseColor ? baseColor + '55' : 'var(--dl-accent-30, rgba(208,136,40,0.3))';
    return (
      <div style={{ display: 'flex', height: rowH }}>
        {visibleDates.map((d, i) => {
          const scheduled = h.completions?.hasOwnProperty(d);
          const done = h.completions?.[d] === true;
          const isPast = d <= today;
          const isBoundary = monthBoundaries.has(i);
          const divider = isBoundary ? (
            <MonthDivider key={`div-${d}`} label={monthLabel(d)} year={yearLabel(d)} height={rowH * allVisibleHabits.length} rowIndex={allVisibleHabits.indexOf(h)} rowH={rowH} />
          ) : null;
          const isSelected = d === date;
          const selectedBg = isSelected ? 'var(--dl-accent-10, rgba(208,136,40,0.1))' : 'transparent';
          const isLastHabit = allVisibleHabits.indexOf(h) === allVisibleHabits.length - 1;
          const selectedRadius = isLastHabit ? '0 0 6px 6px' : '0';
          if (!scheduled) {
            return <React.Fragment key={d}>{divider}<div style={{ width: colW, background: selectedBg, borderRadius: selectedRadius }} /></React.Fragment>;
          }
          return (
            <React.Fragment key={d}>
              {divider}
              <div style={{ width: colW, display: 'flex', alignItems: 'center', justifyContent: 'center', background: selectedBg, borderRadius: selectedRadius }}>
                <div
                  role={isPast && !h._isHealth ? 'button' : undefined}
                  tabIndex={isPast && !h._isHealth ? 0 : undefined}
                  aria-label={`${h.text} ${d} ${done ? 'completed' : 'not completed'}`}
                  onClick={e => {
                    if (dragState.current.moved) return;
                    if (isPast && !h._isHealth) toggleCompletion(h, d);
                  }}
                  onKeyDown={e => {
                    if ((e.key === 'Enter' || e.key === ' ') && isPast && !h._isHealth) {
                      e.preventDefault();
                      toggleCompletion(h, d);
                    }
                  }}
                  style={{
                    width: cellSize, height: cellSize,
                    borderRadius: h._isHealth ? '50%' : 4,
                    background: done ? fillColor : 'transparent',
                    border: `1.5px solid ${done ? (baseColor || 'var(--dl-accent)') : isPast ? (baseColor ? baseColor + '33' : 'var(--dl-border2)') : 'var(--dl-border)'}`,
                    opacity: !isPast && !done ? 0.35 : 1,
                    transition: 'all 0.15s',
                    cursor: isPast && !h._isHealth ? 'pointer' : 'default',
                  }}
                />
              </div>
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', userSelect: 'none', WebkitUserSelect: 'none' }}>
        {/* Left column: names + stats */}
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 0 }}>
          {/* Header row */}
          <div style={{ height: 30, display: 'flex', alignItems: 'flex-end', gap: 0, paddingRight: 10, paddingBottom: 2 }}>
            <span style={{ flex: 1 }} />
            <span title="Current streak" style={{ fontFamily: mono, fontSize: 9, color: 'var(--dl-middle)', letterSpacing: '0.06em', textTransform: 'uppercase', width: 52, textAlign: 'center', cursor: 'default' }}>count</span>
            <span title="Personal best streak" style={{ fontFamily: mono, fontSize: 9, color: 'var(--dl-middle)', letterSpacing: '0.06em', textTransform: 'uppercase', width: 36, textAlign: 'center', cursor: 'default' }}>best</span>
          </div>

          {filteredHabits.map(h => <HabitNameRow key={h.id} h={h} />)}
        </div>

        {/* Right: scrollable grid */}
        <div ref={scrollRef} onMouseDown={onMouseDown} style={{
          flex: 1, overflowX: 'auto', overflowY: 'hidden', cursor: 'grab',
          scrollbarWidth: 'none', msOverflowStyle: 'none',
          margin: '0 -14px 0 0',
          userSelect: 'none', WebkitUserSelect: 'none',
        }}>
          <div style={{ display: 'inline-flex', flexDirection: 'column', minWidth: visibleDates.length * colW + monthBoundaries.size * dividerW + 14, paddingRight: 14 }}>
            {/* Date header */}
            <div style={{ display: 'flex', height: 30, alignItems: 'flex-end' }}>
              {visibleDates.map((d, i) => {
                const isToday = d === today;
                const isBoundary = monthBoundaries.has(i);
                return (
                  <React.Fragment key={d}>
                    {isBoundary && <div style={{ width: dividerW }} />}
                    <div
                      onClick={e => { if (dragState.current.moved) return; onSelectDate?.(d); }}
                      style={{ width: colW, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 2, borderRadius: '6px 6px 0 0', background: d === date ? 'var(--dl-accent-10, rgba(208,136,40,0.1))' : 'transparent', cursor: 'pointer' }}>
                      <span style={{ fontFamily: mono, fontSize: 9, color: isToday ? 'var(--dl-accent)' : 'var(--dl-middle)', fontWeight: isToday ? 700 : 400, lineHeight: 1 }}>{dayLabel(d)}</span>
                      <span style={{ fontFamily: mono, fontSize: 9, color: isToday ? 'var(--dl-accent)' : d === date ? 'var(--dl-strong)' : 'var(--dl-middle)', fontWeight: isToday ? 700 : 400, lineHeight: 1 }}>{dayNum(d)}</span>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>

            {filteredHabits.map(h => <HabitGridRow key={h.id} h={h} allVisibleHabits={filteredHabits} />)}
          </div>
        </div>
      </div>
      {showCreateForm && (
        <HabitCreationForm token={token} onCreated={() => { onCreateDone?.(); refresh(); }} onCancel={() => onCreateDone?.()} />
      )}
    </div>
  );
}

// ── Month divider — vertical line with month + year label ─────────────────────
function MonthDivider({ label, year, height, rowIndex, rowH }) {
  if (rowIndex !== 0) {
    return <div style={{ width: 28, position: 'relative' }}>
      <div style={{ position: 'absolute', left: 13, top: 0, bottom: 0, width: 1, background: 'var(--dl-border)' }} />
    </div>;
  }

  return (
    <div style={{ width: 28, position: 'relative' }}>
      <div style={{
        position: 'absolute', left: 13, top: -30, width: 1,
        height: height + 30,
        background: 'var(--dl-border)',
      }} />
      <div style={{
        position: 'absolute', left: 0, top: -28, width: 28,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0,
      }}>
        <span style={{
          fontFamily: mono, fontSize: 8, fontWeight: 600,
          color: 'var(--dl-middle)', letterSpacing: '0.04em',
          textTransform: 'uppercase', whiteSpace: 'nowrap',
          background: 'var(--dl-card, var(--dl-bg))', padding: '0 1px',
          lineHeight: 1,
        }}>
          {label}
        </span>
        <span style={{
          fontFamily: mono, fontSize: 7,
          color: 'var(--dl-border2)', letterSpacing: '0.02em',
          whiteSpace: 'nowrap', lineHeight: 1,
          background: 'var(--dl-card, var(--dl-bg))', padding: '0 1px',
        }}>
          {year}
        </span>
      </div>
    </div>
  );
}
