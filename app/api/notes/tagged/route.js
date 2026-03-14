import { withAuth } from '../../_lib/auth.js';

// GET /api/notes/tagged?project=X
// Returns notes from OTHER projects whose content contains a {X} project tag.
// Used by ProjectView to show cross-project linked notes.

export const GET = withAuth(async (req, { supabase, user }) => {
  const project = new URL(req.url).searchParams.get('project');
  if (!project) return Response.json({ error: 'project required' }, { status: 400 });

  const lower = project.toLowerCase();

  // Fetch all project-notes entries except the current project's own
  const { data, error } = await supabase
    .from('entries')
    .select('date, data')
    .eq('user_id', user.id)
    .eq('type', 'project-notes')
    .neq('date', lower);
  if (error) throw error;

  // Scan each note's HTML content for the project tag
  const tagRe = new RegExp(`data-project-tag=["']${lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i');

  const linkedNotes = [];
  for (const entry of (data || [])) {
    const notes = entry.data?.notes;
    if (!Array.isArray(notes)) continue;
    for (const note of notes) {
      if (!note.content || !tagRe.test(note.content)) continue;
      linkedNotes.push({
        id: note.id,
        content: note.content,
        updatedAt: note.updatedAt,
        sourceProject: entry.date,
      });
    }
  }

  return Response.json({ linkedNotes });
});
