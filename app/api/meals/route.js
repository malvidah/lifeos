import { withAuth } from '../_lib/auth.js';
import { parseMealItems, mealItemsToArray } from '@/lib/parseBlocks.js';

// GET /api/meals?date=YYYY-MM-DD
//   → { data: [{id, text, kcal, protein}, ...] }  (same shape as before)
//
// GET /api/meals?project=big+think
//   → { items: [{id, date, content, ai_calories, ai_protein, project_tags}] }
//
// POST /api/meals  { date, data: [{id, text, kcal, protein}, ...] }
//   Full-replace all meal items for that date.
//
// PATCH /api/meals  { id, ai_calories, ai_protein }
//   Update AI nutrition estimates for a single item (called after AI returns).

export const GET = withAuth(async (req, { supabase, user }) => {
  const { searchParams } = new URL(req.url);
  const date    = searchParams.get('date');
  const project = searchParams.get('project');

  // ── Project view ─────────────────────────────────────────────────────────
  if (project) {
    const { data, error } = await supabase
      .from('meal_items')
      .select('id, date, content, ai_calories, ai_protein, project_tags, position')
      .eq('user_id', user.id)
      .contains('project_tags', [project.toLowerCase()])
      .order('date', { ascending: false })
      .order('position', { ascending: true });
    if (error) throw error;
    return Response.json({ items: data ?? [] });
  }

  // ── Day view ──────────────────────────────────────────────────────────────
  if (!date) return Response.json({ error: 'date or project required' }, { status: 400 });

  const { data, error } = await supabase
    .from('meal_items')
    .select('id, position, content, ai_calories, ai_protein, project_tags')
    .eq('user_id', user.id)
    .eq('date', date)
    .order('position', { ascending: true });
  if (error) throw error;

  return Response.json({ data: mealItemsToArray(data) });
});

export const POST = withAuth(async (req, { supabase, user }) => {
  const { date, data: items } = await req.json();
  if (!date) return Response.json({ error: 'date required' }, { status: 400 });

  const parsed = parseMealItems(items);

  // Atomic delete + insert in a single transaction
  const { error: rpcErr } = await supabase.rpc('batch_replace_meal_items', {
    p_user_id: user.id,
    p_date:    date,
    p_items:   parsed.map(p => ({
      position:     p.position,
      content:      p.content,
      ai_calories:  p.ai_calories ?? null,
      ai_protein:   p.ai_protein ?? null,
      ai_parsed_at: (p.ai_calories || p.ai_protein) ? new Date().toISOString() : null,
    })),
  });
  if (rpcErr) throw rpcErr;

  return Response.json({ ok: true, items: parsed.length });
});

export const PATCH = withAuth(async (req, { supabase, user }) => {
  const { id, ai_calories, ai_protein, project_tags } = await req.json();
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const patch = {};
  if (ai_calories !== undefined) { patch.ai_calories = ai_calories; patch.ai_parsed_at = new Date().toISOString(); }
  if (ai_protein  !== undefined) { patch.ai_protein  = ai_protein; }
  if (project_tags !== undefined) patch.project_tags = project_tags;

  const { error } = await supabase
    .from('meal_items').update(patch)
    .eq('id', id).eq('user_id', user.id);
  if (error) throw error;

  return Response.json({ ok: true });
});
