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
  const recent  = searchParams.get('recent');

  // ── Recent entries: N most recent dates with journal blocks ────────────────
  if (recent) {
    const limit = Math.min(Math.max(1, parseInt(recent, 10) || 5), 20);
    // Get distinct dates with journal blocks, most recent first
    const { data: dates, error: dErr } = await supabase
      .from('journal_blocks')
      .select('date')
      .eq('user_id', user.id)
      .order('date', { ascending: false });
    if (dErr) throw dErr;
    // Deduplicate dates and take top N
    const uniqueDates = [...new Set((dates ?? []).map(r => r.date))].slice(0, limit);
    if (!uniqueDates.length) return Response.json({ entries: [] });
    // Fetch all blocks for those dates
    const { data: blocks, error: bErr } = await supabase
      .from('journal_blocks')
      .select('id, date, position, content, project_tags, note_tags')
      .eq('user_id', user.id)
      .in('date', uniqueDates)
      .order('date', { ascending: false })
      .order('position', { ascending: true });
    if (bErr) throw bErr;
    // Group by date
    const grouped = {};
    for (const b of (blocks ?? [])) {
      if (!grouped[b.date]) grouped[b.date] = [];
      grouped[b.date].push(b);
    }
    const entries = uniqueDates.map(d => ({ date: d, blocks: grouped[d] || [] }));
    return Response.json({ entries });
  }

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

  // Full-replace via atomic RPC (DELETE+INSERT in one transaction)
  const rows = blocks.map((b, i) => ({
    position:     b.position ?? i,
    content:      b.content,
    project_tags: b.project_tags ?? [],
    note_tags:    b.note_tags ?? [],
  }));

  const { error: rpcErr } = await supabase.rpc('batch_replace_journal_blocks', {
    p_user_id: user.id,
    p_date:    date,
    p_blocks:  rows,
  });
  if (rpcErr) throw rpcErr;

  return Response.json({ ok: true, blocks: blocks.length });
});
