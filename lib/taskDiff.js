// ─── Task Diff Layer ─────────────────────────────────────────────────────────
// Compares server tasks (from GET) with editor tasks (from parseTaskBlocks)
// and returns targeted CREATE / UPDATE / DELETE operations.
//
// Matching is ID-only: every existing task has a data-task-id injected by GET,
// preserved by TipTap, and extracted by parseTaskBlocks. No text-based fallbacks.
//
// The editor is the source of truth for all tasks including habits/recurring.

import { api } from "@/lib/api";

function norm(text) {
  return (text || '').trim().toLowerCase();
}

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
 * Compute the diff between server tasks and editor tasks.
 * Matching is by task_id only — no text-based fallbacks.
 */
export function diffTasks(serverTasks, editorTasks) {
  const toCreate = [];
  const toUpdate = [];
  const toDelete = [];

  const serverById = new Map();
  for (const t of serverTasks) {
    if (t.id) serverById.set(t.id, t);
  }

  const matched = new Set();

  for (const et of editorTasks) {
    // Skip virtual recurring appearances — they're display-only
    if (et.recurring) continue;

    const server = et.task_id ? serverById.get(et.task_id) : null;

    if (server) {
      matched.add(server.id);
      const isHabit = isHabitOrRecurring(et) || isHabitOrRecurring(server);
      const textChanged = norm(et.text) !== norm(server.text);
      const doneChanged = et.done !== server.done;

      // Habits: allow text edits, skip done changes (handled by complete-recurring)
      if (isHabit) {
        if (textChanged) {
          toUpdate.push({
            id: server.id,
            text: et.text,
            html: et.html,
            done: server.done, // preserve server done state
            position: et.position,
          });
        }
        continue;
      }

      // Regular tasks: update on any change
      if (textChanged || doneChanged) {
        toUpdate.push({
          id: server.id,
          text: et.text,
          html: et.html,
          done: et.done,
          position: et.position,
        });
      }
    } else if (et.text?.trim()) {
      // No task_id match → new task
      toCreate.push(et);
    }
  }

  // Server tasks not matched → deleted by the user
  for (const st of serverTasks) {
    if (matched.has(st.id)) continue;
    if (st._source === 'recurring') continue; // virtual, not ours
    toDelete.push(st);
  }

  return { toCreate, toUpdate, toDelete };
}

/**
 * Apply the diff — send targeted API calls for each mutation.
 */
export async function applyDiff(date, diff, token) {
  const promises = [];

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

  for (const task of diff.toDelete) {
    const cascade = isHabitOrRecurring(task) ? '&recurring=1' : '';
    promises.push(
      api.delete(`/api/tasks?id=${task.id}${cascade}`, token)
    );
  }

  await Promise.all(promises);
}
