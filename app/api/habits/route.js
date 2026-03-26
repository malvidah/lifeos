import { withAuth } from '../_lib/auth.js';
import { keyToRecurrence, matchesSchedule } from '@/lib/recurrence.js';

// GET /api/habits?start=YYYY-MM-DD&end=YYYY-MM-DD
// Returns habit definitions + completion status for a date range.
// Habits are tasks with data-habit="schedule" in their HTML.

export const GET = withAuth(async (req, { supabase, user }) => {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get('start');
  const end = searchParams.get('end');

  if (!start || !end) return Response.json({ error: 'start and end required' }, { status: 400 });

  // Fetch habit templates — only unchecked tasks with data-habit attribute.
  // Completion rows have the data-habit span stripped, so they won't match.
  // But also filter out done tasks to be safe (a template should never be done).
  const { data: templates, error: tErr } = await supabase
    .from('tasks')
    .select('id, date, text, html, done, project_tags, position')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .eq('done', false)
    .ilike('html', '%data-habit=%');

  if (tErr) throw tErr;

  // Parse schedule from each template
  const habits = (templates ?? []).map(t => {
    const match = t.html?.match(/data-habit="([^"]+)"/);
    const schedule = match ? match[1] : null;
    if (!schedule) return null;

    // Clean text for display — strip all habit/recurrence tokens and rendered chip text
    const cleanText = (t.text || '')
      .replace(/\{h:[^}]+\}/g, '')
      .replace(/\{r:[^}]+\}/g, '')
      .replace(/\/[hr]\s+\S+/gi, '')
      .replace(/🎯\s*[A-Za-z·\s]+/g, '')  // rendered habit chip: 🎯 T·R, 🎯 Daily, etc.
      .replace(/↻\s*[A-Za-z·\s]+/g, '')   // rendered recurrence chip: ↻ M·W·F, etc.
      .trim();

    return {
      id: t.id,
      date: t.date,
      text: cleanText || t.text,
      schedule,
      project_tags: t.project_tags || [],
    };
  }).filter(Boolean);

  if (!habits.length) return Response.json({ habits: [] });

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
  for (const habit of habits) {
    const recurrence = keyToRecurrence(habit.schedule, habit.date);
    const completionMap = {};
    const habitTextLower = habit.text.trim().toLowerCase();

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
      const cText = (c.text || '')
        .replace(/\{[^}]+\}/g, '')
        .replace(/\/[hr]\s+\S+/gi, '')
        .replace(/@\d{4}-\d{2}-\d{2}/g, '')
        .replace(/🎯\s*[A-Za-z·\s]+/g, '')
        .replace(/↻\s*[A-Za-z·\s]+/g, '')
        .trim().toLowerCase();
      if (cText === habitTextLower && c.done && completionMap.hasOwnProperty(c.date)) {
        completionMap[c.date] = true;
      }
    }

    // Calculate streak with freeze mechanic (only consider dates up to today):
    // - Walk forward through past/today scheduled dates
    // - Track running streak and best streak
    // - When you surpass your previous best, earn a streak freeze
    // - If you miss while holding a freeze: consume it, streak stays (frozen)
    // - If you miss without a freeze: streak resets to 0
    const todayStr = new Date().toISOString().slice(0, 10);
    const pastDates = scheduledDates.filter(d => d <= todayStr);

    let streak = 0;
    let bestStreak = 0;
    let freezes = 0;
    let frozen = false;
    let runningStreak = 0;
    let prevBest = 0; // track when we last earned a freeze

    for (let i = 0; i < pastDates.length; i++) {
      if (completionMap[pastDates[i]]) {
        runningStreak++;
        frozen = false;
        if (runningStreak > bestStreak) {
          bestStreak = runningStreak;
        }
        // Earn a freeze when passing a previously established best
        if (prevBest > 0 && runningStreak > prevBest && runningStreak === prevBest + 1) {
          freezes++;
        }
      } else {
        // Miss — use freeze or reset
        if (freezes > 0) {
          freezes--;
          frozen = true;
          // streak doesn't reset
        } else {
          // Record best before resetting
          if (runningStreak > 0) prevBest = Math.max(prevBest, bestStreak);
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

  return Response.json({ habits });
});
