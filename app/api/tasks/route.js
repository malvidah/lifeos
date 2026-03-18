import { withAuth } from '../_lib/auth.js';
import { parseTaskBlocks, tasksToHtml } from '@/lib/parseBlocks.js';
import { isValidDate } from '@/lib/validate.js';
import { keyToRecurrence, matchesSchedule } from '@/lib/recurrence.js';

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

  // ── Task loading rules ──────────────────────────────────────────────────
  //
  // For date D, a task appears if ANY of these are true:
  //   A) It was created on D (ownTasks)
  //   B) It has a due_date, is not done, and due_date >= D and date <= D
  //      (persistent — shows every day from creation until due date or completion)
  //   C) It has a /r recurrence chip, the schedule matches D,
  //      and (no due_date OR due_date >= D)
  //      (recurring — virtual appearance, always unchecked on non-origin dates)
  //
  // A task NEVER appears if:
  //   - It's done AND it wasn't created on D (completed tasks only show on their own date)
  //   - It's a virtual recurring appearance and the task is already in ownTasks
  //
  // Virtual recurring appearances: the DB row is the ORIGINAL (created once).
  // The GET endpoint includes it in the response for matching dates. No copies,
  // no proxy rows — so no infinite copy loop. The data-recurring="true" attribute
  // tells POST to skip it when saving (it's display-only on non-origin dates).

  const cols = 'id, position, html, text, done, due_date, completed_at, project_tags, note_tags, date';

  // A) OWN tasks: written on this date (any status)
  const { data: ownTasks, error: e1 } = await supabase
    .from('tasks').select(cols)
    .eq('user_id', user.id).eq('date', date)
    .order('position', { ascending: true });
  if (e1) throw e1;
  const ownIds = new Set((ownTasks ?? []).map(t => t.id));

  // B) PERSISTENT tasks: have due_date, not done, created before today, not recurring
  //    Show from creation date through due_date (or indefinitely if no due_date? No —
  //    tasks with NO due_date and NO recurrence only show on their creation date).
  const { data: persistentTasks, error: e2 } = await supabase
    .from('tasks').select(cols)
    .eq('user_id', user.id)
    .not('due_date', 'is', null)
    .lte('date', date)       // created on or before this date
    .gte('due_date', date)   // due date is today or in the future
    .eq('done', false)
    .neq('date', date)       // not already in ownTasks
    .not('html', 'ilike', '%data-recurrence=%')
    .order('date', { ascending: true });
  if (e2) throw e2;

  // C) RECURRING tasks: have /r chip, schedule matches this day
  const { data: recurringCandidates } = await supabase
    .from('tasks').select(cols)
    .eq('user_id', user.id)
    .neq('date', date)
    .ilike('html', '%data-recurrence=%');

  const recurringTasks = (recurringCandidates ?? []).filter(t => {
    if (ownIds.has(t.id)) return false; // already in ownTasks
    const match = t.html?.match(/data-recurrence="([^"]+)"/);
    if (!match) return false;
    const recurrence = keyToRecurrence(match[1], t.date);
    if (!recurrence || !matchesSchedule(date, recurrence)) return false;
    // If task has a due_date, only show up to the due_date
    if (t.due_date && t.due_date < date) return false;
    return true;
  }).map(t => ({
    ...t,
    // Virtual appearance: always unchecked (each day is independent)
    done: false,
    completed_at: null,
    html: t.html?.replace(/data-checked="true"/, 'data-checked="false"') ?? t.html,
  }));

  // Dedup persistent against ownTasks
  const dedupedPersistent = (persistentTasks ?? []).filter(t => !ownIds.has(t.id));

  // Inject data attributes for client-side tracking
  const regularTasks = [...(ownTasks ?? []), ...dedupedPersistent];
  for (const t of regularTasks) {
    if (t.html) {
      let attrs = ` data-task-id="${t.id}" data-origin-date="${t.date}"`;
      if (t.completed_at) attrs += ` data-completed-date="${t.completed_at}"`;
      t.html = t.html.replace(/^<li\b/, `<li${attrs}`);
    }
  }
  // Mark recurring as display-only so POST skips them
  for (const t of recurringTasks) {
    if (t.html) {
      t.html = t.html.replace(/^<li\b/, `<li data-task-id="${t.id}" data-origin-date="${t.date}" data-recurring="true"`);
    }
  }

  return Response.json({
    data: tasksToHtml([...regularTasks, ...recurringTasks]),
    dueTasks: dedupedPersistent,
  });
});

