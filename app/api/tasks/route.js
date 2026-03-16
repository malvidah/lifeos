import { withAuth } from '../_lib/auth.js';
import { parseTaskBlocks, tasksToHtml } from '@/lib/parseBlocks.js';
import { isValidDate } from '@/lib/validate.js';
import { parseRecurrence, keyToRecurrence } from '@/lib/recurrence.js';

const TODAY = () => new Date().toISOString().slice(0, 10);

// GET /api/tasks?date=YYYY-MM-DD
//   → { data: '<ul data-type="taskList">...</ul>' }
//   Returns tasks written that day PLUS open tasks due that day (from other dates).
//
// GET /api/tasks?project=big+think
//   → { tasks: [{id, date, text, done, due_date, project_tags}] }
//
// POST /api/tasks  { date, data: '<ul ...>' }
//   Full-replace all tasks written on that date.
//   Preserves due_date on existing rows by matching on text content.
//
// PATCH /api/tasks  { id, done, completed_at?, due_date?, text?, html? }
//   Update a single task row (toggle done, set due date, edit text).
//
// DELETE /api/tasks?id=UUID
//   Delete a single task row.

export const GET = withAuth(async (req, { supabase, user }) => {
  const { searchParams } = new URL(req.url);
  const date    = searchParams.get('date');
  const project = searchParams.get('project');

  // ── Project view ─────────────────────────────────────────────────────────
  if (project) {
    const { data, error } = await supabase
      .from('tasks')
      .select('id, date, due_date, text, html, done, completed_at, project_tags, position')
      .eq('user_id', user.id)
      .contains('project_tags', [project.toLowerCase()])
      .order('date', { ascending: false })
      .order('position', { ascending: true });
    if (error) throw error;
    return Response.json({ tasks: data ?? [] });
  }

  // ── Day view ──────────────────────────────────────────────────────────────
  if (!date || !isValidDate(date)) return Response.json({ error: 'valid date (YYYY-MM-DD) or project required' }, { status: 400 });

  // 1. Tasks written on this date (exclude templates — they're managed by /api/habits)
  const { data: ownTasks, error: e1 } = await supabase
    .from('tasks')
    .select('id, position, html, text, done, due_date, completed_at, project_tags, note_tags, date')
    .eq('user_id', user.id)
    .eq('date', date)
    .is('is_template', false)
    .order('position', { ascending: true });
  if (e1) throw e1;

  // 2. Open tasks with a due date, created on or before today (show every day until done)
  const { data: dueTasks, error: e2 } = await supabase
    .from('tasks')
    .select('id, position, html, text, done, due_date, completed_at, project_tags, note_tags, date')
    .eq('user_id', user.id)
    .not('due_date', 'is', null)
    .lte('date', date)
    .eq('done', false)
    .neq('date', date)  // exclude tasks already captured above
    .order('date', { ascending: true })
    .order('position', { ascending: true });
  if (e2) throw e2;

  // 3. Tasks completed on this date (from other dates) — for "done" filter
  const { data: completedTasks, error: e3 } = await supabase
    .from('tasks')
    .select('id, position, html, text, done, due_date, completed_at, project_tags, note_tags, date')
    .eq('user_id', user.id)
    .eq('completed_at', date)
    .eq('done', true)
    .neq('date', date)
    .order('date', { ascending: true })
    .order('position', { ascending: true });
  if (e3) throw e3;

  // Inject data attributes into each task's <li> for client-side tracking
  const allTasks = [...(ownTasks ?? []), ...(dueTasks ?? []), ...(completedTasks ?? [])];
  for (const t of allTasks) {
    if (t.html) {
      let attrs = ` data-task-id="${t.id}" data-origin-date="${t.date}"`;
      if (t.completed_at) attrs += ` data-completed-date="${t.completed_at}"`;
      t.html = t.html.replace(/^<li\b/, `<li${attrs}`);
    }
  }

  return Response.json({ data: tasksToHtml(allTasks), dueTasks: dueTasks ?? [] });
});

