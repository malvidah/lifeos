import { withAuth } from '../_lib/auth.js';
import { tasksToHtml } from '@/lib/parseBlocks.js';
import { isValidDate, isValidUuid, MAX_TASK_TEXT } from '@/lib/validate.js';
import { keyToRecurrence, matchesSchedule } from '@/lib/recurrence.js';
import { cleanTaskText } from '@/lib/cleanTaskText.js';
import { textToTaskHtml, parseProjectTags, parseDueDate } from '@/lib/textToTaskHtml.js';

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

  const cols = 'id, position, html, text, done, due_date, completed_at, project_tags, note_tags, date';

  // A) OWN tasks: written on this date (any status)
  const { data: ownTasks, error: e1 } = await supabase
    .from('tasks').select(cols)
    .eq('user_id', user.id).eq('date', date)
    .is('deleted_at', null)
    .order('position', { ascending: true });
  if (e1) throw e1;

  // Completions are now in habit_completions table, not task rows.
  // No template suppression needed. But we need to reflect completion state
  // on own-date habit templates (applied below after fetching completions).
  const filteredOwnTasks = ownTasks ?? [];
  const ownIds = new Set(filteredOwnTasks.map(t => t.id));

  // B) PERSISTENT tasks: have due_date, not done, created on or before this date.
  const { data: persistentTasks, error: e2 } = await supabase
    .from('tasks').select(cols)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .not('due_date', 'is', null)
    .lte('date', date)
    .eq('done', false)
    .neq('date', date)
    .not('html', 'ilike', '%data-recurrence=%')
    .not('html', 'ilike', '%data-habit=%')
    .order('date', { ascending: true });
  if (e2) throw e2;

  // C) RECURRING tasks: have /r or /h chip, schedule matches this day.
  const { data: recurringCandidates } = await supabase
    .from('tasks').select(cols)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .neq('date', date)
    .or('html.ilike.%data-recurrence=%,html.ilike.%data-habit=%');

  // Fetch habit completions for this date to reflect done state on recurring tasks
  const { data: dateCompletions } = await supabase
    .from('habit_completions')
    .select('habit_id')
    .eq('user_id', user.id)
    .eq('date', date);
  const completedHabitIds = new Set((dateCompletions ?? []).map(c => c.habit_id));

  // Reflect completion state on own-date habit templates
  for (const t of filteredOwnTasks) {
    if (!t.html || !completedHabitIds.has(t.id)) continue;
    if (!t.html.includes('data-habit=') && !t.html.includes('data-recurrence=')) continue;
    t.done = true;
    t.completed_at = date;
    t.html = t.html.replace(/data-checked="(true|false)"/, 'data-checked="true"');
  }

  // Dedup persistent against ownTasks
  const dedupedPersistent = (persistentTasks ?? []).filter(t => !ownIds.has(t.id));
  const persistentIds = new Set(dedupedPersistent.map(t => t.id));

  // Build a set of normalized texts already covered by own/persistent tasks
  const ownTexts = new Set(
    [...filteredOwnTasks, ...dedupedPersistent]
      .map(t => cleanTaskText(t.text))
      .filter(Boolean)
  );

  // For count-limited recurring tasks, fetch total completions to suppress once done.
  // All /r tasks default to limit=1 (with or without an explicit data-recurrence-count
  // attribute), so we need counts for every recurring task that has data-recurrence=,
  // not just those with an explicit count attribute.
  const repeatedIds = (recurringCandidates ?? [])
    .filter(t => t.html?.includes('data-recurrence='))
    .map(t => t.id);
  let completionCounts = {};
  if (repeatedIds.length > 0) {
    const { data: cRows } = await supabase
      .from('habit_completions')
      .select('habit_id')
      .eq('user_id', user.id)
      .in('habit_id', repeatedIds);
    for (const c of cRows ?? []) {
      completionCounts[c.habit_id] = (completionCounts[c.habit_id] || 0) + 1;
    }
  }

  const recurringTasks = (recurringCandidates ?? []).filter(t => {
    if (ownIds.has(t.id)) return false;
    if (persistentIds.has(t.id)) return false;
    // Never project a recurring task onto dates before it was created
    if (date < t.date) return false;
    const cleanTemplateText = cleanTaskText(t.text);
    if (cleanTemplateText && ownTexts.has(cleanTemplateText)) return false;
    const recMatch = t.html?.match(/data-recurrence="([^"]+)"/);
    const habMatch = t.html?.match(/data-habit="([^"]+)"/);
    const scheduleKey = recMatch?.[1] || habMatch?.[1];
    if (!scheduleKey) return false;
    const recurrence = keyToRecurrence(scheduleKey, t.date);
    if (!recurrence || !matchesSchedule(date, recurrence)) return false;
    // Until-date from {r:key:label:YYYY-MM-DD} token — suppress on/after that date
    const untilAttr = t.html?.match(/data-recurrence-until="([^"]+)"/);
    if (untilAttr && untilAttr[1] < date) return false;
    // Count-limited: suppress once all N completions done. /r tasks default to
    // limit=1 even without an explicit data-recurrence-count attribute.
    if (recMatch) {
      const countAttr = t.html?.match(/data-recurrence-count="(\d+)"/);
      const limit = countAttr ? parseInt(countAttr[1], 10) : 1;
      if ((completionCounts[t.id] || 0) >= limit) return false;
    }
    // Legacy due_date expiry (only when different from creation date and no until-attr)
    if (!untilAttr && t.due_date && t.due_date !== t.date && t.due_date < date) return false;
    return true;
  }).map(t => {
    const isDone = completedHabitIds.has(t.id);
    return {
      ...t,
      done: isDone,
      completed_at: isDone ? date : null,
      html: t.html?.replace(/data-checked="(true|false)"/, `data-checked="${isDone}"`) ?? t.html,
    };
  });

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
  if (body.text !== undefined && html === undefined) {
    const { text, done, due_date, project_tags, note_tags, position, html: taskHtml } = body;

    // Guard: reject oversized text
    if (typeof text === 'string' && text.length > MAX_TASK_TEXT) {
      return Response.json({ error: `text exceeds ${MAX_TASK_TEXT} characters` }, { status: 400 });
    }

    // Parse due_date from text if not provided
    const parsedDueDate = due_date || parseDueDate(text);

    // Parse project tags from text if not provided
    const parsedTags = (project_tags && project_tags.length) ? project_tags : parseProjectTags(text);

    // Dedup guard: skip insert if a task with the same cleaned text already exists on this date
    const newClean = cleanTaskText(text);
    if (newClean) {
      const { data: existing } = await supabase.from('tasks')
        .select('id, text').eq('user_id', user.id).eq('date', date).is('deleted_at', null);
      const dup = (existing ?? []).find(r => cleanTaskText(r.text) === newClean);
      if (dup) {
        return Response.json({ task: dup, skipped: 'duplicate' });
      }
    }

    const { data: row, error } = await supabase.from('tasks').insert({
      user_id: user.id,
      date,
      text: text || '',
      html: taskHtml || textToTaskHtml(text, !!done),
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
  return Response.json({ error: 'text field required for single-task creation' }, { status: 400 });
});

export const PATCH = withAuth(async (req, { supabase, user }) => {
  const { id, ...updates } = await req.json();
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });
  if (!isValidUuid(id)) return Response.json({ error: 'invalid id' }, { status: 400 });

  // Guard: reject oversized text
  if (typeof updates.text === 'string' && updates.text.length > MAX_TASK_TEXT) {
    return Response.json({ error: `text exceeds ${MAX_TASK_TEXT} characters` }, { status: 400 });
  }

  // Guard: don't allow marking a recurring/habit template as done via PATCH.
  let taskDate = null;
  if (updates.done === true) {
    const { data: existing } = await supabase
      .from('tasks').select('html, date').eq('id', id).eq('user_id', user.id).single();
    const hasChips = existing?.html && (existing.html.includes('data-recurrence=') || existing.html.includes('data-habit='));
    const isCompletion = existing?.html?.includes('data-completion="true"');
    if (hasChips && !isCompletion) {
      return Response.json({ ok: true, guarded: 'recurring_template' });
    }
    taskDate = existing?.date;
  }

  // Whitelist updatable fields
  const allowed = ['done', 'completed_at', 'due_date', 'text', 'html', 'project_tags', 'position'];
  const patch = Object.fromEntries(
    Object.entries(updates).filter(([k]) => allowed.includes(k))
  );

  // Auto-set completed_at when toggling done
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
    // Keep due_date in sync with date tokens in text.
    // Reads @YYYY-MM-DD or an until-date embedded in {r:key:label:YYYY-MM-DD}.
    // If removed we clear the field so stale due_dates don't cause silent expiry.
    if (!('due_date' in patch)) {
      const m1 = text.match(/@(\d{4}-\d{2}-\d{2})/);
      const m2 = text.match(/\{[hr]:[^:]+:[^:]+:(\d{4}-\d{2}-\d{2})\}/);
      patch.due_date = (m1 || m2)?.[1] ?? null;
    }
    if (!('project_tags' in patch)) {
      const tags = [];
      const re = /\{([a-z0-9][a-z0-9 ]*[a-z0-9]|[a-z0-9])\}/gi;
      let m;
      while ((m = re.exec(text)) !== null) {
        if (!m[0].startsWith('{r:') && !m[0].startsWith('{l:') && !m[0].startsWith('{h:') && !m[0].startsWith('{g:')) {
          tags.push(m[1].toLowerCase());
        }
      }
      if (tags.length) patch.project_tags = tags;
    }
    if (!('html' in patch)) {
      const isDone = 'done' in patch ? patch.done : false;
      patch.html = textToTaskHtml(text, isDone);
    }
  }

  const { error } = await supabase
    .from('tasks').update(patch)
    .eq('id', id).eq('user_id', user.id);
  if (error) throw error;

  // No rename cascade needed — completions reference habits by ID (habit_completions table)
  return Response.json({ ok: true });
});

