import { createClient } from '@supabase/supabase-js';

// Temporary recovery endpoint — lists recently deleted tasks and suspicious live tasks.
// DELETE THIS FILE after recovery is complete.
// Secured by a hardcoded token so it can't be called by anyone else.

const ADMIN_TOKEN = 'lifeos-recovery-2026-03-27';

export const GET = async (req) => {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  if (token !== ADMIN_TOKEN) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // 1. Soft-deleted tasks (deleted_at IS NOT NULL), most recent first
  const { data: deleted } = await supabase
    .from('tasks')
    .select('id, user_id, date, text, done, due_date, deleted_at, updated_at')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
    .limit(50);

  // 2. Live tasks updated in the last 24 hours (could be corrupted overwrites)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentlyUpdated } = await supabase
    .from('tasks')
    .select('id, user_id, date, text, done, due_date, updated_at, html')
    .is('deleted_at', null)
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(50);

  return Response.json({
    deleted: deleted ?? [],
    recentlyUpdated: recentlyUpdated ?? [],
  });
};

// POST: restore a soft-deleted task by clearing its deleted_at
export const POST = async (req) => {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  if (token !== ADMIN_TOKEN) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { ids } = await req.json();
  if (!Array.isArray(ids) || !ids.length) {
    return Response.json({ error: 'ids array required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('tasks')
    .update({ deleted_at: null })
    .in('id', ids)
    .select('id, date, text');

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ restored: data });
};
