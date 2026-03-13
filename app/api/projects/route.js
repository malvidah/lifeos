import { withAuth } from '../_lib/auth.js';
import { parseTasks } from '../_lib/parseTasks.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

const TAG_RE = /\{([a-z0-9][a-z0-9 ]*[a-z0-9]|[a-z0-9])\}/g;
const TAG_RE_LEGACY = /#([A-Za-z][A-Za-z0-9]+)(?![A-Za-z0-9])/g;
const BUILTINS = new Set(['health']);

function scanTags(text, out) {
  if (typeof text !== 'string') return;
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(text)) !== null) {
    const name = m[1].toLowerCase();
    if (!BUILTINS.has(name)) out.add(name);
  }
  TAG_RE_LEGACY.lastIndex = 0;
  while ((m = TAG_RE_LEGACY.exec(text)) !== null) {
    const name = m[1].toLowerCase();
    if (!BUILTINS.has(name)) out.add(name);
  }
}

// ─── GET /api/projects ────────────────────────────────────────────────────────
// Returns projects from the DB, augmented with any tags used in entries that
// don't yet have a project record (lazy migration on read).
export const GET = withAuth(async (_req, { supabase, user }) => {
  const [projR, journalR, tasksR] = await Promise.all([
    supabase.from('projects').select('*').eq('user_id', user.id).order('last_active', { ascending: false, nullsFirst: false }),
    supabase.from('entries').select('data').eq('user_id', user.id).eq('type', 'journal'),
    supabase.from('entries').select('data').eq('user_id', user.id).eq('type', 'tasks'),
  ]);

  // Build set of all tag names used in entries
  const usedTags = new Set();
  for (const row of (journalR.data || [])) scanTags(typeof row.data === 'string' ? row.data : '', usedTags);
  for (const row of (tasksR.data || [])) {
    for (const task of parseTasks(row.data)) scanTags(task.text, usedTags);
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

  // Return merged list: DB projects first (sorted by last_active), then any
  // used tags without records (shouldn't happen after lazy creation above)
  const projects = [...existing.values()].sort((a, b) => {
    if (a.last_active && b.last_active) return b.last_active.localeCompare(a.last_active);
    if (a.last_active) return -1;
    if (b.last_active) return 1;
    return b.created_at.localeCompare(a.created_at);
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

  const { data, error } = await supabase.from('projects')
    .update(patch)
    .eq('user_id', user.id)
    .eq('name', name.toLowerCase())
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ project: data });
});