export const DELETE = withAuth(async (req, { supabase, user }) => {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const isRecurring = url.searchParams.get('recurring') === '1';
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });
  if (!isValidUuid(id)) return Response.json({ error: 'invalid id' }, { status: 400 });

  const now = new Date().toISOString();

  // Soft-delete the target task
  const { error } = await supabase
    .from('tasks').update({ deleted_at: now })
    .eq('id', id).eq('user_id', user.id);
  if (error) throw error;

  // For recurring/habit templates: delete completions and duplicate templates.
  if (isRecurring) {
    // Delete all habit_completions referencing this template
    await supabase
      .from('habit_completions').delete()
      .eq('user_id', user.id)
      .eq('habit_id', id);

    // Also soft-delete duplicate templates with the same cleaned text
    const { data: deleted } = await supabase
      .from('tasks').select('text')
      .eq('id', id).eq('user_id', user.id).single();

    if (deleted?.text) {
      const cleanedText = cleanTaskText(deleted.text);
      if (cleanedText) {
        const { data: allTasks } = await supabase
          .from('tasks').select('id, text')
          .eq('user_id', user.id)
          .is('deleted_at', null);

        const toDelete = (allTasks ?? []).filter(t =>
          t.id !== id && cleanTaskText(t.text) === cleanedText
        );

        if (toDelete.length > 0) {
          const ids = toDelete.map(t => t.id);
          await supabase
            .from('tasks').update({ deleted_at: now })
            .eq('user_id', user.id)
            .in('id', ids);
          // Delete completions for duplicate templates too
          await supabase
            .from('habit_completions').delete()
            .eq('user_id', user.id)
            .in('habit_id', ids);
        }
      }
    }
  }

  return Response.json({ ok: true });
});