export const POST = withAuth(async (req, { supabase, user }) => {
  const { date, data: html } = await req.json();
  if (!date || !isValidDate(date)) return Response.json({ error: 'valid date (YYYY-MM-DD) required' }, { status: 400 });

  const parsed = parseTaskBlocks(html || '');
  const today  = TODAY();

  // Fetch existing rows for this date so we can preserve due_dates
  // (due_date is not stored in the HTML, only in the DB row)
  const { data: existing } = await supabase
    .from('tasks')
    .select('id, position, text, due_date, completed_at')
    .eq('user_id', user.id)
    .eq('date', date)
    .order('position', { ascending: true });

  // Match by text content (not position) so reordering tasks doesn't
  // shuffle due_dates. Each matched row is consumed to handle duplicates.
  const existingByText = new Map();
  for (const r of (existing ?? [])) {
    const key = r.text?.trim();
    if (!key) continue;
    if (!existingByText.has(key)) existingByText.set(key, []);
    existingByText.get(key).push(r);
  }
  function matchExisting(text) {
    const key = text?.trim();
    const arr = key && existingByText.get(key);
    return arr?.length ? arr.shift() : null;
  }

  // Separate tasks into own-date tasks vs due-date tasks from other dates
  const ownRows = [];
  const foreignTasks = []; // tasks with origin_date !== date (due-date tasks from other days)
  for (const t of parsed) {
    if (t.origin_date && t.origin_date !== date) {
      foreignTasks.push(t);
    } else {
      ownRows.push(t);
    }
  }

  // Full-replace own-date tasks (skip templates and recurring instances)
  const { error: delErr } = await supabase
    .from('tasks').delete()
    .eq('user_id', user.id).eq('date', date)
    .is('is_template', false)
    .is('recurrence_parent_id', null);
  if (delErr) throw delErr;

  // Detect recurrence in tasks — either /d text syntax OR data-recurrence chip
  const templatesToCreate = [];
  const filteredOwnRows = [];
  for (const t of ownRows) {
    // Check for recurrence chip in HTML: <span data-recurrence="key" ...>
    const chipMatch = t.html?.match(/data-recurrence="([^"]+)"/);
    // Check for /d text syntax
    const { cleanText, recurrence: textRecurrence } = parseRecurrence(t.text, date);
    const recurrence = chipMatch ? keyToRecurrence(chipMatch[1], date) : textRecurrence;
    const taskText = chipMatch
      ? t.text.replace(/\{d:[^}]*\}/g, '').trim() // strip serialized chip text
      : (recurrence ? cleanText : null);

    if (recurrence && taskText) {
      // Strip the recurrence chip HTML from the template
      const cleanHtml = t.html
        .replace(/<span[^>]*data-recurrence[^>]*>[\s\S]*?<\/span>/g, '')
        .replace(/\/d\s+[^<]*/gi, taskText);
      templatesToCreate.push({
        user_id: user.id,
        date,
        text: taskText,
        html: cleanHtml,
        done: false,
        is_template: true,
        recurrence,
        project_tags: t.project_tags ?? [],
        note_tags: t.note_tags ?? [],
        position: 0,
      });
    } else {
      filteredOwnRows.push(t);
    }
  }

  // Create any habit templates
  if (templatesToCreate.length > 0) {
    await supabase.from('tasks').insert(templatesToCreate);
  }

  if (filteredOwnRows.length > 0) {
    const rows = filteredOwnRows.map(t => {
      const prev = matchExisting(t.text);
      return {
        user_id:      user.id,
        date,
        position:     t.position,
        html:         t.html,
        text:         t.text,
        done:         t.done,
        due_date:     t.due_date ?? prev?.due_date ?? null,
        completed_at: t.done ? (prev?.completed_at ?? today) : null,
        project_tags: t.project_tags,
        note_tags:    t.note_tags,
      };
    });
    const { error: insErr } = await supabase.from('tasks').insert(rows);
    if (insErr) throw insErr;
  }

  // Update foreign (due-date) tasks in place — toggle done, update text
  for (const t of foreignTasks) {
    if (!t.task_id) continue;
    const patch = { done: t.done, html: t.html, text: t.text };
    if (t.done) patch.completed_at = today;
    else patch.completed_at = null;
    await supabase.from('tasks').update(patch)
      .eq('id', t.task_id).eq('user_id', user.id);
  }

  // Delete foreign tasks that were in the editor but got removed by the user
  // (loaded as dueTasks but absent from the saved HTML)
  const { data: loadedDue } = await supabase
    .from('tasks')
    .select('id')
    .eq('user_id', user.id)
    .not('due_date', 'is', null)
    .lte('date', date)
    .eq('done', false)
    .neq('date', date);
  const savedForeignIds = new Set(foreignTasks.map(t => t.task_id).filter(Boolean));
  const removedIds = (loadedDue ?? [])
    .map(t => t.id)
    .filter(id => !savedForeignIds.has(id));
  if (removedIds.length > 0) {
    await supabase.from('tasks').delete()
      .eq('user_id', user.id)
      .in('id', removedIds);
  }

  return Response.json({ ok: true, tasks: parsed.length });
});

export const PATCH = withAuth(async (req, { supabase, user }) => {
  const { id, ...updates } = await req.json();
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  // Whitelist updatable fields
  const allowed = ['done', 'completed_at', 'due_date', 'text', 'html', 'project_tags'];
  const patch = Object.fromEntries(
    Object.entries(updates).filter(([k]) => allowed.includes(k))
  );

  // Auto-set completed_at when toggling done
  if ('done' in patch && !('completed_at' in patch)) {
    patch.completed_at = patch.done ? TODAY() : null;
  }

  const { error } = await supabase
    .from('tasks').update(patch)
    .eq('id', id).eq('user_id', user.id);
  if (error) throw error;

  return Response.json({ ok: true });
});

export const DELETE = withAuth(async (req, { supabase, user }) => {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabase
    .from('tasks').delete()
    .eq('id', id).eq('user_id', user.id);
  if (error) throw error;

  return Response.json({ ok: true });
});
