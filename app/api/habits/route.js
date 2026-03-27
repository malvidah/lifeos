import { withAuth } from '../_lib/auth.js';
import { keyToRecurrence, matchesSchedule } from '@/lib/recurrence.js';
import { cleanTaskText, displayTaskText } from '@/lib/cleanTaskText.js';

// GET /api/habits?start=YYYY-MM-DD&end=YYYY-MM-DD
// Returns habit definitions + completion status for a date range.
// Habits are tasks with data-habit="schedule" in their HTML.

export const GET = withAuth(async (req, { supabase, user }) => {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get('start');
  const end = searchParams.get('end');

  const today = searchParams.get('today');

  if (!start || !end) return Response.json({ error: 'start and end required' }, { status: 400 });

  // Fetch habit templates — tasks with data-habit attribute in HTML.
  // Completion rows now also keep data-habit for visual consistency, but are
  // marked with data-completion="true". Filter those out to get only templates.
  const { data: allHabitRows, error: tErr } = await supabase
    .from('tasks')
    .select('id, date, text, html, done, project_tags, position')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .ilike('html', '%data-habit=%');
  const templates = (allHabitRows ?? []).filter(t =>
    !t.html?.includes('data-completion="true"')
  );

  if (tErr) throw tErr;

  // Parse schedule from each template
  const habits = (templates ?? []).map(t => {
    const match = t.html?.match(/data-habit="([^"]+)"/);
    const schedule = match ? match[1] : null;
    if (!schedule) return null;

    // Clean text for display (preserve case) and for matching (lowercase)
    const display = displayTaskText(t.text);
    const matchKey = cleanTaskText(t.text);

    return {
      id: t.id,
      date: t.date,
      text: display || t.text,
      matchKey,
      schedule,
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
  // Stable sort: by template creation date (earliest first), then alphabetical
  const dedupedHabits = [...seen.values()].sort((a, b) =>
    a.date.localeCompare(b.date) || a.text.localeCompare(b.text)
  );

  if (!dedupedHabits.length) return Response.json({ habits: [] });

  // Fetch all completions in the date range
  const { data: completions, error: cErr } = await supabase
    .from('tasks')
    .select('id, date, text, done')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .eq('done', true)
    .gte('date', start)
    .lte('date', end);

  if (cErr) throw cErr;

  // Build completion map per habit
  for (const habit of dedupedHabits) {
    const recurrence = keyToRecurrence(habit.schedule, habit.date);
    const completionMap = {};
    const habitTextLower = habit.matchKey; // lowercased clean text for comparison

    // Find scheduled dates in range
    const startDate = new Date(start + 'T12:00:00');
    const endDate = new Date(end + 'T12:00:00');
    const scheduledDates = [];

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if (recurrence && matchesSchedule(dateStr, recurrence)) {
        scheduledDates.push(dateStr);
        completionMap[dateStr] = false;
      }
    }

    // Match completions by cleaned text
    for (const c of (completions ?? [])) {
      const cText = cleanTaskText(c.text);
      if (cText === habitTextLower && c.done && completionMap.hasOwnProperty(c.date)) {
        completionMap[c.date] = true;
      }
    }

    // Streak calculation with Duolingo-style freeze mechanic:
    //
    // States:
    //   🎯 target  = on a streak (count > 0, below personal best)
    //   🔥 fire    = hot streak (count >= personal best)
    //   ❄️ frozen  = missed once, freeze consumed, count preserved
    //   🐴 horse   = reset (missed with no freezes, count = 0)
    //
    // Freeze earning: every 7 consecutive days → earn 1 freeze (max 2 banked)
    // Freeze use: miss consumes 1 freeze, count stays, state → frozen
    // Second miss without freeze: count resets to 0

    // Use client-provided today to avoid UTC/local timezone mismatch
    const todayStr = today || new Date().toISOString().slice(0, 10);
    const pastDates = scheduledDates.filter(d => d <= todayStr);

    let streak = 0;
    let bestStreak = 0;
    let freezes = 0;
    let frozen = false;
    let runningStreak = 0;
    let consecutiveForFreeze = 0; // counts toward next freeze earn

    for (let i = 0; i < pastDates.length; i++) {
      if (completionMap[pastDates[i]]) {
        runningStreak++;
        consecutiveForFreeze++;
        frozen = false;
        if (runningStreak > bestStreak) bestStreak = runningStreak;
        // Earn a freeze every 7 consecutive days (max 2 banked)
        if (consecutiveForFreeze >= 7) {
          consecutiveForFreeze = 0;
          if (freezes < 2) freezes++;
        }
      } else {
        // Miss
        consecutiveForFreeze = 0;
        if (freezes > 0) {
          freezes--;
          frozen = true;
          // streak count preserved — don't reset runningStreak
        } else {
          runningStreak = 0;
          frozen = false;
        }
      }
    }
    streak = runningStreak;

    habit.completions = completionMap;
    habit.streak = streak;
    habit.bestStreak = bestStreak;
    habit.frozen = frozen;
    habit.freezes = freezes;
  }

  return Response.json({ habits: dedupedHabits });
});
