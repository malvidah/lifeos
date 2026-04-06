import { withAuth } from '../../_lib/auth.js';
import { isValidDate, isValidUuid } from '@/lib/validate.js';

// POST /api/tasks/complete-recurring { template_id, date }
// Marks a recurring/habit task as completed for a specific date.
// Inserts into habit_completions join table (idempotent via UNIQUE constraint).

// DELETE /api/tasks/complete-recurring?habit_id=X&date=Y
// Uncompletes a habit for a specific date.
// Removes the habit_completions row.

export const POST = withAuth(async (req, { supabase, user }) => {
  const { template_id, date } = await req.json();
  if (!template_id || !date) {
    return Response.json({ error: 'template_id and date required' }, { status: 400 });
  }
  if (!isValidUuid(template_id)) {
    return Response.json({ error: 'invalid template_id' }, { status: 400 });
  }
  if (!isValidDate(date)) {
    return Response.json({ error: 'invalid date' }, { status: 400 });
  }

  // Verify the template exists and belongs to this user.
  // Fetch html too so we can check completion-limit semantics below.
  const { data: template, error: fetchErr } = await supabase
    .from('tasks')
    .select('id, html')
    .eq('id', template_id)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .single();

  if (fetchErr || !template) {
    return Response.json({ error: 'template not found' }, { status: 404 });
  }

  // Insert completion — ON CONFLICT DO NOTHING for idempotency
  const { data: row, error: insertErr } = await supabase
    .from('habit_completions')
    .upsert(
      { user_id: user.id, habit_id: template_id, date },
      { onConflict: 'habit_id,date' },
    )
    .select()
    .single();

  if (insertErr) throw insertErr;

  // ── Repeated-task cleanup ────────────────────────────────────────────────
  // Repeated tasks (data-recurrence) default to count=1 — once the limit is
  // reached, soft-delete the template so future instances stop generating.
  // Habits (data-habit) are infinite: never soft-deleted on completion.
  const isRepeated = template.html?.includes('data-recurrence=');
  if (isRepeated) {
    const countMatch = template.html.match(/data-recurrence-count="(\d+)"/);
    if (countMatch) {
      const limit = parseInt(countMatch[1], 10);
      const { count: totalCompletions } = await supabase
        .from('habit_completions')
        .select('*', { count: 'exact', head: true })
        .eq('habit_id', template_id)
        .eq('user_id', user.id);
      if (totalCompletions >= limit) {
        await supabase
          .from('tasks')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', template_id)
          .eq('user_id', user.id);
      }
    }
  }

  return Response.json({ completion: row, task: row });
});

export const DELETE = withAuth(async (req, { supabase, user }) => {
  const { searchParams } = new URL(req.url);
  const habit_id = searchParams.get('habit_id');
  const date = searchParams.get('date');

  if (!habit_id || !date) {
    return Response.json({ error: 'habit_id and date required' }, { status: 400 });
  }
  if (!isValidUuid(habit_id)) {
    return Response.json({ error: 'invalid habit_id' }, { status: 400 });
  }
  if (!isValidDate(date)) {
    return Response.json({ error: 'invalid date' }, { status: 400 });
  }

  const { error } = await supabase
    .from('habit_completions')
    .delete()
    .eq('user_id', user.id)
    .eq('habit_id', habit_id)
    .eq('date', date);

  if (error) throw error;
  return Response.json({ ok: true });
});
