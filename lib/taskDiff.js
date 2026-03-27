// ─── Task Diff Layer ─────────────────────────────────────────────────────────
// Compares two arrays of task objects and returns targeted mutations.
// Used by the single TipTap TaskList editor to avoid full-replace saves.
//
// Habit and recurring tasks are excluded from UPDATE and DELETE diffs to avoid
// duplicate/race issues. They have their own CRUD paths (complete-recurring,
// HabitsCard toggle). New habit tasks ARE created via POST so they appear in
// the database when first typed.

import { api } from "@/lib/api";
import { cleanTaskText } from "@/lib/cleanTaskText";

// Primary text normalization — preserves tokens for accurate matching
function norm(text) {
  return (text || '').trim().toLowerCase();
}

// Check if a task is a habit or recurring template/completion
export function isHabitOrRecurring(task) {
  const text = task.text || '';
  const html = task.html || '';
  if (/\{h:[^}]+\}/.test(text) || /\/h\s+\S+/i.test(text)) return true;
  if (/\{r:[^}]+\}/.test(text) || /\/r\s+\S+/i.test(text)) return true;
  if (html.includes('data-habit=') || html.includes('data-recurrence=')) return true;
  if (html.includes('data-completion="true"')) return true;
  if (task._source === 'recurring') return true;
  return false;
}

/**
 * Compute the diff between last-known server tasks and current editor tasks.
 * @param {Array} serverTasks - The last-known task objects from the server (with IDs)
 * @param {Array} editorTasks - The current task objects parsed from the editor HTML
 * @returns {{ toCreate: Array, toUpdate: Array, toDelete: Array }}
 */
export function diffTasks(serverTasks, editorTasks) {
  const toCreate = [];
  const toUpdate = [];
  const toDelete = [];

  // Filter out habit/recurring tasks from server side only.
  // This means:
  // - New editor habits (no server match) → toCreate → POST'd
  // - Existing editor habits (matched) → matched but changes ignored (done
  //   toggles handled separately in handleUpdate before the diff)
  // - Server habits not in editor → NOT deleted (filtered out of server side)
  const regularServer = serverTasks.filter(t => !isHabitOrRecurring(t));

  // Index server tasks by ID, exact text, and cleaned text
  const serverById = new Map();
  const serverByText = new Map();
  const serverByClean = new Map();
  for (const t of regularServer) {
    if (t.id) serverById.set(t.id, t);
    const n = norm(t.text);
    if (n && !serverByText.has(n)) serverByText.set(n, t);
    const c = cleanTaskText(t.text);
    if (c && !serverByClean.has(c)) serverByClean.set(c, t);
  }

  // Track which server tasks were matched
  const matched = new Set();

  for (const editorTask of editorTasks) {
    // 1. Match by task_id (most reliable — injected by GET as data-task-id)
    let serverMatch = editorTask.task_id ? serverById.get(editorTask.task_id) : null;

    // 2. Fallback: exact normalized text
    if (!serverMatch) {
      const n = norm(editorTask.text);
      serverMatch = n ? serverByText.get(n) : null;
    }

    // 3. Last resort: cleaned text (strips all tokens) — handles format differences
    if (!serverMatch) {
      const c = cleanTaskText(editorTask.text);
      const candidate = c ? serverByClean.get(c) : null;
      // Only use cleaned match if the candidate hasn't been matched yet
      if (candidate && !matched.has(candidate.id)) {
        serverMatch = candidate;
      }
    }

    if (serverMatch) {
      matched.add(serverMatch.id);

      // Skip updates for habit/recurring tasks — done toggles are handled
      // separately in handleUpdate, and text edits are not supported via diff.
      if (isHabitOrRecurring(editorTask) || isHabitOrRecurring(serverMatch)) continue;

      // Check if anything changed
      const textChanged = norm(editorTask.text) !== norm(serverMatch.text);
      const doneChanged = editorTask.done !== serverMatch.done;
      const posChanged = editorTask.position !== serverMatch.position;

      if (textChanged || doneChanged || posChanged) {
        toUpdate.push({
          id: serverMatch.id,
          text: editorTask.text,
          done: editorTask.done,
          position: editorTask.position,
          html: editorTask.html,
          project_tags: editorTask.project_tags,
          note_tags: editorTask.note_tags,
          due_date: editorTask.due_date,
        });
      }
    } else {
      // No match — this is a new task
      if (editorTask.text?.trim()) {
        toCreate.push(editorTask);
      }
    }
  }

  // Tasks in server but not matched by any editor task → deleted
  for (const serverTask of regularServer) {
    if (!matched.has(serverTask.id)) {
      toDelete.push(serverTask);
    }
  }

  return { toCreate, toUpdate, toDelete };
}

/**
 * Apply the diff — send targeted API calls for each change.
 * @param {string} date - The current date
 * @param {{ toCreate, toUpdate, toDelete }} diff - The computed diff
 * @param {string} token - Auth token
 */
export async function applyDiff(date, diff, token) {
  const promises = [];

  // Create new tasks
  for (const task of diff.toCreate) {
    promises.push(
      api.post('/api/tasks', {
        date,
        text: task.text,
        html: task.html,
        done: task.done || false,
        due_date: task.due_date || null,
        project_tags: task.project_tags || [],
        position: task.position ?? 0,
      }, token)
    );
  }

  // Update changed tasks
  for (const task of diff.toUpdate) {
    promises.push(
      api.patch('/api/tasks', {
        id: task.id,
        text: task.text,
        html: task.html,
        done: task.done,
        position: task.position,
      }, token)
    );
  }

  // Delete removed tasks
  for (const task of diff.toDelete) {
    promises.push(
      api.delete(`/api/tasks?id=${task.id}`, token)
    );
  }

  await Promise.all(promises);
}
