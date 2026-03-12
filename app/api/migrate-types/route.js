/**
 * /api/migrate-types
 *
 * Idempotent migration for Day Lab storage format changes.
 *
 * GET  ?preview=1       — show counts of what would change, no writes
 * POST                  — run all migrations
 * POST ?cleanup=1       — delete old-type rows that have been migrated
 *
 * What this migrates (all in one pass):
 *
 *   TYPE RENAMES
 *     notes    → journal   (journal entries, date-keyed plain text)
 *     activity → workouts  (workout rows, date-keyed array)
 *
 *   TEXT REWRITES  (applied to new rows at migration time)
 *     Project tags:  #ProjectName  → {projectname}   (lowercase, braces)
 *     Note links:    @NoteName     → [NoteName]       (square brackets)
 *
 * The text rewrites are applied when copying rows from old→new type.
 * Old-type rows are kept intact until ?cleanup=1 is called.
 */

import { createClient } from '@supabase/supabase-js';

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

// ── Text rewriters ────────────────────────────────────────────────────────────

// #ProjectName → {projectname}  (lowercase, spaces stripped from camelCase split)
// BigThink → bigthink, Big Think → big think
const HASH_TAG_RE = /#([A-Za-z][A-Za-z0-9]+)(?![A-Za-z0-9])/g;

function rewriteProjectTags(text) {
  if (typeof text !== 'string') return text;
  return text.replace(HASH_TAG_RE, (_, name) => {
    // CamelCase → lowercase: BigThink → bigthink (no space — stored compact)
    const lower = name
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .trim();
    return `{${lower}}`;
  });
}

