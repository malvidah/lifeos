/**
 * /api/migrate-types
 *
 * GET  ?preview=1   — show row counts, no writes
 * POST              — run migration
 * POST ?cleanup=1   — delete old rows after confirming migration looks good
 */

import { withAuth } from '../_lib/auth.js';

// ── Text rewriters ─────────────────────────────────────────────────────────────

const HASH_TAG_RE = /#([A-Za-z][A-Za-z0-9]+)(?![A-Za-z0-9])/g;
function rewriteProjectTags(text) {
  if (typeof text !== 'string') return text;
  // Reset lastIndex — regex is module-level so it persists across calls
  HASH_TAG_RE.lastIndex = 0;
  return text.replace(HASH_TAG_RE, (_, name) => {
    const lower = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().trim();
    return `{${lower}}`;
  });
}

const AT_NOTE_RE = /@([A-Za-z][^\s@#\[\]{}]*(?:\s[A-Za-z][^\s@#\[\]{}]*)*)(?=\s|$)/g;
function rewriteNoteLinks(text) {
  if (typeof text !== 'string') return text;
  AT_NOTE_RE.lastIndex = 0;
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

function rewriteProjectNotes(data) {
  if (!data || typeof data !== 'object') return data;
  const notes = Array.isArray(data.notes)
    ? data.notes.map(n => ({ ...n, content: rewriteJournalText(n.content || '') }))
    : data.notes;
  return { ...data, notes };
}

// ── Safe upsert: delete existing new-type row then insert ─────────────────────
// Avoids relying on named unique constraint which may not exist.
async function safeUpsertRows(supabase, newRows, keyField = 'date') {
  const errors = [];
  for (const row of newRows) {
    // Delete any existing row with same user_id + date/key + type first
    await supabase
      .from('entries')
      .delete()
      .eq('user_id', row.user_id)
      .eq('type', row.type)
      .eq(keyField, row[keyField]);

    const { error } = await supabase.from('entries').insert(row);
    if (error) errors.push(error.message);
  }
  return errors;
}

// ── GET preview ────────────────────────────────────────────────────────────────
export const GET = withAuth(async (req, { supabase, user }) => {
    const uid = user.id;
    const count = async (type) => {
      const { count: c } = await supabase
        .from('entries').select('*', { count: 'exact', head: true })
        .eq('user_id', uid).eq('type', type);
      return c ?? 0;
    };

    const report = {
      'notes → journal':     { old: await count('notes'),    migrated: await count('journal') },
      'activity → workouts': { old: await count('activity'), migrated: await count('workouts') },
      'tasks (rewrite)':     { rows: await count('tasks') },
      'project-notes (rewrite)': { rows: await count('project-notes') },
    };

    return Response.json({ preview: true, user: uid, report });
});

// ── POST migrate / cleanup ─────────────────────────────────────────────────────
export const POST = withAuth(async (req, { supabase, user }) => {
    const { searchParams } = new URL(req.url);
    const cleanup = searchParams.get('cleanup') === '1';
    const uid = user.id;
    const now = new Date().toISOString();
    const results = {};

    // ── Cleanup: delete old-type rows that have been migrated ────────────────
    if (cleanup) {
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

    // ── 1. notes → journal ───────────────────────────────────────────────────
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
        const errors = await safeUpsertRows(supabase, newRows);
        results['notes → journal'] = errors.length
          ? { errors }
          : { migrated: rows.length };
      }
    }

    // ── 2. activity → workouts ───────────────────────────────────────────────
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
        const errors = await safeUpsertRows(supabase, newRows);
        results['activity → workouts'] = errors.length
          ? { errors }
          : { migrated: rows.length };
      }
    }

    // ── 3. tasks — rewrite {project} tags in place ───────────────────────────
    {
      const { data: rows, error: err } = await supabase
        .from('entries').select('*').eq('user_id', uid).eq('type', 'tasks');
      if (err) {
        results['tasks (rewrite)'] = { error: err.message };
      } else if (!rows?.length) {
        results['tasks (rewrite)'] = { migrated: 0, note: 'nothing to migrate' };
      } else {
        const errors = [];
        for (const row of rows) {
          const newData = rewriteTasksArray(row.data);
          const { error: uErr } = await supabase
            .from('entries').update({ data: newData, updated_at: now })
            .eq('id', row.id);
          if (uErr) errors.push(uErr.message);
        }
        results['tasks (rewrite)'] = errors.length
          ? { errors }
          : { migrated: rows.length };
      }
    }

    // ── 4. project-notes — rewrite @links and #tags ──────────────────────────
    {
      const { data: rows, error: err } = await supabase
        .from('entries').select('*').eq('user_id', uid).eq('type', 'project-notes');
      if (err) {
        results['project-notes (rewrite)'] = { error: err.message };
      } else if (!rows?.length) {
        results['project-notes (rewrite)'] = { migrated: 0, note: 'nothing to migrate' };
      } else {
        const errors = [];
        for (const row of rows) {
          let parsed = row.data;
          if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed); } catch { parsed = row.data; }
          }
          const newData = rewriteProjectNotes(parsed);
          const { error: uErr } = await supabase
            .from('entries').update({ data: newData, updated_at: now })
            .eq('id', row.id);
          if (uErr) errors.push(uErr.message);
        }
        results['project-notes (rewrite)'] = errors.length
          ? { errors }
          : { migrated: rows.length };
      }
    }

    return Response.json({ user: uid, results });
});
