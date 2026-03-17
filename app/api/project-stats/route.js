import { withAuth } from '../_lib/auth.js';
import { calculateStreak } from '@/lib/recurrence.js';

// GET /api/project-stats
// Returns entry counts, completed task counts, and habit stats per project tag.
// Used by the 3D terrain to size mountains by real effort.

export const GET = withAuth(async (req, { supabase, user }) => {
  const [journalR, tasksR, mealsR, workoutsR] = await Promise.all([
    supabase.from('journal_blocks').select('project_tags').eq('user_id', user.id),
    supabase.from('tasks').select('id, project_tags, done, is_template, recurrence, recurrence_parent_id, date').eq('user_id', user.id),
    supabase.from('meal_items').select('project_tags').eq('user_id', user.id),
    supabase.from('workouts').select('project_tags').eq('user_id', user.id),
  ]);

  const counts = {};       // total entries per project
  const completed = {};    // completed tasks per project

  function tally(rows, target) {
    for (const r of (rows || [])) {
      for (const tag of (r.project_tags || [])) {
        target[tag] = (target[tag] || 0) + 1;
      }
    }
  }

  tally(journalR.data, counts);
  tally(tasksR.data, counts);
  tally(mealsR.data, counts);
  tally(workoutsR.data, counts);

  // Completed tasks separately
  for (const t of (tasksR.data || [])) {
    if (!t.done) continue;
    for (const tag of (t.project_tags || [])) {
      completed[tag] = (completed[tag] || 0) + 1;
    }
  }

  // Habit stats: recurring tasks with flag counts + streaks per project
  // habits = { projectTag: [{ text, flagCount, topScore, streak }] }
  const habits = {};
  const allTasks = tasksR.data || [];
  const templates = allTasks.filter(t => t.is_template && t.recurrence);
  const instancesByParent = {};
  for (const t of allTasks) {
    if (t.recurrence_parent_id) {
      if (!instancesByParent[t.recurrence_parent_id]) instancesByParent[t.recurrence_parent_id] = [];
      instancesByParent[t.recurrence_parent_id].push(t);
    }
  }

  for (const tmpl of templates) {
    const instances = instancesByParent[tmpl.id] || [];
    const flagCount = instances.filter(i => i.done).length;
    if (flagCount < 10) continue; // only show habits with 10+ repeats

    // Sort instances by date descending for streak calculation
    instances.sort((a, b) => b.date?.localeCompare(a.date));
    let streak = 0;
    try { streak = calculateStreak(instances, tmpl.recurrence); } catch {}

    // Top score = total flag count (the max they've ever achieved)
    const stat = { text: tmpl.text, flagCount, topScore: flagCount, streak };

    for (const tag of (tmpl.project_tags || [])) {
      if (!habits[tag]) habits[tag] = [];
      habits[tag].push(stat);
    }
  }

  return Response.json({ counts, completed, habits });
});
