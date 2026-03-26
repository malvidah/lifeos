import { withAuth } from '../../_lib/auth.js';

// POST /api/tasks/dedup { date }
// Deduplicates tasks for a date — keeps the newest row per unique text,
// soft-deletes the rest. Run after a bulk recovery.

export const POST = withAuth(async (req, { supabase, user }) => {
  const { date } = await req.json();
  if (!date) return Response.json({ error: 'date required' }, { status: 400 });

  // Get all active (non-deleted) tasks for this date
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('id, text')
    .eq('user_id', user.id)
    .eq('date', date)
    .is('deleted_at', null)
    .order('id', { ascending: false });

  if (error) throw error;
  if (!tasks?.length) return Response.json({ ok: true, kept: 0, removed: 0 });

  // Keep the newest row per unique text, soft-delete duplicates
  const seen = new Set();
  const toDelete = [];

  for (const t of tasks) {
    const key = (t.text || '').trim().toLowerCase();
    if (seen.has(key)) {
      toDelete.push(t.id);
    } else {
      seen.add(key);
    }
  }

  if (toDelete.length > 0) {
    const { error: delErr } = await supabase
      .from('tasks')
      .update({ deleted_at: new Date().toISOString() })
      .in('id', toDelete)
      .eq('user_id', user.id);
    if (delErr) throw delErr;
  }

  return Response.json({ ok: true, kept: tasks.length - toDelete.length, removed: toDelete.length });
});
