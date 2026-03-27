import { withAuth } from '../../_lib/auth.js';

// GET /api/goals/linked?name=goalname
//   → { tasks: [...], habits: [...] }
//   Returns tasks and habits linked to a goal via data-goal="name" in HTML.

export const GET = withAuth(async (req, { supabase, user }) => {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get('name');

  if (!name) {
    return Response.json({ error: 'name query param required' }, { status: 400 });
  }

  const goalName = name.toLowerCase();

  // Fetch all non-deleted tasks referencing this goal
  const { data: allLinked, error } = await supabase
    .from('tasks')
    .select('id, text, html, done, date, project_tags')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .ilike('html', `%data-goal="${goalName}"%`)
    .order('date', { ascending: false })
    .limit(100);

  if (error) throw error;

  const rows = allLinked || [];

  // Split into habits (have data-habit) and regular tasks
  const habits = rows.filter(r => r.html && r.html.includes('data-habit='));
  const tasks = rows.filter(r => !r.html || !r.html.includes('data-habit='));

  return Response.json({ tasks, habits });
});
