import { withAuth } from '../_lib/auth.js';

// GET /api/project-entries?project=big+think[&terms=sleep,running]
//   Returns all content tagged to that project, split by type.
//   Special value: __everything__ (all content, no tag filter).
//   `terms` is a comma-separated list of extra search strings (from LOOK FOR settings).
//
// Response shape:
//   { journalBlocks, tasks, notes, isEverything }
//
// journalBlocks: [{ id, date, position, content, project_tags, note_tags }]
// tasks:         [{ id, date, text, html, done, due_date, completed_at, project_tags }]
// notes:         [{ id, title, content, project_tags, created_at, updated_at }]

function isValidProject(name) {
  if (name === '__everything__') return true;
  return /^[a-z0-9][a-z0-9 ]{0,38}[a-z0-9]$|^[a-z0-9]$/.test(name);
}

export const GET = withAuth(async (req, { supabase, user }) => {
  const params  = new URL(req.url).searchParams;
  const project = params.get('project');
  const terms   = (params.get('terms') || '').split(',').map(t => t.trim()).filter(Boolean);

  if (!project || !isValidProject(project))
    return Response.json({ error: 'invalid project name', got: project }, { status: 400 });

  const isEverything = project === '__everything__';

  // Helper: apply project + terms filter to a query
  const applyFilter = (q, contentCol = 'content') => {
    if (isEverything) return q;
    if (terms.length === 0) return q.contains('project_tags', [project]);
    const filters = [`project_tags.cs.{${project}}`];
    terms.forEach(t => filters.push(`${contentCol}.ilike.%${t}%`));
    return q.or(filters.join(','));
  };

  const [blocksR, tasksR, notesR] = await Promise.all([
    applyFilter(
      supabase.from('journal_blocks')
        .select('id, date, position, content, project_tags, note_tags')
        .eq('user_id', user.id)
        .order('date', { ascending: true })
        .order('position', { ascending: true }),
      'content'
    ),
    applyFilter(
      supabase.from('tasks')
        .select('id, date, text, html, done, due_date, completed_at, project_tags')
        .eq('user_id', user.id)
        .order('date', { ascending: true })
        .order('position', { ascending: true }),
      'text'
    ),
    // Notes only in named project view (not __everything__ which would be overwhelming)
    isEverything ? { data: [] } : applyFilter(
      supabase.from('notes')
        .select('id, title, content, project_tags, created_at, updated_at')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false }),
      'content'
    ),
  ]);

  if (blocksR.error) throw blocksR.error;
  if (tasksR.error)  throw tasksR.error;
  if (notesR.error)  throw notesR.error;

  return Response.json({
    journalBlocks: blocksR.data ?? [],
    tasks:         tasksR.data  ?? [],
    notes:         notesR.data  ?? [],
    isEverything,
  });
});
