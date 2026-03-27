import { withAuth } from '../_lib/auth.js';
import { tasksToHtml } from '@/lib/parseBlocks.js';
import { isValidDate } from '@/lib/validate.js';
import { keyToRecurrence, matchesSchedule } from '@/lib/recurrence.js';
import { cleanTaskText } from '@/lib/cleanTaskText.js';

// Local-date helper: prefer the client-supplied date; fall back to UTC only as
// a last resort. Using toISOString() gives UTC which is wrong after ~4pm PT.
function localToday(clientDate) {
  return clientDate || new Date().toISOString().slice(0, 10);
}

// GET /api/tasks?date=YYYY-MM-DD
//   → { data: '<ul data-type="taskList">...</ul>' }
//   Returns tasks written that day PLUS open tasks due that day (from other dates).
//
// GET /api/tasks?project=big+think
//   → { tasks: [{id, date, text, done, due_date, project_tags}] }
//
// POST /api/tasks  { date, text, done?, html?, due_date?, project_tags?, position? }
//   Create a single task row.
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

  // Suppress same-date habit/recurrence templates when a completion row exists.
  // A template has data-habit or data-recurrence but NOT data-completion="true".
  // A completion is either marked with data-completion="true" or is a done row
  // without habit/recurrence chips (legacy completion rows had chips stripped).
  const isCompletionRow = (t) => t.html?.includes('data-completion="true"');
  const isTemplateRow = (t) =>
    !isCompletionRow(t) && t.html &&
    (t.html.includes('data-habit=') || t.html.includes('data-recurrence='));
  // Build set of cleaned texts from all done non-template rows (completions)
  const completionTexts = new Set(
    (ownTasks ?? []).filter(t => t.done && !isTemplateRow(t)).map(t => cleanTaskText(t.text)).filter(Boolean)
  );
  const filteredOwnTasks = (ownTasks ?? []).filter(t => {
    if (!isTemplateRow(t)) return true;
    // Suppress template if any done non-template row with matching text exists
    const cleaned = cleanTaskText(t.text);
    return !(cleaned && completionTexts.has(cleaned));
  });

  const ownIds = new Set(filteredOwnTasks.map(t => t.id));

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
    .not('html', 'ilike', '%data-habit=%')
    .order('date', { ascending: true });
  if (e2) throw e2;

  // C) RECURRING tasks: have /r or /h chip, schedule matches this day.
  //    Exclude completion rows (they also have data-habit in HTML but are not templates).
  const { data: recurringCandidates } = await supabase
    .from('tasks').select(cols)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .neq('date', date)
    .not('html', 'ilike', '%data-completion="true"%')
    .or('html.ilike.%data-recurrence=%,html.ilike.%data-habit=%');

  // Dedup persistent against ownTasks
  const dedupedPersistent = (persistentTasks ?? []).filter(t => !ownIds.has(t.id));
  const persistentIds = new Set(dedupedPersistent.map(t => t.id));

  // Build a set of normalized texts already covered by own/persistent tasks,
  // so a recurring template is suppressed when there's already a completion row for today.
  const ownTexts = new Set(
    [...filteredOwnTasks, ...dedupedPersistent]
      .map(t => cleanTaskText(t.text))
      .filter(Boolean)
  );

  const recurringTasks = (recurringCandidates ?? []).filter(t => {
    if (ownIds.has(t.id)) return false; // already in ownTasks
    if (persistentIds.has(t.id)) return false; // already in dedupedPersistent
    // Suppress if there's already a completion row for this date with the same text
    const cleanTemplateText = cleanTaskText(t.text);
    if (cleanTemplateText && ownTexts.has(cleanTemplateText)) return false;
    // Match either data-recurrence or data-habit attribute for schedule
    const recMatch = t.html?.match(/data-recurrence="([^"]+)"/);
    const habMatch = t.html?.match(/data-habit="([^"]+)"/);
    const scheduleKey = recMatch?.[1] || habMatch?.[1];
    if (!scheduleKey) return false;
    const recurrence = keyToRecurrence(scheduleKey, t.date);
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
  const regularTasks = [...filteredOwnTasks, ...dedupedPersistent];
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

  // Build structured task list with source metadata
  const structuredTasks = [
    ...filteredOwnTasks.map(t => ({ ...t, _source: 'own', _editable: true })),
    ...dedupedPersistent.map(t => ({ ...t, _source: 'persistent', _editable: true })),
    ...adjustedRecurring.map(t => ({ ...t, _source: 'recurring', _editable: false })),
  ];

  return Response.json({
    data: tasksToHtml([...regularTasks, ...adjustedRecurring]),
    tasks: structuredTasks,
    dueTasks: dedupedPersistent,
  });
});

