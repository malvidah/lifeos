import { withAuth } from '../../_lib/auth.js';

// GET /api/tasks/debug?date=YYYY-MM-DD
// Shows ALL tasks for a date including soft-deleted ones, for debugging.

export const GET = withAuth(async (req, { supabase, user }) => {
  const date = new URL(req.url).searchParams.get('date');
  if (!date) return Response.json({ error: 'date required' }, { status: 400 });

  // All tasks on this date (including deleted)
  const { data: own } = await supabase
    .from('tasks')
    .select('id, date, text, html, done, due_date, deleted_at, project_tags, position')
    .eq('user_id', user.id)
    .eq('date', date)
    .order('deleted_at', { ascending: true, nullsFirst: true })
    .order('position', { ascending: true });

  // Persistent tasks that SHOULD show on this date
  const { data: persistent } = await supabase
    .from('tasks')
    .select('id, date, text, done, due_date, deleted_at, project_tags')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .not('due_date', 'is', null)
    .lte('date', date)
    .eq('done', false)
    .neq('date', date)
    .not('html', 'ilike', '%data-recurrence=%');

  // Also search for any big think tasks anywhere
  const { data: bigThink } = await supabase
    .from('tasks')
    .select('id, date, text, done, due_date, deleted_at, project_tags')
    .eq('user_id', user.id)
    .contains('project_tags', ['big think']);

  return Response.json({
    ownTasks: own ?? [],
    persistentForDate: persistent ?? [],
    bigThinkAll: bigThink ?? [],
  });
});
