import { withAuth } from '../../_lib/auth.js';

// POST /api/tasks/recover { date?, text?, all? }
// Recovers soft-deleted tasks by clearing deleted_at.
// - date: recover all tasks for a specific date
// - text: recover tasks matching text (across all dates)
// - all: recover ALL recently deleted tasks (last 7 days)

export const POST = withAuth(async (req, { supabase, user }) => {
  const { date, text, all } = await req.json();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from('tasks')
    .update({ deleted_at: null })
    .eq('user_id', user.id)
    .not('deleted_at', 'is', null)
    .gte('deleted_at', sevenDaysAgo);

  if (date) query = query.eq('date', date);
  if (text) query = query.ilike('text', `%${text}%`);

  const { data, error } = await query.select('id, date, text, due_date');

  if (error) throw error;
  return Response.json({ ok: true, recovered: data?.length ?? 0, tasks: data ?? [] });
});
