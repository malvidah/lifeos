import { withAuth } from '../_lib/auth.js';
import { isValidDate } from '@/lib/validate.js';
import { keyToRecurrence, matchesSchedule } from '@/lib/recurrence.js';
import { cleanTaskText, displayTaskText } from '@/lib/cleanTaskText.js';

// GET /api/habits?start=YYYY-MM-DD&end=YYYY-MM-DD
// Returns habit definitions + completion status for a date range.
// Habits are tasks with data-habit="schedule" in their HTML.
// Completions are stored in the habit_completions join table.

export const GET = withAuth(async (req, { supabase, user }) => {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get('start');
  const end = searchParams.get('end');
  const today = searchParams.get('today');

  if (!start || !end) return Response.json({ error: 'start and end required' }, { status: 400 });
  if (!isValidDate(start) || !isValidDate(end)) return Response.json({ error: 'invalid date format' }, { status: 400 });
  if (today && !isValidDate(today)) return Response.json({ error: 'invalid today date' }, { status: 400 });
  // Guard: cap range to ~2 years to prevent memory exhaustion
  const rangeDays = (new Date(end) - new Date(start)) / 86400000;
  if (rangeDays < 0 || rangeDays > 800) return Response.json({ error: 'date range too large (max ~2 years)' }, { status: 400 });

  // Fetch habit templates — tasks with data-habit attribute in HTML.
  const { data: allHabitRows, error: tErr } = await supabase
    .from('tasks')
    .select('id, date, text, html, done, project_tags, position')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .ilike('html', '%data-habit=%');

  if (tErr) throw tErr;

  // Filter out any legacy completion rows that were not backfilled
  const templates = (allHabitRows ?? []).filter(t =>
    !t.html?.includes('data-completion="true"')
  );

  // Parse schedule and optional count from each template
  const habits = templates.map(t => {
    const match = t.html?.match(/data-habit="([^"]+)"/);
    const schedule = match ? match[1] : null;
    if (!schedule) return null;

    // Parse optional count limit from data-habit-count attribute
    const countMatch = t.html?.match(/data-habit-count="(\d+)"/);
    const countLimit = countMatch ? parseInt(countMatch[1], 10) : null;

    // Parse optional days limit from data-habit-days attribute
    const daysMatch = t.html?.match(/data-habit-days="(\d+)"/);
    const daysLimit = daysMatch ? parseInt(daysMatch[1], 10) : null;

    const display = displayTaskText(t.text);
    const matchKey = cleanTaskText(t.text);

    return {
      id: t.id,
      date: t.date,
      text: display || t.text,
      matchKey,
      schedule,
      countLimit,
      daysLimit,
      project_tags: t.project_tags || [],
    };
  }).filter(Boolean);

  // Deduplicate habits by cleaned text — keep the earliest (original template)
  const seen = new Map();
  for (const h of habits) {
    const key = h.matchKey;
    if (!seen.has(key) || h.date < seen.get(key).date) {
      seen.set(key, h);
    }
  }
  const dedupedHabits = [...seen.values()].sort((a, b) =>
    a.date.localeCompare(b.date) || a.text.localeCompare(b.text)
  );

  if (!dedupedHabits.length) return Response.json({ habits: [] });

  // Fetch completions from habit_completions join table
  const templateIds = dedupedHabits.map(h => h.id);
  const { data: completions, error: cErr } = await supabase
    .from('habit_completions')
    .select('habit_id, date')
    .eq('user_id', user.id)
    .in('habit_id', templateIds)
    .gte('date', start)
    .lte('date', end);

  if (cErr) throw cErr;

  // Build completion lookup: habit_id -> Set of dates
  const completionsByHabit = new Map();
  for (const c of (completions ?? [])) {
    if (!completionsByHabit.has(c.habit_id)) completionsByHabit.set(c.habit_id, new Set());
    completionsByHabit.get(c.habit_id).add(c.date);
  }

  // Helper: ISO week key (Mon-based) for a date string
  function isoWeekKey(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const day = d.getDay(); // 0=Sun
    const mon = new Date(d); mon.setDate(d.getDate() - ((day + 6) % 7));
    return `${mon.getFullYear()}-${String(mon.getMonth()+1).padStart(2,'0')}-${String(mon.getDate()).padStart(2,'0')}`;
  }

  // Build completion map + streaks per habit
  for (const habit of dedupedHabits) {
    const recurrence = keyToRecurrence(habit.schedule, habit.date);
    const completionMap = {};
    const habitCompletions = completionsByHabit.get(habit.id) || new Set();

    // Find scheduled dates in range
    const startDate = new Date(start + 'T12:00:00');
    const endDate = new Date(end + 'T12:00:00');
    const scheduledDates = [];

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if (recurrence && matchesSchedule(dateStr, recurrence)) {
        scheduledDates.push(dateStr);
        completionMap[dateStr] = habitCompletions.has(dateStr);
      }
    }

    const todayStr = today || new Date().toISOString().slice(0, 10);
    let streak = 0, bestStreak = 0, frozen = false, freezes = 0, runningStreak = 0;

    // ── xperweek: streak is counted in WEEKS, not days ───────────────────────
    if (recurrence?.rule === 'xperweek') {
      const target = recurrence.target ?? 1;
      // Group completions by ISO week
      const weekCounts = {};
      for (const dateStr of habitCompletions) {
        const wk = isoWeekKey(dateStr);
        weekCounts[wk] = (weekCounts[wk] ?? 0) + 1;
      }
      // Collect all weeks in the range (Mon-based)
      const weeksInRange = new Set();
      for (const dateStr of scheduledDates) weeksInRange.add(isoWeekKey(dateStr));
      const todayWeek = isoWeekKey(todayStr);
      const pastWeeks = [...weeksInRange].filter(w => w < todayWeek).sort();

      let consecutiveForFreeze = 0;
      for (const wk of pastWeeks) {
        const done = (weekCounts[wk] ?? 0) >= target;
        if (done) {
          runningStreak++; consecutiveForFreeze++;
          frozen = false;
          if (runningStreak > bestStreak) bestStreak = runningStreak;
          if (consecutiveForFreeze >= 4) { consecutiveForFreeze = 0; if (freezes < 2) freezes++; }
        } else {
          consecutiveForFreeze = 0;
          if (freezes > 0) { freezes--; frozen = true; }
          else { runningStreak = 0; frozen = false; }
        }
      }
      // Current week: count it if target already met (don't penalise if still in progress)
      if ((weekCounts[todayWeek] ?? 0) >= target) {
        runningStreak++;
        if (runningStreak > bestStreak) bestStreak = runningStreak;
      }
      streak = runningStreak;
    } else {
      // ── Standard per-day streak (existing logic) ────────────────────────────
      const pastDates = scheduledDates.filter(d => d < todayStr);
      const todayScheduled = scheduledDates.includes(todayStr);
      let consecutiveForFreeze = 0;

      for (let i = 0; i < pastDates.length; i++) {
        if (completionMap[pastDates[i]]) {
          runningStreak++; consecutiveForFreeze++;
          frozen = false;
          if (runningStreak > bestStreak) bestStreak = runningStreak;
          if (consecutiveForFreeze >= 7) { consecutiveForFreeze = 0; if (freezes < 2) freezes++; }
        } else {
          consecutiveForFreeze = 0;
          if (freezes > 0) { freezes--; frozen = true; }
          else { runningStreak = 0; frozen = false; }
        }
      }
      if (todayScheduled && completionMap[todayStr]) {
        runningStreak++;
        if (runningStreak > bestStreak) bestStreak = runningStreak;
      }
      streak = runningStreak;
    }

    habit.completions = completionMap;
    habit.streak = streak;
    habit.bestStreak = bestStreak;
    habit.frozen = frozen;
    habit.freezes = freezes;

    // Count-limited habits: total completions across ALL time (not just range)
    // We'll fill this in below after a separate query
    if (habit.countLimit) {
      habit.countDone = 0;
      habit.countComplete = false;
    }
  }

  // For count-limited habits, fetch total completions across ALL time
  const countLimitedHabits = dedupedHabits.filter(h => h.countLimit);
  if (countLimitedHabits.length > 0) {
    const countIds = countLimitedHabits.map(h => h.id);
    const { data: allTimeCompletions } = await supabase
      .from('habit_completions')
      .select('habit_id, date')
      .eq('user_id', user.id)
      .in('habit_id', countIds);

    const allTimeCounts = new Map();
    for (const c of (allTimeCompletions ?? [])) {
      allTimeCounts.set(c.habit_id, (allTimeCounts.get(c.habit_id) || 0) + 1);
    }
    for (const h of countLimitedHabits) {
      h.countDone = allTimeCounts.get(h.id) || 0;
      h.countComplete = h.countDone >= h.countLimit;
    }
  }

  // Days-limited habits: calculate expiry date (creation date + N days)
  for (const h of dedupedHabits) {
    if (h.daysLimit) {
      const created = new Date(h.date + 'T12:00:00');
      created.setDate(created.getDate() + h.daysLimit);
      h.expiryDate = `${created.getFullYear()}-${String(created.getMonth()+1).padStart(2,'0')}-${String(created.getDate()).padStart(2,'0')}`;
      const todayStr = today || new Date().toISOString().slice(0, 10);
      h.daysExpired = todayStr > h.expiryDate;
    }
    // Mark archived: count-complete OR days-expired
    h.archived = !!(h.countComplete || h.daysExpired);
  }

  return Response.json({ habits: dedupedHabits });
});
