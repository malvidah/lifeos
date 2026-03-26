import { withAuth } from '../../_lib/auth.js';

// POST /api/tasks/reorder { updates: [{ id, position }] }
// Batch-update task positions without touching content.

export const POST = withAuth(async (req, { supabase, user }) => {
  const { updates } = await req.json();
  if (!Array.isArray(updates) || !updates.length) {
    return Response.json({ error: 'updates array required' }, { status: 400 });
  }

  // Update each task's position
  const results = await Promise.all(
    updates.map(({ id, position }) =>
      supabase.from('tasks')
        .update({ position })
        .eq('id', id)
        .eq('user_id', user.id)
    )
  );

  const errors = results.filter(r => r.error);
  if (errors.length) throw errors[0].error;

  return Response.json({ ok: true, updated: updates.length });
});
