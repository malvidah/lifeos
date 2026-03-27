import { withAuth } from '../_lib/auth.js';
import { withGoogleToken } from '../_lib/google.js';

export const maxDuration = 30;

// GET /api/google-tasks
//   Returns all Google Tasks lists + tasks for preview before import.
//
// POST /api/google-tasks  { import: true }
//   Imports all Google Tasks into Day Lab as tasks with due dates and project tags.
//   Skips tasks that have already been imported (by google_task_id).

const GTASKS_BASE = 'https://tasks.googleapis.com/tasks/v1';

async function fetchJSON(url, token) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return { ok: false, status: r.status };
  return { ok: true, data: await r.json() };
}

export const GET = withAuth(async (req, { supabase, user }) => {
  const result = await withGoogleToken(supabase, user.id, async (token) => {
    // Fetch all task lists
    const listsRes = await fetchJSON(`${GTASKS_BASE}/users/@me/lists`, token);
    if (!listsRes.ok) return listsRes;

    const lists = listsRes.data.items || [];
    const allTasks = [];

    // Fetch tasks from each list
    for (const list of lists) {
      let pageToken = null;
      do {
        const url = `${GTASKS_BASE}/lists/${list.id}/tasks?maxResults=100&showCompleted=true&showHidden=true${pageToken ? `&pageToken=${pageToken}` : ''}`;
        const tasksRes = await fetchJSON(url, token);
        if (!tasksRes.ok) break;
        for (const t of (tasksRes.data.items || [])) {
          allTasks.push({
            id: t.id,
            listId: list.id,
            listName: list.title,
            title: t.title || '',
            notes: t.notes || '',
            due: t.due ? t.due.split('T')[0] : null,
            status: t.status, // needsAction | completed
            completed: t.completed ? t.completed.split('T')[0] : null,
            parent: t.parent || null,
            position: t.position,
          });
        }
        pageToken = tasksRes.data.nextPageToken;
      } while (pageToken);
    }

    return { ok: true, data: { lists: lists.map(l => ({ id: l.id, title: l.title })), tasks: allTasks } };
  });

  if (!result.ok) {
    return Response.json({ error: result.error || 'Google Tasks not available' }, { status: result.status || 500 });
  }
  return Response.json(result.data);
});

export const POST = withAuth(async (req, { supabase, user }) => {
  const body = await req.json();
  if (!body.import) return Response.json({ error: 'missing import flag' }, { status: 400 });

  const result = await withGoogleToken(supabase, user.id, async (token) => {
    // Fetch all task lists
    const listsRes = await fetchJSON(`${GTASKS_BASE}/users/@me/lists`, token);
    if (!listsRes.ok) return listsRes;
    const lists = listsRes.data.items || [];

    // Check which google_task_ids we already have
    const { data: existing } = await supabase
      .from('tasks')
      .select('google_task_id')
      .eq('user_id', user.id)
      .not('google_task_id', 'is', null);
    const existingIds = new Set((existing || []).map(r => r.google_task_id));

    const today = body.today || new Date().toISOString().slice(0, 10);
    let imported = 0;
    let skipped = 0;

    for (const list of lists) {
      const projectTag = list.title.toLowerCase().replace(/\s+/g, ' ').trim();

      let pageToken = null;
      do {
        const url = `${GTASKS_BASE}/lists/${list.id}/tasks?maxResults=100&showCompleted=true&showHidden=true${pageToken ? `&pageToken=${pageToken}` : ''}`;
        const tasksRes = await fetchJSON(url, token);
        if (!tasksRes.ok) break;

        const rows = [];
        for (const t of (tasksRes.data.items || [])) {
          if (!t.title?.trim()) continue; // skip empty tasks
          if (existingIds.has(t.id)) { skipped++; continue; } // already imported

          const isDone = t.status === 'completed';
          const dueDate = t.due ? t.due.split('T')[0] : null;
          const completedAt = isDone && t.completed ? t.completed.split('T')[0] : isDone ? today : null;

          // Build text: title + notes as subtitle
          let text = t.title.trim();
          if (t.notes?.trim()) text += `\n${t.notes.trim()}`;

          // If this is a subtask, prefix with indent marker
          if (t.parent) text = `  → ${text}`;

          rows.push({
            user_id: user.id,
            date: dueDate || today, // use due date as the task's date, or today
            due_date: dueDate,
            position: imported,
            text,
            html: `<li data-type="taskItem" data-checked="${isDone ? 'true' : 'false'}"><p>${escHtml(text)}</p></li>`,
            done: isDone,
            completed_at: completedAt,
            project_tags: [projectTag],
            google_task_id: t.id,
          });
          imported++;
        }

        if (rows.length) {
          const { error } = await supabase.from('tasks').insert(rows);
          if (error) throw error;
        }

        pageToken = tasksRes.data.nextPageToken;
      } while (pageToken);
    }

    return { ok: true, data: { imported, skipped, lists: lists.length } };
  });

  if (!result.ok) {
    return Response.json({ error: result.error || 'Import failed' }, { status: result.status || 500 });
  }
  return Response.json(result.data);
});

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');
}
