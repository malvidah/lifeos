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
      .is('deleted_at', null)
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
    .is('deleted_at', null)
    .order('position', { ascending: true });
  if (e1) throw e1;
  const ownIds = new Set((ownTasks ?? []).map(t => t.id));

  // B) PERSISTENT tasks: have due_date, not done, created on or before this date.
  //    Show every day from creation until completed or deleted — even past due_date.
  const { data: persistentTasks, error: e2 } = await supabase
    .from('tasks').select(cols)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .not('due_date', 'is', null)
    .lte('date', date)       // created on or before this date
    .eq('done', false)
    .neq('date', date)       // not already in ownTasks
    .not('html', 'ilike', '%data-recurrence=%')
    .order('date', { ascending: true });
  if (e2) throw e2;

  // C) RECURRING tasks: have /r chip, schedule matches this day
  const { data: recurringCandidates } = await supabase
    .from('tasks').select(cols)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .neq('date', date)
    .ilike('html', '%data-recurrence=%');

  // Dedup persistent against ownTasks
  const dedupedPersistent = (persistentTasks ?? []).filter(t => !ownIds.has(t.id));
  const persistentIds = new Set(dedupedPersistent.map(t => t.id));

  // Build a set of normalized texts already covered by own/persistent tasks,
  // so a recurring template is suppressed when there's already a completion row for today.
  const ownTexts = new Set(
    [...(ownTasks ?? []), ...dedupedPersistent]
      .map(t => t.text?.trim().toLowerCase())
      .filter(Boolean)
  );

  const recurringTasks = (recurringCandidates ?? []).filter(t => {
    if (ownIds.has(t.id)) return false; // already in ownTasks
    if (persistentIds.has(t.id)) return false; // already in dedupedPersistent
    // Suppress if there's already a completion row for this date with the same text
    // (i.e., the user checked it off — a copy was created in ownTasks).
    // The completion row has the recurrence chip stripped, so compare clean text.
    const cleanTemplateText = (t.text ?? '').replace(/\/r\s+\S+/gi, '').trim().toLowerCase();
    if (cleanTemplateText && ownTexts.has(cleanTemplateText)) return false;
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

  // Assign recurring tasks positions after all own tasks to avoid position collisions.
  // Both sets start at position 0; without adjustment recurring tasks sort to the top.
  const maxPosition = regularTasks.reduce((max, t) => Math.max(max, t.position ?? 0), -1);
  const adjustedRecurring = recurringTasks.map((t, i) => ({ ...t, position: maxPosition + 1 + i }));

  return Response.json({
    data: tasksToHtml([...regularTasks, ...adjustedRecurring]),
    dueTasks: dedupedPersistent,
  });
});

