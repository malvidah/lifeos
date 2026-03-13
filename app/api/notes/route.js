import { withAuth } from '../_lib/auth.js';

// GET /api/notes?project=big+think  → notes tagged to that project
// GET /api/notes                    → all notes (global / all-projects view)
// GET /api/notes?id=UUID            → single note
//
// POST /api/notes  { title, content, project_tags? }
//   Create a new note. Notes are NOT date-scoped — they live in project space.
//   Link to a note from journal/tasks via the /n chip; that sets data-note-link.
//
// PATCH /api/notes  { id, title?, content?, project_tags? }
// DELETE /api/notes?id=UUID

export const GET = withAuth(async (req, { supabase, user }) => {
  const { searchParams } = new URL(req.url);
  const project = searchParams.get('project');
  const id      = searchParams.get('id');

  let query = supabase
    .from('notes')
    .select('id, title, content, project_tags, created_at, updated_at')
    .eq('user_id', user.id);

  if (id) {
    const { data, error } = await query.eq('id', id).maybeSingle();
    if (error) throw error;
    return Response.json({ note: data });
  }

  if (project) {
    query = query.contains('project_tags', [project.toLowerCase()]);
  }
  // else: no filter → all notes (global view)

  const { data, error } = await query.order('updated_at', { ascending: false });
  if (error) throw error;
  return Response.json({ notes: data ?? [] });
});

export const POST = withAuth(async (req, { supabase, user }) => {
  const { title = '', content = '', project_tags = [] } = await req.json();

  const { data, error } = await supabase
    .from('notes')
    .insert({
      user_id:      user.id,
      title,
      content,
      project_tags: project_tags.map(t => t.toLowerCase()),
    })
    .select('id, title, content, project_tags, created_at, updated_at')
    .single();
  if (error) throw error;

  return Response.json({ note: data });
});

export const PATCH = withAuth(async (req, { supabase, user }) => {
  const { id, title, content, project_tags } = await req.json();
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const patch = {};
  if (title        !== undefined) patch.title        = title;
  if (content      !== undefined) patch.content      = content;
  if (project_tags !== undefined) patch.project_tags = project_tags.map(t => t.toLowerCase());

  const { data, error } = await supabase
    .from('notes').update(patch)
    .eq('id', id).eq('user_id', user.id)
    .select('id, title, content, project_tags, updated_at')
    .single();
  if (error) throw error;

  return Response.json({ note: data });
});

export const DELETE = withAuth(async (req, { supabase, user }) => {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabase
    .from('notes').delete()
    .eq('id', id).eq('user_id', user.id);
  if (error) throw error;

  return Response.json({ ok: true });
});
