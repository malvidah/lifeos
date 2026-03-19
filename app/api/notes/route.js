import { withAuth } from '../_lib/auth.js';
import { extractProjectTags, extractTitle } from '@/lib/parseBlocks.js';

// GET /api/notes?project=big+think  → notes tagged to that project
// GET /api/notes                    → all notes (global / all-projects view)
// GET /api/notes?id=UUID            → single note
//
// POST /api/notes  { content, origin_project? }
//   Create a new note. project_tags derived from content + origin_project.
//
// PATCH /api/notes  { id, content }
//   Update a note. project_tags and title recomputed from content.
//
// DELETE /api/notes?id=UUID

export const GET = withAuth(async (req, { supabase, user }) => {
  const { searchParams } = new URL(req.url);
  const project = searchParams.get('project');
  const id      = searchParams.get('id');

  let query = supabase
    .from('notes')
    .select('id, title, content, project_tags, created_at, updated_at')
    .eq('user_id', user.id)
    .is('deleted_at', null);

  if (id) {
    const { data, error } = await query.eq('id', id).maybeSingle();
    if (error) throw error;
    return Response.json({ note: data });
  }

  if (project) {
    query = query.contains('project_tags', [project.toLowerCase()]);
  }

  const { data, error } = await query.order('updated_at', { ascending: false });
  if (error) throw error;
  return Response.json({ notes: data ?? [] });
});

export const POST = withAuth(async (req, { supabase, user }) => {
  const { content = '', origin_project } = await req.json();

  // Derive project_tags from content chips + origin_project
  const contentTags = extractProjectTags(content);
  const tags = origin_project
    ? [...new Set([...contentTags, origin_project.toLowerCase()])]
    : contentTags;

  const { data, error } = await supabase
    .from('notes')
    .insert({
      user_id:      user.id,
      title:        extractTitle(content),
      content,
      project_tags: tags,
    })
    .select('id, title, content, project_tags, created_at, updated_at')
    .single();
  if (error) throw error;

  return Response.json({ note: data });
});

export const PATCH = withAuth(async (req, { supabase, user }) => {
  const { id, content } = await req.json();
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const patch = {};
  if (content !== undefined) {
    patch.content = content;
    patch.title   = extractTitle(content);

    // Merge new content tags with existing tags so the note doesn't lose
    // its project association when the user edits without a {project} chip.
    const contentTags = extractProjectTags(content);
    const { data: existing } = await supabase
      .from('notes').select('project_tags').eq('id', id).eq('user_id', user.id).maybeSingle();
    const existingTags = existing?.project_tags ?? [];
    patch.project_tags = [...new Set([...existingTags, ...contentTags])];
  }

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
    .from('notes').update({ deleted_at: new Date().toISOString() })
    .eq('id', id).eq('user_id', user.id);
  if (error) throw error;

  return Response.json({ ok: true });
});