export const POST = withAuth(async (req, { supabase, user }) => {
  const { date, data: html } = await req.json();
  if (!date || !isValidDate(date)) return Response.json({ error: 'valid date (YYYY-MM-DD) required' }, { status: 400 });

  const parsed = parseTaskBlocks(html || '');
  const today  = TODAY();

  // Fetch existing rows for this date so we can preserve due_dates
  const { data: existing } = await supabase
    .from('tasks')
    .select('id, position, text, due_date, completed_at, html')
    .eq('user_id', user.id)
    .eq('date', date)
    .order('position', { ascending: true });

  // Build a set of texts from tasks that were INJECTED by GET (persistent + recurring
  // from other dates). These appear in the editor but shouldn't create new rows.
  // We identify them by: tasks from other dates that match the current date's schedule
  // or have due_dates. Simplest: fetch what GET would have injected and match by text.
  const { data: injectedPersistent } = await supabase
    .from('tasks')
    .select('id, text')
    .eq('user_id', user.id)
    .not('due_date', 'is', null)
    .lte('date', date).gte('due_date', date)
    .eq('done', false).neq('date', date)
    .not('html', 'ilike', '%data-recurrence=%');

  const { data: injectedRecurring } = await supabase
    .from('tasks')
    .select('id, text')
    .eq('user_id', user.id)
    .neq('date', date)
    .ilike('html', '%data-recurrence=%');

  // Texts of tasks that were display-only (from other dates)
  const injectedTexts = new Set();
  const injectedIds = new Map(); // text → id for updates
  for (const t of [...(injectedPersistent ?? []), ...(injectedRecurring ?? [])]) {
    const key = t.text?.trim().toLowerCase();
    if (key) {
      injectedTexts.add(key);
      injectedIds.set(key, t.id);
    }
  }

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

  // Separate tasks into categories using text matching (data attrs get stripped by TipTap)
  const ownRows = [];           // regular tasks for this date → DELETE + INSERT
  const foreignUpdates = [];    // edits to persistent/recurring tasks → UPDATE original
  const foreignTextsSeen = new Set(); // track which injected tasks are still present

  for (const t of parsed) {
    const key = t.text?.trim().toLowerCase();

    // Check if this task matches an injected persistent/recurring task by text
    if (key && injectedTexts.has(key)) {
      foreignTextsSeen.add(key);
      // Update the original if text/done changed
      const origId = injectedIds.get(key);
      if (origId) {
        foreignUpdates.push({ id: origId, text: t.text, html: t.html, done: t.done, project_tags: t.project_tags });
      }
      continue; // Don't add to ownRows — this is a display echo
    }

    // Check explicit data attributes (may survive if TipTap preserves them)
    if (t.recurring && t.task_id) {
      foreignTextsSeen.add(key);
      foreignUpdates.push({ id: t.task_id, text: t.text, html: t.html, done: t.done, project_tags: t.project_tags });
      continue;
    }
    if (t.recurring) continue;
    if (t.origin_date && t.origin_date !== date) {
      foreignUpdates.push({ id: t.task_id, text: t.text, html: t.html, done: t.done, project_tags: t.project_tags });
      continue;
    }

    // Also catch recurring originals from THIS date by checking HTML
    if (t.html?.includes('data-recurrence=') || (key && injectedTexts.has(key))) {
      foreignTextsSeen.add(key);
      continue; // Don't re-create
    }

    ownRows.push(t);
  }

  // Update originals that were edited
  for (const u of foreignUpdates) {
    if (!u.id) continue;
    await supabase.from('tasks').update({
      text: u.text, html: u.html, done: u.done,
      project_tags: u.project_tags ?? [],
    }).eq('id', u.id).eq('user_id', user.id);
  }

  // Delete recurring originals from THIS date that the user removed from the editor
  const { data: existingRecurring } = await supabase
    .from('tasks').select('id, text')
    .eq('user_id', user.id).eq('date', date)
    .ilike('html', '%data-recurrence=%');

  for (const r of (existingRecurring ?? [])) {
    const key = r.text?.trim().toLowerCase();
    if (!key || !foreignTextsSeen.has(key)) {
      // This recurring task was removed from the editor → delete the original
      // But only if it's truly gone (not just renamed)
      const stillPresent = parsed.some(t => t.text?.trim().toLowerCase() === key);
      if (!stillPresent) {
        await supabase.from('tasks').delete().eq('id', r.id).eq('user_id', user.id);
      }
    }
  }

  // Delete injected persistent/recurring originals that the user removed
  for (const [key, id] of injectedIds) {
    if (!foreignTextsSeen.has(key)) {
      const stillPresent = parsed.some(t => t.text?.trim().toLowerCase() === key);
      if (!stillPresent) {
        await supabase.from('tasks').delete().eq('id', id).eq('user_id', user.id);
      }
    }
  }

  // Full-replace own-date NON-recurring tasks only
  const { error: delErr } = await supabase
    .from('tasks').delete()
    .eq('user_id', user.id).eq('date', date)
    .not('html', 'ilike', '%data-recurrence=%');
  if (delErr) throw delErr;

  // Save own-date tasks (regular tasks created on this date).
  if (ownRows.length > 0) {
    const rows = ownRows.map(t => {
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

  // Foreign updates (persistent/recurring edits) already handled above in the
  // foreignUpdates loop. No separate processing needed here.

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
