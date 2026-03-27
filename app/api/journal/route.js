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
  const date     = searchParams.get('date');
  const project  = searchParams.get('project');
  const recent   = searchParams.get('recent');
  const memories = searchParams.get('memories');

  // ── Memories: same day in previous years ────────────────────────────────────
  if (memories) {
    const [, mm, dd] = memories.split('-');
    const thisYear = parseInt(memories.split('-')[0], 10);
    // Build list of same month-day for previous years
    const pastDates = [];
    for (let y = thisYear - 1; y >= thisYear - 10; y--) {
      pastDates.push(`${y}-${mm}-${dd}`);
    }
    const { data: blocks, error } = await supabase
      .from('journal_blocks')
      .select('id, date, position, content, project_tags, note_tags')
      .eq('user_id', user.id)
      .in('date', pastDates)
      .order('date', { ascending: false })
      .order('position', { ascending: true });
    if (error) throw error;
    // Group by date, only include dates that have blocks
    const grouped = {};
    for (const b of (blocks ?? [])) {
      if (!grouped[b.date]) grouped[b.date] = [];
      grouped[b.date].push(b);
    }
    const entries = Object.keys(grouped)
      .sort((a, b) => b.localeCompare(a))
      .map(d => ({ date: d, blocks: grouped[d] }));
    return Response.json({ entries });
  }

  // ── Recent entries: N most recent dates with journal blocks ────────────────
  // ?recent=5&before=YYYY-MM-DD → 5 dates with entries on or before the given date
  if (recent) {
    const limit = Math.min(Math.max(1, parseInt(recent, 10) || 5), 20);
    const before = searchParams.get('before');
    // Get distinct dates with journal blocks, on or before the anchor date
    let query = supabase
      .from('journal_blocks')
      .select('date')
      .eq('user_id', user.id)
      .order('date', { ascending: false });
    if (before) query = query.lte('date', before);
    const { data: dates, error: dErr } = await query;
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

  // Auto-create goals from data-goal attributes in journal block HTML.
  // Journal content is TipTap HTML — goal tags render as <span data-goal="name">
  // not as {g:name} text tokens. Project tags are already extracted as project_tags[].
  // Wrapped in try-catch so goal errors never block journal saving.
  try {
    for (const block of blocks) {
      const htmlContent = block.content || '';
      const goalRe = /data-goal="([^"]+)"/g;
      let gm;
      const goalNames = [];
      while ((gm = goalRe.exec(htmlContent)) !== null) goalNames.push(gm[1].toLowerCase().trim());
      if (goalNames.length) {
        // project_tags[] is already extracted from the HTML by the client
        const projectName = (block.project_tags ?? [])[0] ?? null;
        for (const gName of goalNames) {
          const { data: existing, error: goalErr } = await supabase
            .from('goals').select('id, project')
            .eq('user_id', user.id).eq('name', gName).maybeSingle();
          if (goalErr) continue;
          if (!existing) {
            await supabase.from('goals').insert({ user_id: user.id, name: gName, project: projectName });
          } else if (projectName && !existing.project) {
            await supabase.from('goals').update({ project: projectName, updated_at: new Date().toISOString() })
              .eq('id', existing.id).eq('user_id', user.id);
          }
        }
      }
    }
  } catch (e) { /* goals table may not exist */ }

  return Response.json({ ok: true, blocks: blocks.length });
});
