import { withAuth } from '../../_lib/auth.js';

// POST /api/tasks/cleanup
// Deduplicates ALL dates at once. Keeps newest row per unique text per date.

// Support both GET and POST so it can be triggered from browser URL bar
export const GET = withAuth(async (req, { supabase, user }) => {
  return cleanup(supabase, user);
});

export const POST = withAuth(async (req, { supabase, user }) => {
  return cleanup(supabase, user);
});

async function cleanup(supabase, user) {
  // Get all active tasks grouped by date
  const { data: all, error } = await supabase
    .from('tasks')
    .select('id, date, text')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .order('id', { ascending: false });

  if (error) throw error;
  if (!all?.length) return Response.json({ ok: true, removed: 0 });

  // Group by date, then keep newest per unique text
  const byDate = {};
  for (const t of all) {
    if (!byDate[t.date]) byDate[t.date] = [];
    byDate[t.date].push(t);
  }

  const toDelete = [];
  for (const [date, tasks] of Object.entries(byDate)) {
    const seen = new Set();
    for (const t of tasks) {
      const key = (t.text || '').trim().toLowerCase();
      if (seen.has(key)) {
        toDelete.push(t.id);
      } else {
        seen.add(key);
      }
    }
  }

  // Soft-delete duplicates in batches
  if (toDelete.length > 0) {
    const now = new Date().toISOString();
    for (let i = 0; i < toDelete.length; i += 100) {
      const batch = toDelete.slice(i, i + 100);
      await supabase
        .from('tasks')
        .update({ deleted_at: now })
        .in('id', batch)
        .eq('user_id', user.id);
    }
  }

  return Response.json({ ok: true, removed: toDelete.length, dates: Object.keys(byDate).length });
}
