import { withAuth } from '../_lib/auth.js';

function isValidProject(name) {
  if (name === '__everything__') return true;
  return /^[a-z0-9][a-z0-9 ]{0,38}[a-z0-9]$|^[a-z0-9]$/.test(name);
}

// GET /api/project-entries?project=health[&terms=sleep,running]
// Returns journal blocks and tasks for a project from typed tables.
// `terms` is a comma-separated list of extra search strings (from LOOK FOR settings).
export const GET = withAuth(async (req, { supabase, user }) => {
  const params  = new URL(req.url).searchParams;
  const project = params.get('project');
  const terms   = (params.get('terms') || '').split(',').map(t => t.trim()).filter(Boolean);

  if (!project || !isValidProject(project))
    return Response.json({ error: 'invalid project name', got: project }, { status: 400 });

  const isEverything = project === '__everything__';

  // ── Journal blocks ─────────────────────────────────────────────────────────
  let journalQ = supabase.from('journal_blocks')
    .select('date, content, project_tags')
    .eq('user_id', user.id)
    .order('date', { ascending: true });

  if (!isEverything) {
    const filters = [`project_tags.cs.{${project}}`];
    terms.forEach(t => filters.push(`content.ilike.%${t}%`));
    journalQ = journalQ.or(filters.join(','));
  }

  const { data: journalRows, error: je } = await journalQ;
  if (je) throw je;

  const journalEntries = (journalRows || [])
    .filter(r => r.content?.trim())
    .map((r, i) => ({ date: r.date, text: r.content.trim(), lineIndex: i }));

  // ── Tasks ──────────────────────────────────────────────────────────────────
  let tasksQ = supabase.from('tasks')
    .select('id, date, text, html, done, project_tags')
    .eq('user_id', user.id)
    .order('date', { ascending: true });

  if (!isEverything) {
    const filters = [`project_tags.cs.{${project}}`];
    terms.forEach(t => filters.push(`text.ilike.%${t}%`));
    tasksQ = tasksQ.or(filters.join(','));
  }

  const { data: taskRows, error: te } = await tasksQ;
  if (te) throw te;

  const taskEntries = (taskRows || []).map(r => ({
    date: r.date, id: r.id, text: r.text, done: r.done,
  }));

  return Response.json({ journalEntries, taskEntries, isEverything });
});
