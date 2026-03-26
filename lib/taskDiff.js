// ─── Task Diff Layer ─────────────────────────────────────────────────────────
// Compares two arrays of task objects and returns targeted mutations.
// Used by the single TipTap TaskList editor to avoid full-replace saves.
//
// Instead of DELETE-all + INSERT-all, we:
//   1. Match current tasks against last-known server state
//   2. Detect new, changed, and deleted tasks
//   3. Send targeted POST/PATCH/DELETE for each change

import { api } from "@/lib/api";
import { cleanTaskText } from "@/lib/cleanTaskText";

// Normalize text for comparison — strips all tokens ({h:...}, /r ..., etc.)
// so different serialization formats match to the same base task name
function norm(text) {
  return cleanTaskText(text);
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

  // Index server tasks by ID and normalized text
  const serverById = new Map();
  const serverByText = new Map();
  for (const t of serverTasks) {
    if (t.id) serverById.set(t.id, t);
    const n = norm(t.text);
    if (n && !serverByText.has(n)) serverByText.set(n, t);
  }

  // Track which server tasks were matched
  const matched = new Set();

  for (const editorTask of editorTasks) {
    // Try to match by task_id (most reliable — injected by GET as data-task-id)
    let serverMatch = editorTask.task_id ? serverById.get(editorTask.task_id) : null;

    // Fallback: match by normalized text
    if (!serverMatch) {
      const n = norm(editorTask.text);
      serverMatch = n ? serverByText.get(n) : null;
    }

    if (serverMatch) {
      matched.add(serverMatch.id);
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
          _source: serverMatch._source,
          _serverDone: serverMatch.done,
          _hasRecurrenceAttr: !!(serverMatch.html?.includes('data-recurrence=') || serverMatch.html?.includes('data-habit=')),
          _doneChanged: doneChanged,
        });
      }
    } else {
      // No match — this is a new task
      if (editorTask.text?.trim()) {
        // Skip recurring virtual tasks (they shouldn't be created as new)
        if (!editorTask.recurring) {
          toCreate.push(editorTask);
        }
      }
    }
  }

  // Tasks in server but not matched by any editor task → deleted
  for (const serverTask of serverTasks) {
    if (!matched.has(serverTask.id)) {
      // Don't delete recurring virtual tasks (they're display-only)
      if (serverTask._source !== 'recurring') {
        toDelete.push(serverTask);
      }
    }
  }

  return { toCreate, toUpdate, toDelete };
}

/**
 * Apply the diff — send targeted API calls for each change.
 * @param {string} date - The current date
 * @param {{ toCreate, toUpdate, toDelete }} diff - The computed diff
 * @param {string} token - Auth token
 * @returns {Promise<{hadRecurringDone: boolean}>} - metadata about what happened
 */
export async function applyDiff(date, diff, token) {
  const promises = [];
  let hadRecurringDone = false;

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
    // Template task checkbox toggle → route to complete-recurring.
    // Handle recurring/habit done changes specially
    if (task._doneChanged && task._hasRecurrenceAttr) {
      if (task.done && !task._serverDone) {
        // Checking an undone template → create completion row
        hadRecurringDone = true;
        promises.push(
          api.post('/api/tasks/complete-recurring', {
            template_id: task.id,
            date,
            position: task.position,
          }, token)
        );
        continue;
      }
      if (!task.done && task._serverDone) {
        // Unchecking a completion row → delete it (template will reappear)
        hadRecurringDone = true;
        promises.push(
          api.delete(`/api/tasks?id=${task.id}`, token)
        );
        continue;
      }
    }
    // For recurring templates: if only done changed (and was handled above),
    // we already continued. If text/tags changed, fall through to normal PATCH.
    // The PATCH guard on the server blocks done=true on templates as safety net.
    promises.push(
      api.patch('/api/tasks', {
        id: task.id,
        text: task.text,
        html: task.html,
        done: task.done,
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
  return { hadRecurringDone };
}
