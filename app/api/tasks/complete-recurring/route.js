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

  // Strip recurrence and habit chips from HTML and text for the completion copy
  const completionHtml = (template.html || '')
    .replace(/<span\b[^>]*\bdata-recurrence="[^"]*"[^>]*>[^<]*<\/span>/g, '')
    .replace(/<span\b[^>]*\bdata-habit="[^"]*"[^>]*>[^<]*<\/span>/g, '')
    .replace(/data-checked="false"/, 'data-checked="true"');

  // Clean text uses centralized function (returns lowercase)
  const completionTextLower = cleanTaskText(template.text);
  // For storage, preserve original casing — just strip tokens
  const completionText = (template.text || '')
    .replace(/\{[^}]+\}/g, '')
    .replace(/\/[hr]\s+\S+/gi, '')
    .replace(/🎯\s*[A-Za-z·\s]+/g, '')
    .replace(/↻\s*[A-Za-z·\s]+/g, '')
    .replace(/@\d{4}-\d{2}-\d{2}/g, '')
    .replace(/\s+/g, ' ')
    .trim();

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

  // If there's an unchecked row (e.g., the virtual appearance was materialized), mark it done
  const uncheckedRow = matchingRows.find(r => !r.done);
  if (uncheckedRow) {
    const { data: updated } = await supabase.from('tasks')
      .update({ done: true, completed_at: TODAY() })
      .eq('id', uncheckedRow.id)
      .select().single();
    return Response.json({ task: updated || uncheckedRow });
  }

  // Create completion row
  const { data: row, error: insertErr } = await supabase.from('tasks').insert({
    user_id: user.id,
    date,
    text: completionText || template.text,
    html: completionHtml,
    done: true,
    due_date: null,
    completed_at: TODAY(),
    project_tags: template.project_tags || [],
    note_tags: template.note_tags || [],
    position: 0,
  }).select().single();

  if (insertErr) throw insertErr;
  return Response.json({ task: row });
});