// @NoteName → [NoteName]  (preserve original casing)
const AT_NOTE_RE = /@([A-Za-z][^\s@#\[\]{}]*(?:\s[A-Za-z][^\s@#\[\]{}]*)*)(?=\s|$)/g;

function rewriteNoteLinks(text) {
  if (typeof text !== 'string') return text;
  return text.replace(AT_NOTE_RE, (_, name) => `[${name.trim()}]`);
}

function rewriteJournalText(text) {
  if (typeof text !== 'string') return text;
  return rewriteNoteLinks(rewriteProjectTags(text));
}

function rewriteTasksArray(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map(task => {
    if (!task?.text) return task;
    return { ...task, text: rewriteProjectTags(task.text) };
  });
}

// project-notes: {notes:[{id,content,updatedAt}], activeId}
// Note content can contain @links and #tags
function rewriteProjectNotes(data) {
  if (!data || typeof data !== 'object') return data;
  const notes = Array.isArray(data.notes)
    ? data.notes.map(n => ({ ...n, content: rewriteJournalText(n.content || '') }))
    : data.notes;
  return { ...data, notes };
}

// ── Preview counts ─────────────────────────────────────────────────────────────
export async function GET(req) {
  const { supabase } = getUserClient(req);
  if (!supabase) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const uid = user.id;
  const count = async (type) => {
    const { count: c } = await supabase
      .from('entries').select('*', { count: 'exact', head: true })
      .eq('user_id', uid).eq('type', type);
    return c ?? 0;
  };

  const report = {
    'notes → journal':    { old: await count('notes'),    new: await count('journal') },
    'activity → workouts':{ old: await count('activity'), new: await count('workouts') },
    'project-notes (text rewrite only)': { rows: await count('project-notes') },
  };

  return Response.json({ preview: true, user: uid, report });
}

// ── Run migration ──────────────────────────────────────────────────────────────
export async function POST(req) {
  const { supabase } = getUserClient(req);
  if (!supabase) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const cleanup = searchParams.get('cleanup') === '1';
  const uid = user.id;
  const now = new Date().toISOString();
  const results = {};

  if (cleanup) {
    // Delete old-type rows that have a corresponding new-type row with the same date
    for (const [oldType, newType] of [['notes','journal'],['activity','workouts']]) {
      const { data: newRows } = await supabase
        .from('entries').select('date').eq('user_id', uid).eq('type', newType);
      const dates = (newRows || []).map(r => r.date);
      if (!dates.length) { results[`cleanup:${oldType}`] = { deleted: 0 }; continue; }
      const { count } = await supabase
        .from('entries').delete({ count: 'exact' })
        .eq('user_id', uid).eq('type', oldType).in('date', dates);
      results[`cleanup:${oldType}`] = { deleted: count ?? 0 };
    }
    return Response.json({ cleanup: true, user: uid, results });
  }

  // ── 1. notes → journal  (rewrite project tags + note links in text) ──────
  {
    const { data: rows, error: err } = await supabase
      .from('entries').select('*').eq('user_id', uid).eq('type', 'notes');
    if (err) {
      results['notes → journal'] = { error: err.message };
    } else if (!rows?.length) {
      results['notes → journal'] = { migrated: 0, note: 'nothing to migrate' };
    } else {
      const newRows = rows.map(({ id: _id, created_at: _ca, ...rest }) => ({
        ...rest,
        type: 'journal',
        data: rewriteJournalText(rest.data),
        updated_at: now,
      }));
      const { error: uErr } = await supabase
        .from('entries').upsert(newRows, { onConflict: 'user_id,date,type' });
      results['notes → journal'] = uErr
        ? { error: uErr.message }
        : { migrated: rows.length };
    }
  }

  // ── 2. activity → workouts  (no text rewrite needed) ──────────────────────
  {
    const { data: rows, error: err } = await supabase
      .from('entries').select('*').eq('user_id', uid).eq('type', 'activity');
    if (err) {
      results['activity → workouts'] = { error: err.message };
    } else if (!rows?.length) {
      results['activity → workouts'] = { migrated: 0, note: 'nothing to migrate' };
    } else {
      const newRows = rows.map(({ id: _id, created_at: _ca, ...rest }) => ({
        ...rest,
        type: 'workouts',
        updated_at: now,
      }));
      const { error: uErr } = await supabase
        .from('entries').upsert(newRows, { onConflict: 'user_id,date,type' });
      results['activity → workouts'] = uErr
        ? { error: uErr.message }
        : { migrated: rows.length };
    }
  }

  // ── 3. tasks — rewrite project tags in-place (type stays 'tasks') ─────────
  {
    const { data: rows, error: err } = await supabase
      .from('entries').select('*').eq('user_id', uid).eq('type', 'tasks');
    if (err) {
      results['tasks (text rewrite)'] = { error: err.message };
    } else if (!rows?.length) {
      results['tasks (text rewrite)'] = { migrated: 0, note: 'nothing to migrate' };
    } else {
      const updated = rows.map(({ id: _id, created_at: _ca, ...rest }) => ({
        ...rest,
        data: rewriteTasksArray(rest.data),
        updated_at: now,
      }));
      const { error: uErr } = await supabase
        .from('entries').upsert(updated, { onConflict: 'user_id,date,type' });
      results['tasks (text rewrite)'] = uErr
        ? { error: uErr.message }
        : { migrated: rows.length };
    }
  }

  // ── 4. project-notes — rewrite @links and #tags in note content ───────────
  {
    const { data: rows, error: err } = await supabase
      .from('entries').select('*').eq('user_id', uid).eq('type', 'project-notes');
    if (err) {
      results['project-notes (text rewrite)'] = { error: err.message };
    } else if (!rows?.length) {
      results['project-notes (text rewrite)'] = { migrated: 0, note: 'nothing to migrate' };
    } else {
      const updated = rows.map(({ id: _id, created_at: _ca, ...rest }) => ({
        ...rest,
        data: rewriteProjectNotes(
          typeof rest.data === 'string' ? JSON.parse(rest.data) : rest.data
        ),
        updated_at: now,
      }));
      const { error: uErr } = await supabase
        .from('entries').upsert(updated, { onConflict: 'user_id,date,type' });
      results['project-notes (text rewrite)'] = uErr
        ? { error: uErr.message }
        : { migrated: rows.length };
    }
  }

  return Response.json({ user: uid, results });
}
