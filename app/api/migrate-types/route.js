/**
 * /api/migrate-types
 *
 * One-shot, idempotent data migration for Day Lab type renames.
 *
 * Safe strategy:
 *  1. GET  ?preview=1   — counts rows that WOULD be migrated; no writes
 *  2. POST              — writes the new type alongside the old one
 *                         (old rows kept intact until ?cleanup=1)
 *  3. POST ?cleanup=1   — deletes old-type rows whose new-type counterpart exists
 *
 * Migrations:
 *   type:'notes'     → type:'journal'   (journal entries, date-keyed)
 *   type:'activity'  → type:'workouts'  (workout rows, date-keyed)
 *
 * Auth: requires valid user token (same as all other routes). Only migrates
 * the requesting user's own data — RLS enforces this automatically.
 */

import { createClient } from '@supabase/supabase-js';

const MIGRATIONS = [
  { from: 'notes',    to: 'journal'  },
  { from: 'activity', to: 'workouts' },
];

function getUserClient(req) {
  const auth = req.headers.get('authorization') || '';
  const { searchParams } = new URL(req.url);
  const token = auth.replace('Bearer ', '').trim() || searchParams.get('token') || '';
  if (!token) return { supabase: null };

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  return { supabase };
}

// ── GET — preview ─────────────────────────────────────────────────────────────
export async function GET(req) {
  const { supabase } = getUserClient(req);
  if (!supabase) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const report = {};

  for (const { from, to } of MIGRATIONS) {
    // Count old-type rows
    const { count: oldCount } = await supabase
      .from('entries')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('type', from);

    // Count already-migrated new-type rows
    const { count: newCount } = await supabase
      .from('entries')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('type', to);

    report[`${from} → ${to}`] = {
      pendingMigration: oldCount ?? 0,
      alreadyMigrated:  newCount ?? 0,
    };
  }

  return Response.json({ preview: true, user: user.id, report });
}

// ── POST — migrate (or cleanup) ───────────────────────────────────────────────
export async function POST(req) {
  const { supabase } = getUserClient(req);
  if (!supabase) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const cleanup = searchParams.get('cleanup') === '1';

  const results = {};

  for (const { from, to } of MIGRATIONS) {
    if (cleanup) {
      // Delete old rows where a new-type row with the same date already exists.
      // We can't do a joined delete via Supabase client easily, so:
      //   1. Fetch all new-type dates
      //   2. Delete old-type rows with matching dates
      const { data: newRows } = await supabase
        .from('entries')
        .select('date')
        .eq('user_id', user.id)
        .eq('type', to);

      const migratedDates = (newRows || []).map(r => r.date);

      if (migratedDates.length === 0) {
        results[`cleanup:${from}`] = { deleted: 0, note: 'nothing to clean up' };
        continue;
      }

      const { count } = await supabase
        .from('entries')
        .delete({ count: 'exact' })
        .eq('user_id', user.id)
        .eq('type', from)
        .in('date', migratedDates);

      results[`cleanup:${from}`] = { deleted: count ?? 0 };

    } else {
      // Migrate: read all old-type rows, upsert as new-type.
      // Uses upsert with onConflict:'user_id,date,type' so it's idempotent.
      const { data: oldRows, error: fetchErr } = await supabase
        .from('entries')
        .select('*')
        .eq('user_id', user.id)
        .eq('type', from);

      if (fetchErr) {
        results[`${from} → ${to}`] = { error: fetchErr.message };
        continue;
      }

      if (!oldRows || oldRows.length === 0) {
        results[`${from} → ${to}`] = { migrated: 0, note: 'nothing to migrate' };
        continue;
      }

      const newRows = oldRows.map(({ id: _id, created_at: _ca, ...rest }) => ({
        ...rest,
        type: to,
        // updated_at refreshed so we can tell these are migration-written rows
        updated_at: new Date().toISOString(),
      }));

      const { error: upsertErr, count } = await supabase
        .from('entries')
        .upsert(newRows, { onConflict: 'user_id,date,type', count: 'exact' });

      if (upsertErr) {
        results[`${from} → ${to}`] = { error: upsertErr.message };
      } else {
        results[`${from} → ${to}`] = { migrated: oldRows.length, upserted: count };
      }
    }
  }

  return Response.json({ cleanup, user: user.id, results });
}
