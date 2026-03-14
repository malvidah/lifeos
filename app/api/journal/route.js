import { withAuth } from '../_lib/auth.js';

// GET /api/journal?date=YYYY-MM-DD
//   → { blocks: [{position, content, project_tags, note_tags}] }
//
// GET /api/journal?project=big+think
//   → { blocks: [{id, date, content, project_tags}] }  (project view)
//
// POST /api/journal  { date, blocks: [{content, project_tags, note_tags}] }
//   → Full-replaces all blocks for that date. Client sends pre-split blocks.

export const GET = withAuth(async (req, { supabase, user }) => {
  const { searchParams } = new URL(req.url);
  const date    = searchParams.get('date');
  const project = searchParams.get('project');

  // ── Project view: all blocks tagged to this project ───────────────────────
  if (project) {
    const { data, error } = await supabase
      .from('journal_blocks')
      .select('id, date, content, project_tags, position')
      .eq('user_id', user.id)
      .contains('project_tags', [project.toLowerCase()])
      .order('date', { ascending: false })
      .order('position', { ascending: true });
    if (error) throw error;
    return Response.json({ blocks: data ?? [] });
  }

  // ── Day view: blocks for a date, ordered by position ──────────────────────
  if (!date) return Response.json({ error: 'date or project required' }, { status: 400 });

  const { data, error } = await supabase
    .from('journal_blocks')
    .select('id, position, content, project_tags, note_tags')
    .eq('user_id', user.id)
    .eq('date', date)
    .order('position', { ascending: true });
  if (error) throw error;

  return Response.json({ blocks: data ?? [] });
});

export const POST = withAuth(async (req, { supabase, user }) => {
  const body = await req.json();
  const { date, blocks } = body;
  if (!date) return Response.json({ error: 'date required' }, { status: 400 });
  if (!Array.isArray(blocks)) return Response.json({ error: 'blocks array required' }, { status: 400 });

  // Full-replace: delete existing blocks for this date, insert new ones
  const { error: delErr } = await supabase
    .from('journal_blocks')
    .delete()
    .eq('user_id', user.id)
    .eq('date', date);
  if (delErr) throw delErr;

  if (blocks.length > 0) {
    const rows = blocks.map((b, i) => ({
      user_id:      user.id,
      date,
      position:     b.position ?? i,
      content:      b.content,
      project_tags: b.project_tags ?? [],
      note_tags:    b.note_tags ?? [],
    }));
    const { error: insErr } = await supabase.from('journal_blocks').insert(rows);
    if (insErr) throw insErr;
  }

  return Response.json({ ok: true, blocks: blocks.length });
});
