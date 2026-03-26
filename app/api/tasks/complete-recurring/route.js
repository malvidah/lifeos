import { withAuth } from '../../_lib/auth.js';

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

  // Strip recurrence chip from HTML and text for the completion copy
  const completionHtml = (template.html || '')
    .replace(/<span\b[^>]*\bdata-recurrence="[^"]*"[^>]*>[^<]*<\/span>/g, '')
    .replace(/data-checked="false"/, 'data-checked="true"');

  const completionText = (template.text || '')
    .replace(/\/r\s+\S+/gi, '')
    .trim();

  // Check if a completion row already exists for this date + text
  const { data: existing } = await supabase
    .from('tasks')
    .select('id')
    .eq('user_id', user.id)
    .eq('date', date)
    .ilike('text', completionText)
    .eq('done', true)
    .is('deleted_at', null)
    .limit(1);

  if (existing?.length) {
    // Already completed on this date — return the existing row
    return Response.json({ task: existing[0], already_completed: true });
  }

  // Create completion row
  const { data: row, error: insertErr } = await supabase.from('tasks').insert({
    user_id: user.id,
    date,
    text: completionText || template.text,
    html: completionHtml || template.html,
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
