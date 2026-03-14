import { withAuth } from '../_lib/auth.js';
import { parseJournalBlocks, blocksToHtml } from '@/lib/parseBlocks.js';

// GET /api/journal?date=YYYY-MM-DD
//   → { data: '<p>...</p><p>...</p>' }  (reconstructed HTML for TipTap)
//
// GET /api/journal?project=big+think
//   → { blocks: [{id, date, content, project_tags}] }  (project view)
//
// POST /api/journal  { date, data: '<p>...</p>' }
//   → Parses HTML into blocks, full-replaces all blocks for that date.

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

  // ── Day view: all blocks for a date, ordered by position ─────────────────
  if (!date) return Response.json({ error: 'date or project required' }, { status: 400 });

  const { data, error } = await supabase
    .from('journal_blocks')
    .select('id, position, content, project_tags, note_tags')
    .eq('user_id', user.id)
    .eq('date', date)
    .order('position', { ascending: true });
  if (error) throw error;

  return Response.json({ data: blocksToHtml(data) });
});

export const POST = withAuth(async (req, { supabase, user }) => {
  const { date, data: html } = await req.json();
  if (!date) return Response.json({ error: 'date required' }, { status: 400 });

  const blocks = parseJournalBlocks(html || '');

  // Atomic replace via RPC — DELETE+INSERT in one transaction
  const { error: rpcErr } = await supabase.rpc('batch_replace_journal_blocks', {
    p_user_id: user.id,
    p_date:    date,
    p_blocks:  blocks.map(b => ({
      position:     b.position,
      content:      b.content,
      project_tags: b.project_tags ?? [],
      note_tags:    b.note_tags ?? [],
    })),
  });
  if (rpcErr) throw rpcErr;

  return Response.json({ ok: true, blocks: blocks.length });
});