export const POST = withAuth(async (req, { supabase, user }) => {
  const { date, data: html } = await req.json();
  if (!date || !isValidDate(date)) return Response.json({ error: 'valid date (YYYY-MM-DD) required' }, { status: 400 });

  const parsed = parseTaskBlocks(html || '');
  const today  = TODAY();

  // Guard: if the HTML is empty/blank, don't wipe existing tasks.
  // This prevents stale localStorage cache or offline glitches from deleting real data.
  if (!html || !html.trim() || html.trim() === '<ul data-type="taskList"></ul>') {
    // Check if there are existing tasks — if so, refuse the empty write
    const { data: check } = await supabase.from('tasks').select('id').eq('user_id', user.id).eq('date', date).is('deleted_at', null).limit(1);
    if (check?.length) {
      return Response.json({ ok: true, tasks: 0, skipped: 'empty write blocked' });
    }
  }

  // Fetch existing rows for this date so we can preserve due_dates
  const { data: existing } = await supabase
    .from('tasks')
    .select('id, position, text, due_date, completed_at, html')
    .eq('user_id', user.id)
    .eq('date', date)
    .is('deleted_at', null)
    .order('position', { ascending: true });

  // Build a set of texts from tasks that were INJECTED by GET (persistent + recurring
  // from other dates). These appear in the editor but shouldn't create new rows.
  // We identify them by: tasks from other dates that match the current date's schedule
  // or have due_dates. Simplest: fetch what GET would have injected and match by text.
  const { data: injectedPersistent } = await supabase
    .from('tasks')
    .select('id, text')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .not('due_date', 'is', null)
    .lte('date', date)
    .eq('done', false).neq('date', date)
    .not('html', 'ilike', '%data-recurrence=%');

  // Fetch recurring candidates from other dates, then filter to only those that
  // actually match this day's schedule. Without this filter, the foreign-deletion
  // loop (below) would delete the original whenever the task isn't shown on this
  // day — i.e., every autosave on a non-recurrence day destroys the original.
  const { data: recurringCandidatesPost } = await supabase
    .from('tasks')
    .select('id, text, html, date')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .neq('date', date)
    .ilike('html', '%data-recurrence=%');

  const injectedRecurring = (recurringCandidatesPost ?? []).filter(t => {
    const match = t.html?.match(/data-recurrence="([^"]+)"/);
    if (!match) return false;
    const rec = keyToRecurrence(match[1], t.date);
    return rec && matchesSchedule(date, rec);
  });

  // Texts of tasks that were display-only (from other dates)
  const injectedTexts = new Set();
  const injectedIds = new Map(); // text → id for updates
  const injectedRecurringIds = new Set(); // ids that are recurring templates (not persistent)
  for (const t of (injectedPersistent ?? [])) {
    const key = t.text?.trim().toLowerCase();
    if (key) {
      injectedTexts.add(key);
      injectedIds.set(key, t.id);
    }
  }
  for (const t of (injectedRecurring ?? [])) {
    const key = t.text?.trim().toLowerCase();
    if (key) {
      injectedTexts.add(key);
      injectedIds.set(key, t.id);
      injectedRecurringIds.add(t.id);
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
  const foreignUpdates = [];    // edits to persistent tasks → UPDATE original
  const foreignTextsSeen = new Set(); // track which injected tasks are still present

  for (const t of parsed) {
    const key = t.text?.trim().toLowerCase();

    // Check if this task matches an injected persistent/recurring task by text
    if (key && injectedTexts.has(key)) {
      foreignTextsSeen.add(key);
      const origId = injectedIds.get(key);
      if (origId) {
        if (injectedRecurringIds.has(origId)) {
          // Recurring template: never modify the original.
          // If checked off, create a completion row for this specific date instead.
          // If unchecked, nothing to persist (GET will show it unchecked anyway).
          if (t.done) {
            // Strip the recurrence chip from the completion copy's html so it
            // doesn't generate new virtual instances from this date.
            const completionHtml = t.html
              ?.replace(/<span\b[^>]*\bdata-recurrence="[^"]*"[^>]*>[^<]*<\/span>/g, '')
              ?? t.html;
            const completionText = t.text
              ?.replace(/\/r\s+\S+/g, '')
              .trim() ?? t.text;
            ownRows.push({
              ...t,
              html: completionHtml,
              text: completionText || t.text,
              done: true,
            });
          }
        } else {
          // Persistent (due_date) task: update the original row
          foreignUpdates.push({ id: origId, text: t.text, html: t.html, done: t.done, project_tags: t.project_tags });
        }
      }
      continue; // Don't fall through to ownRows for foreign tasks
    }

    // Check explicit data attributes (may survive if TipTap preserves them)
    if (t.recurring && t.task_id) {
      foreignTextsSeen.add(key);
      if (injectedRecurringIds.has(t.task_id)) {
        // Recurring template: create completion row if checked, skip if unchecked
        if (t.done) {
          const completionHtml = t.html
            ?.replace(/<span\b[^>]*\bdata-recurrence="[^"]*"[^>]*>[^<]*<\/span>/g, '')
            ?? t.html;
          const completionText = t.text?.replace(/\/r\s+\S+/g, '').trim() ?? t.text;
          ownRows.push({ ...t, html: completionHtml, text: completionText || t.text, done: true });
        }
      } else {
        foreignUpdates.push({ id: t.task_id, text: t.text, html: t.html, done: t.done, project_tags: t.project_tags });
      }
      continue;
    }
    if (t.recurring && t.origin_date && t.origin_date !== date) continue;
    if (t.origin_date && t.origin_date !== date) {
      foreignUpdates.push({ id: t.task_id, text: t.text, html: t.html, done: t.done, project_tags: t.project_tags });
      continue;
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

  // Delete injected persistent/recurring originals from OTHER dates
  // that the user removed from the editor (proxy deletion = original deletion)
  for (const [key, id] of injectedIds) {
    if (!foreignTextsSeen.has(key)) {
      const stillPresent = parsed.some(t => t.text?.trim().toLowerCase() === key);
      if (!stillPresent) {
        await supabase.from('tasks').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id);
      }
    }
  }

  // Full-replace ALL own-date tasks: soft-delete existing rows, then insert fresh ones.
  // Old soft-deleted rows remain in the DB but are excluded from all queries.
  const { error: delErr } = await supabase
    .from('tasks').update({ deleted_at: new Date().toISOString() })
    .eq('user_id', user.id).eq('date', date).is('deleted_at', null);
  if (delErr) throw delErr;

  // Save own-date tasks (regular tasks created on this date).
  if (ownRows.length > 0) {
    const rows = ownRows.map(t => {
      const prev = matchExisting(t.text);
      // Preserve recurrence chip if the previous version had one but the new doesn't
      // (protects against editor accidentally stripping the recurrence span)
      let html = t.html;
      let text = t.text;
      if (prev?.html?.includes('data-recurrence=') && !html?.includes('data-recurrence=')) {
        const recMatch = prev.html.match(/<span\b[^>]*\bdata-recurrence="[^"]*"[^>]*>[^<]*<\/span>/);
        if (recMatch) {
          html = html.replace(/<\/li>$/, recMatch[0] + '</li>');
          const recTextMatch = prev.text?.match(/\/r\s+\S+/);
          if (recTextMatch) text = text + ' ' + recTextMatch[0];
        }
      }
      return {
        user_id:      user.id,
        date,
        position:     t.position,
        html,
        text,
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
    .from('tasks').update({ deleted_at: new Date().toISOString() })
    .eq('id', id).eq('user_id', user.id);
  if (error) throw error;

  return Response.json({ ok: true });
});
