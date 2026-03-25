import { withAuth } from '../../_lib/auth.js';

// POST /api/tasks/recover { date }
// Recovers soft-deleted tasks for a specific date by clearing deleted_at.
// Only recovers tasks deleted in the last 7 days.

export const POST = withAuth(async (req, { supabase, user }) => {
  const { date } = await req.json();
  if (!date) return Response.json({ error: 'date required' }, { status: 400 });

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('tasks')
    .update({ deleted_at: null })
    .eq('user_id', user.id)
    .eq('date', date)
    .not('deleted_at', 'is', null)
    .gte('deleted_at', sevenDaysAgo)
    .select('id');

  if (error) throw error;
  return Response.json({ ok: true, recovered: data?.length ?? 0 });
});