export const POST = withAuth(async (req, { supabase, user }) => {
  const body = await req.json();
  const { date, data: html } = body;
  if (!date || !isValidDate(date)) return Response.json({ error: 'valid date (YYYY-MM-DD) required' }, { status: 400 });

  // ── Single-task creation mode (new row-level CRUD) ─────────────────────
  // Triggered when 'text' is present and 'data' is absent
  if (body.text !== undefined && html === undefined) {
    const { text, done, due_date, project_tags, note_tags, position, html: taskHtml } = body;

    // Generate proper HTML with data attributes from text tokens
    function textToTaskHtml(rawText) {
      let inner = (rawText || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
      // Convert {r:key:label} → recurrence span
      inner = inner.replace(/\{r:([^:}]+):([^}]*)\}/g, '<span data-recurrence="$1" data-recurrence-label="$2">↻ $2</span>');
      // Convert {h:key:label} → habit span
      inner = inner.replace(/\{h:([^:}]+):([^}]*)\}/g, '<span data-habit="$1" data-habit-label="$2">🎯 $2</span>');
      // Convert {l:name} → place span
      inner = inner.replace(/\{l:([^}]+)\}/g, '<span data-place-tag="$1">📍 $1</span>');
      // Convert {project} → project span
      inner = inner.replace(/\{([a-z0-9][a-z0-9 ]*[a-z0-9]|[a-z0-9])\}/gi, '<span data-project-tag="$1">⛰️ $1</span>');
      // Convert @YYYY-MM-DD → date span
      inner = inner.replace(/@(\d{4}-\d{2}-\d{2})/g, '<span data-date-tag="$1">⏳ $1</span>');
      // Convert [note] → note span
      inner = inner.replace(/\[([^\]]+)\]/g, '<span data-note-link="$1">$1</span>');
      return `<li data-type="taskItem" data-checked="${done ? 'true' : 'false'}"><label><input type="checkbox"${done ? ' checked="checked"' : ''}><span></span></label><div><p>${inner}</p></div></li>`;
    }

    // Parse due_date from text if not provided
    const parsedDueDate = due_date || (() => {
      const m = (text || '').match(/@(\d{4}-\d{2}-\d{2})/);
      return m ? m[1] : null;
    })();

    // Parse project tags from text if not provided
    const parsedTags = (project_tags && project_tags.length) ? project_tags : (() => {
      const tags = [];
      const re = /\{([a-z0-9][a-z0-9 ]*[a-z0-9]|[a-z0-9])\}/gi;
      let m;
      while ((m = re.exec(text || '')) !== null) {
        if (!m[0].startsWith('{r:') && !m[0].startsWith('{l:') && !m[0].startsWith('{h:')) {
          tags.push(m[1].toLowerCase());
        }
      }
      return tags;
    })();

    const { data: row, error } = await supabase.from('tasks').insert({
      user_id: user.id,
      date,
      text: text || '',
      html: taskHtml || textToTaskHtml(text),
      done: !!done,
      due_date: parsedDueDate,
      completed_at: done ? date : null,
      project_tags: parsedTags,
      note_tags: note_tags || [],
      position: position ?? 0,
    }).select().single();
    if (error) throw error;
    return Response.json({ task: row });
  }

  // Legacy full-replace path removed — all task saves now use row-level CRUD
  // (single-task creation above + PATCH/DELETE endpoints below).
  return Response.json({ error: 'text field required for single-task creation' }, { status: 400 });
});

