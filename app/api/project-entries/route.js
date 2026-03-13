import { withAuth } from '../_lib/auth.js';

// GET /api/project-entries?project=big+think
//   Returns all content tagged to that project, split by type.
//   Special value: __everything__ (all content, no tag filter).
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
  const project = new URL(req.url).searchParams.get('project');
  if (!project || !isValidProject(project))
    return Response.json({ error: 'invalid project name', got: project }, { status: 400 });

  const isEverything = project === '__everything__';

  // Build three parallel queries, all using GIN-indexed project_tags contains filter
  const filter = isEverything
    ? (q) => q                                            // no filter
    : (q) => q.contains('project_tags', [project]);      // GIN contains

  const [blocksR, tasksR, notesR] = await Promise.all([
    filter(
      supabase.from('journal_blocks')
        .select('id, date, position, content, project_tags, note_tags')
        .eq('user_id', user.id)
        .order('date', { ascending: true })
        .order('position', { ascending: true })
    ),
    filter(
      supabase.from('tasks')
        .select('id, date, text, html, done, due_date, completed_at, project_tags')
        .eq('user_id', user.id)
        .order('date', { ascending: true })
        .order('position', { ascending: true })
    ),
    // Notes only in named project view (not __everything__ which would be overwhelming)
    isEverything ? { data: [] } : filter(
      supabase.from('notes')
        .select('id, title, content, project_tags, created_at, updated_at')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
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
