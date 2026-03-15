import { withAuth } from '../_lib/auth.js';

const BUILTINS = new Set(['health']);

// ─── GET /api/projects ────────────────────────────────────────────────────────
// Returns projects from the DB, augmented with any tags used in the new typed
// tables that don't yet have a project record (lazy migration on read).
export const GET = withAuth(async (_req, { supabase, user }) => {
  const [projR, journalR, tasksR, notesR, workoutsR, mealsR] = await Promise.all([
    supabase.from('projects').select('*').eq('user_id', user.id).order('last_active', { ascending: false, nullsFirst: false }),
    supabase.from('journal_blocks').select('project_tags').eq('user_id', user.id),
    supabase.from('tasks').select('project_tags').eq('user_id', user.id),
    supabase.from('notes').select('project_tags').eq('user_id', user.id),
    supabase.from('workouts').select('project_tags').eq('user_id', user.id),
    supabase.from('meal_items').select('project_tags').eq('user_id', user.id),
  ]);

  // Build set of all tag names used across content tables
  const usedTags = new Set();
  for (const result of [journalR, tasksR, notesR, workoutsR, mealsR]) {
    for (const row of result.data ?? []) {
      for (const tag of row.project_tags ?? []) {
        const lower = tag.toLowerCase().trim();
        if (lower && !BUILTINS.has(lower)) usedTags.add(lower);
      }
    }
  }

  // Build map of existing project records
  const existing = new Map((projR.data || []).map(p => [p.name, p]));

  // Auto-create project records for tags that don't have one yet
  const missing = [...usedTags].filter(name => !existing.has(name));
  if (missing.length > 0) {
    const rows = missing.map(name => ({ user_id: user.id, name }));
    const { data: created } = await supabase.from('projects').insert(rows).select();
    for (const p of (created || [])) existing.set(p.name, p);
  }

  // Auto-delete orphaned projects: no references in any content table and no notes
  const orphaned = [...existing.entries()]
    .filter(([name, p]) => !usedTags.has(name) && !p.notes?.trim())
    .map(([, p]) => p.id);
  if (orphaned.length > 0) {
    await supabase.from('projects').delete().in('id', orphaned);
    for (const id of orphaned) {
      for (const [name, p] of existing) { if (p.id === id) existing.delete(name); }
    }
  }

  const projects = [...existing.values()].sort((a, b) => {
    if (a.last_active && b.last_active) return b.last_active.localeCompare(a.last_active);
    if (a.last_active) return -1;
    if (b.last_active) return 1;
    return b.created_at?.localeCompare(a.created_at) ?? 0;
  });

  return Response.json({ projects });
});

// ─── POST /api/projects ───────────────────────────────────────────────────────
// Upsert a project (create if it doesn't exist, update if it does).
// Body: { name, color?, notes?, status?, last_active? }
export const POST = withAuth(async (req, { supabase, user }) => {
  const body = await req.json().catch(() => ({}));
  const { name, color, notes, status, last_active } = body;

  if (!name || typeof name !== 'string') {
    return Response.json({ error: 'name is required' }, { status: 400 });
  }
  const safeName = name.toLowerCase().trim().slice(0, 40);

  const payload = { user_id: user.id, name: safeName };
  if (color     !== undefined) payload.color       = color || null;
  if (notes     !== undefined) payload.notes       = notes || '';
  if (status    !== undefined) payload.status      = ['active','archived'].includes(status) ? status : 'active';
  if (last_active !== undefined) payload.last_active = last_active || null;

  const { data, error } = await supabase.from('projects')
    .upsert(payload, { onConflict: 'user_id,name' })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ project: data });
});

// ─── PATCH /api/projects ──────────────────────────────────────────────────────
// Update specific fields on an existing project.
// Body: { name, ...fields }
export const PATCH = withAuth(async (req, { supabase, user }) => {
  const body = await req.json().catch(() => ({}));
  const { name, ...updates } = body;

  if (!name) return Response.json({ error: 'name is required' }, { status: 400 });

  // Whitelist updatable fields
  const allowed = ['color', 'notes', 'status', 'last_active'];
  const patch = {};
  for (const k of allowed) {
    if (k in updates) patch[k] = updates[k];
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: 'no updatable fields provided' }, { status: 400 });
  }

  // Upsert so the project is auto-created if it doesn't exist yet
  // (e.g. PATCH races ahead of the POST that creates the project)
  const safeName = name.toLowerCase().trim();
  const { data, error } = await supabase.from('projects')
    .upsert({ user_id: user.id, name: safeName, ...patch }, { onConflict: 'user_id,name' })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ project: data });
});
