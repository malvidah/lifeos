import { withAuth } from '../../_lib/auth.js';
import { cleanTaskText } from '@/lib/cleanTaskText.js';

// POST /api/tasks/complete-recurring { template_id, date }
// Creates a completion row for a recurring task on a specific date.
// The original template is NEVER modified — this creates a new row with
// the recurrence chip stripped, marked as done.

const TODAY = () => new Date().toISOString().slice(0, 10);

export const POST = withAuth(async (req, { supabase, user }) => {
  const { template_id, date } = await req.json();
  if (!template_id || !date) {
    return Response.json({ error: 'template_id and date required' }, { status: 400 });
  }

  // Fetch the template
  const { data: template, error: fetchErr } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', template_id)
    .eq('user_id', user.id)
    .single();

  if (fetchErr || !template) {
    return Response.json({ error: 'template not found' }, { status: 404 });
  }

  // Keep the original HTML and text with chips intact — the completion should
  // look identical to the template. Just mark it as checked.
  const completionHtml = (template.html || '')
    .replace(/data-checked="false"/, 'data-checked="true"');
  const completionText = template.text;

  // For matching existing completions
  const completionTextLower = cleanTaskText(template.text);

  // Check if a completion row already exists for this date.
  // Fetch all tasks for this date and compare using centralized cleaning.
  const { data: dateRows } = await supabase
    .from('tasks')
    .select('id, text, done')
    .eq('user_id', user.id)
    .eq('date', date)
    .is('deleted_at', null);

  const matchingRows = (dateRows ?? []).filter(r => cleanTaskText(r.text) === completionTextLower);

  // If there's already a done completion, return it
  const doneRow = matchingRows.find(r => r.done);
  if (doneRow) {
    return Response.json({ task: doneRow, already_completed: true });
  }

  // If there's an unchecked row with matching text, mark it done
  const uncheckedRow = matchingRows.find(r => !r.done);
  if (uncheckedRow) {
    const { data: updated } = await supabase.from('tasks')
      .update({ done: true, completed_at: TODAY() })
      .eq('id', uncheckedRow.id)
      .select().single();
    return Response.json({ task: updated || uncheckedRow });
  }

  // Set position: if template is from this same date, use its position.
  // Otherwise, put after all existing tasks (where recurring tasks appear).
  let completionPosition = template.position ?? 0;
  if (template.date !== date) {
    const { data: posRows } = await supabase.from('tasks')
      .select('position').eq('user_id', user.id).eq('date', date).is('deleted_at', null);
    completionPosition = (posRows ?? []).reduce((max, r) => Math.max(max, r.position ?? 0), -1) + 1;
  }

  // Create completion row
  const { data: row, error: insertErr } = await supabase.from('tasks').insert({
    user_id: user.id,
    date,
    text: completionText,
    html: completionHtml,
    done: true,
    due_date: null,
    completed_at: TODAY(),
    project_tags: template.project_tags || [],
    note_tags: template.note_tags || [],
    position: completionPosition,
  }).select().single();

  if (insertErr) throw insertErr;
  return Response.json({ task: row });
});
