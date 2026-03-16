import { withAuth } from '../_lib/auth.js';

// GET /api/project-stats
// Returns entry counts and completed task counts per project tag.
// Used by the 3D terrain to size mountains by real effort.

export const GET = withAuth(async (req, { supabase, user }) => {
  const [journalR, tasksR, mealsR, workoutsR] = await Promise.all([
    supabase.from('journal_blocks').select('project_tags').eq('user_id', user.id),
    supabase.from('tasks').select('project_tags, done').eq('user_id', user.id),
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

  return Response.json({ counts, completed });
});
