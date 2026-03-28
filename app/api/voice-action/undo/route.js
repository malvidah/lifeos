import { withAuth } from '../../_lib/auth.js';

// POST /api/voice-action/undo
// Reverses changes made by voice-action using the results array it returned.
// Each result can have: created (IDs to delete), edited (IDs + prev values to restore),
// deleted (prev records to re-insert).

const TABLE_MAP = {
  tasks: 'tasks',
  meals: 'meal_items',
  journal: 'journal_blocks',
  workouts: 'workouts',
  goals: 'goals',
};

export const POST = withAuth(async (req, { supabase, user }) => {
  const { results } = await req.json();
  if (!results?.length) return Response.json({ ok: true });

  for (const r of results) {
    const table = TABLE_MAP[r.type];
    if (!table) continue;

    // Undo creates: delete the rows that were inserted
    if (r.created?.length) {
      await supabase.from(table).delete()
        .in('id', r.created)
        .eq('user_id', user.id);
    }

    // Undo edits: restore previous values
    if (r.edited?.length) {
      for (const edit of r.edited) {
        if (!edit.id || !edit.prev) continue;
        await supabase.from(table).update(edit.prev)
          .eq('id', edit.id)
          .eq('user_id', user.id);
      }
    }

    // Undo deletes: re-insert the previous records
    if (r.deleted?.length) {
      for (const del of r.deleted) {
        if (!del.prev) continue;
        const row = { ...del.prev, user_id: user.id };
        // Remove id so Supabase generates a new one (the old row is gone)
        delete row.id;
        await supabase.from(table).insert(row);
      }
    }
  }

  return Response.json({ ok: true });
});
