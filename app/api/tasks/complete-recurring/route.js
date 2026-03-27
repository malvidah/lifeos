import { withAuth } from '../../_lib/auth.js';
import { cleanTaskText } from '@/lib/cleanTaskText.js';

// POST /api/tasks/complete-recurring { template_id, date }
// Marks a recurring/habit task as completed for a specific date.
// Always creates a separate completion row marked with data-completion="true".
// Templates (rows with data-habit/data-recurrence) are NEVER marked done.
// Completion rows keep all chips for visual consistency; the habits API
// distinguishes them from templates via the data-completion marker.

const TODAY = () => new Date().toISOString().slice(0, 10);

export const POST = withAuth(async (req, { supabase, user }) => {
  const { template_id, date, position: requestedPosition } = await req.json();
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

  // Keep all chips (including habit/recurrence) in completion HTML for visual
  // consistency. Mark with data-completion="true" so the habits API can
  // distinguish completions from templates.
  const completionHtml = (template.html || '')
    .replace(/data-checked="false"/, 'data-checked="true"')
    .replace(/^<li\b/, '<li data-completion="true"');
  // Keep original text including tokens — matches template for suppression
  const completionText = template.text || '';

  // For matching existing completions
  const completionTextLower = cleanTaskText(template.text);

  // Check if a completion row already exists for this date.
  // Fetch all tasks for this date and compare using centralized cleaning.
  const { data: dateRows } = await supabase
    .from('tasks')
    .select('id, text, done, html, position')
    .eq('user_id', user.id)
    .eq('date', date)
    .is('deleted_at', null);

  // Helper: check if a row is a habit/recurrence template (not a completion row)
  const isCompletion = (r) => /data-completion="true"/.test(r.html || '');
  const isTemplate = (r) =>
    !isCompletion(r) && (
      r.id === template_id ||
      /data-habit=/.test(r.html || '') ||
      /data-recurrence=/.test(r.html || '')
    );

  const matchingRows = (dateRows ?? []).filter(r =>
    cleanTaskText(r.text) === completionTextLower
  );

  // If there's already a done completion (non-template), return it
  const doneRow = matchingRows.find(r => r.done && !isTemplate(r));
  if (doneRow) {
    return Response.json({ task: doneRow, already_completed: true });
  }

  // If there's an unchecked non-template row with matching text on this date, mark it done.
  // This handles a user-created task with matching text that should be treated as the completion.
  // Templates (rows with data-habit/data-recurrence) are NEVER marked done — they are the
  // recurring source and must remain undone for the habits API to find them.
  const uncheckedRow = matchingRows.find(r => !r.done && !isTemplate(r));
  if (uncheckedRow) {
    const { data: updated } = await supabase.from('tasks')
      .update({ done: true, completed_at: TODAY() })
      .eq('id', uncheckedRow.id)
      .select().single();
    return Response.json({ task: updated || uncheckedRow });
  }

  // Use the position from the request (the position the task had in the editor)
  // if provided. Otherwise place after the last task on this date so completion
  // rows don't collide with existing tasks and cause reordering.
  let completionPosition = requestedPosition;
  if (completionPosition == null) {
    const maxPos = (dateRows ?? []).reduce((max, r) => Math.max(max, r.position ?? 0), -1);
    completionPosition = maxPos + 1;
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
