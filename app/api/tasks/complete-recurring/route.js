import { withAuth } from '../../_lib/auth.js';
import { cleanTaskText } from '@/lib/cleanTaskText.js';

// POST /api/tasks/complete-recurring { template_id, date }
// Marks a recurring/habit task as completed for a specific date.
// - Same-date (template's own date): marks the template itself done
// - Other dates: creates a separate completion row with habit/recurrence chips stripped
// Completion rows have data-habit stripped so they don't appear as templates.

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

  // Strip data-habit and data-recurrence spans from the completion HTML so it
  // doesn't appear as a template in the habits API if done ever flips to false.
  // Keep project/note/date chips — those are useful metadata on the completion.
  const completionHtml = (template.html || '')
    .replace(/data-checked="false"/, 'data-checked="true"')
    .replace(/<span\b[^>]*\bdata-habit="[^"]*"[^>]*>[^<]*<\/span>/g, '')
    .replace(/<span\b[^>]*\bdata-recurrence="[^"]*"[^>]*>[^<]*<\/span>/g, '');
  const completionText = (template.text || '')
    .replace(/\{h:[^}]+\}/g, '')
    .replace(/\{r:[^}]+\}/g, '')
    .replace(/\/[hr]\s+\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // For matching existing completions
  const completionTextLower = cleanTaskText(template.text);

  // Check if a completion row already exists for this date.
  // Fetch all tasks for this date and compare using centralized cleaning.
  const { data: dateRows } = await supabase
    .from('tasks')
    .select('id, text, done, html')
    .eq('user_id', user.id)
    .eq('date', date)
    .is('deleted_at', null);

  const matchingRows = (dateRows ?? []).filter(r =>
    cleanTaskText(r.text) === completionTextLower
  );

  // If there's already a done completion, return it
  const doneRow = matchingRows.find(r => r.done);
  if (doneRow) {
    return Response.json({ task: doneRow, already_completed: true });
  }

  // If there's an unchecked row with matching text on this date, mark it done.
  // This handles: (a) same-date toggle on the template itself, (b) a user-created
  // task with matching text that should be treated as the completion.
  const uncheckedRow = matchingRows.find(r => !r.done);
  if (uncheckedRow) {
    const { data: updated } = await supabase.from('tasks')
      .update({ done: true, completed_at: TODAY() })
      .eq('id', uncheckedRow.id)
      .select().single();
    return Response.json({ task: updated || uncheckedRow });
  }

  // Use the position from the request (the position the task had in the editor)
  // if provided. Otherwise fall back to template position or max+1.
  let completionPosition = requestedPosition ?? template.position ?? 0;

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