export const PATCH = withAuth(async (req, { supabase, user }) => {
  const { id, ...updates } = await req.json();
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  // Guard: don't allow marking a recurring/habit template as done via PATCH.
  // The diff save layer can accidentally PATCH the template when a virtual
  // recurring checkbox is toggled. Templates should never be marked done —
  // completions go through /api/tasks/complete-recurring instead.
  let taskDate = null;
  if (updates.done === true) {
    const { data: existing } = await supabase
      .from('tasks').select('html, date').eq('id', id).eq('user_id', user.id).single();
    const hasChips = existing?.html && (existing.html.includes('data-recurrence=') || existing.html.includes('data-habit='));
    const isCompletion = existing?.html?.includes('data-completion="true"');
    if (hasChips && !isCompletion) {
      // Silently ignore — the template must stay undone
      return Response.json({ ok: true, guarded: 'recurring_template' });
    }
    taskDate = existing?.date;
  }

  // Whitelist updatable fields
  const allowed = ['done', 'completed_at', 'due_date', 'text', 'html', 'project_tags', 'position'];
  const patch = Object.fromEntries(
    Object.entries(updates).filter(([k]) => allowed.includes(k))
  );

  // Auto-set completed_at when toggling done — use the task's own date to
  // avoid UTC/local timezone mismatch from new Date().toISOString()
  if ('done' in patch && !('completed_at' in patch)) {
    if (!taskDate) {
      const { data: row } = await supabase
        .from('tasks').select('date').eq('id', id).eq('user_id', user.id).single();
      taskDate = row?.date;
    }
    patch.completed_at = patch.done ? localToday(taskDate) : null;
  }

  // When text changes, re-parse structured fields from tokens
  if ('text' in patch) {
    const text = patch.text || '';
    // Re-extract due_date from @YYYY-MM-DD tokens
    const dateMatch = text.match(/@(\d{4}-\d{2}-\d{2})/);
    if (dateMatch && !('due_date' in patch)) {
      patch.due_date = dateMatch[1];
    }
    // Re-extract project_tags from {project} tokens
    if (!('project_tags' in patch)) {
      const tags = [];
      const re = /\{([a-z0-9][a-z0-9 ]*[a-z0-9]|[a-z0-9])\}/gi;
      let m;
      while ((m = re.exec(text)) !== null) {
        if (!m[0].startsWith('{r:') && !m[0].startsWith('{l:') && !m[0].startsWith('{h:')) {
          tags.push(m[1].toLowerCase());
        }
      }
      if (tags.length) patch.project_tags = tags;
    }
    // Regenerate HTML from text tokens
    if (!('html' in patch)) {
      let inner = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      inner = inner.replace(/\{r:([^:}]+):([^}]*)\}/g, '<span data-recurrence="$1" data-recurrence-label="$2">↻ $2</span>');
      inner = inner.replace(/\{h:([^:}]+):([^}]*)\}/g, '<span data-habit="$1" data-habit-label="$2">🎯 $2</span>');
      inner = inner.replace(/\{l:([^}]+)\}/g, '<span data-place-tag="$1">📍 $1</span>');
      inner = inner.replace(/\{([a-z0-9][a-z0-9 ]*[a-z0-9]|[a-z0-9])\}/gi, '<span data-project-tag="$1">⛰️ $1</span>');
      inner = inner.replace(/@(\d{4}-\d{2}-\d{2})/g, '<span data-date-tag="$1">⏳ $1</span>');
      inner = inner.replace(/\[([^\]]+)\]/g, '<span data-note-link="$1">$1</span>');
      const isDone = 'done' in patch ? patch.done : false;
      patch.html = `<li data-type="taskItem" data-checked="${isDone ? 'true' : 'false'}"><label><input type="checkbox"${isDone ? ' checked="checked"' : ''}><span></span></label><div><p>${inner}</p></div></li>`;
    }
  }

  const { error } = await supabase
    .from('tasks').update(patch)
    .eq('id', id).eq('user_id', user.id);
  if (error) throw error;

  return Response.json({ ok: true });
});

export const DELETE = withAuth(async (req, { supabase, user }) => {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const isRecurring = url.searchParams.get('recurring') === '1';
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const now = new Date().toISOString();

  // Soft-delete the target task
  const { error } = await supabase
    .from('tasks').update({ deleted_at: now })
    .eq('id', id).eq('user_id', user.id);
  if (error) throw error;

  // For recurring/habit templates: also delete all completion rows and duplicate
  // templates with the same cleaned text. This ensures "delete everywhere" behavior.
  if (isRecurring) {
    // Fetch the task we just deleted to get its text for matching
    const { data: deleted } = await supabase
      .from('tasks').select('text, html')
      .eq('id', id).eq('user_id', user.id).single();

    if (deleted?.text) {
      const cleanedText = cleanTaskText(deleted.text);
      if (cleanedText) {
        // Find all non-deleted tasks by this user, then filter by cleaned text match
        const { data: allTasks } = await supabase
          .from('tasks').select('id, text, html')
          .eq('user_id', user.id)
          .is('deleted_at', null);

        const toDelete = (allTasks ?? []).filter(t => {
          if (t.id === id) return false; // already deleted
          return cleanTaskText(t.text) === cleanedText;
        });

        if (toDelete.length > 0) {
          const ids = toDelete.map(t => t.id);
          await supabase
            .from('tasks').update({ deleted_at: now })
            .eq('user_id', user.id)
            .in('id', ids);
        }
      }
    }
  }

  return Response.json({ ok: true });
});
