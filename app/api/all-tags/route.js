import { withAuth } from '../_lib/auth.js';

// GET /api/all-tags
// Returns the deduplicated, sorted list of all project tags the user has ever used.
// Reads from the project_tags[] columns in typed tables + the projects table directly
// so MapCard and editor autocomplete work even when project_tags[] isn't yet populated.

const BUILTIN = new Set(['__everything__']);

export const GET = withAuth(async (req, { supabase, user }) => {
  // Fetch project_tags arrays from all typed tables + explicit projects table in parallel
  const [journalR, tasksR, mealsR, notesR, workoutsR, projectsR] = await Promise.all([
    supabase.from('journal_blocks').select('project_tags').eq('user_id', user.id),
    supabase.from('tasks').select('project_tags').eq('user_id', user.id),
    supabase.from('meal_items').select('project_tags').eq('user_id', user.id),
    supabase.from('notes').select('project_tags').eq('user_id', user.id),
    supabase.from('workouts').select('project_tags').eq('user_id', user.id),
    supabase.from('projects').select('name').eq('user_id', user.id),
  ]);

  const tags = new Set();

  for (const result of [journalR, tasksR, mealsR, notesR, workoutsR]) {
    for (const row of result.data ?? []) {
      for (const tag of row.project_tags ?? []) {
        const lower = tag.toLowerCase().trim();
        if (lower && !BUILTIN.has(lower)) tags.add(lower);
      }
    }
  }

  // Include all explicitly-created projects regardless of project_tags[] state
  for (const row of projectsR.data ?? []) {
    const lower = row.name?.toLowerCase().trim();
    if (lower && !BUILTIN.has(lower)) tags.add(lower);
  }

  return Response.json({ tags: [...tags].sort() });
});
