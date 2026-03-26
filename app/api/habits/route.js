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

  // Fetch all habit templates (tasks with data-habit attribute)
  const { data: templates, error: tErr } = await supabase
    .from('tasks')
    .select('id, date, text, html, done, project_tags, position')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .ilike('html', '%data-habit=%');

  if (tErr) throw tErr;

  // Parse schedule from each template
  const habits = (templates ?? []).map(t => {
    const match = t.html?.match(/data-habit="([^"]+)"/);
    const schedule = match ? match[1] : null;
    if (!schedule) return null;

    // Clean text for display
    const cleanText = (t.text || '')
      .replace(/\{h:[^}]+\}/g, '')
      .replace(/\{r:[^}]+\}/g, '')
      .replace(/\/[hr]\s+\S+/gi, '')
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
        .trim().toLowerCase();
      if (cText === habitTextLower && c.done && completionMap.hasOwnProperty(c.date)) {
        completionMap[c.date] = true;
      }
    }

    // Calculate streak with freeze mechanic:
    // - Consecutive completions from most recent backward = current streak
    // - Every time you pass your best streak, earn a freeze (1 miss forgiven)
    // - If frozen and miss, consume freeze (streak stays), tag → snowflake
    // - If miss again, streak resets to 0, tag → horse
    let streak = 0;
    let bestStreak = 0;
    let freezes = 0;
    let frozen = false;

    // Walk forward through scheduled dates to track best/freezes properly
    let runningStreak = 0;
    for (let i = 0; i < scheduledDates.length; i++) {
      if (completionMap[scheduledDates[i]]) {
        runningStreak++;
        frozen = false;
        if (runningStreak > bestStreak) {
          bestStreak = runningStreak;
          freezes++; // earned a freeze by beating high score
        }
      } else {
        // Miss
        if (freezes > 0 && !frozen) {
          freezes--;
          frozen = true;
          // streak doesn't reset — it's frozen
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

  return Response.json({ habits });
});
