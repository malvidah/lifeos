import { withAuth } from '../_lib/auth.js';
import { parseTaskBlocks, tasksToHtml } from '@/lib/parseBlocks.js';

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
//   Preserves due_date on existing rows by matching on (user_id, date, position).
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
  if (!date) return Response.json({ error: 'date or project required' }, { status: 400 });

  // 1. Tasks written on this date
  const { data: ownTasks, error: e1 } = await supabase
    .from('tasks')
    .select('id, position, html, text, done, due_date, completed_at, project_tags, note_tags, date')
    .eq('user_id', user.id)
    .eq('date', date)
    .order('position', { ascending: true });
  if (e1) throw e1;

  // 2. Open tasks from other dates that are due today
  const { data: dueTasks, error: e2 } = await supabase
    .from('tasks')
    .select('id, position, html, text, done, due_date, completed_at, project_tags, note_tags, date')
    .eq('user_id', user.id)
    .eq('due_date', date)
    .eq('done', false)
    .neq('date', date)  // exclude tasks already captured above
    .order('date', { ascending: true })
    .order('position', { ascending: true });
  if (e2) throw e2;

  const allTasks = [...(ownTasks ?? []), ...(dueTasks ?? [])];
  return Response.json({ data: tasksToHtml(allTasks), dueTasks: dueTasks ?? [] });
});

export const POST = withAuth(async (req, { supabase, user }) => {
  const { date, data: html } = await req.json();
  if (!date) return Response.json({ error: 'date required' }, { status: 400 });

  const parsed = parseTaskBlocks(html || '');
  const today  = TODAY();

  // Fetch existing rows for this date so we can preserve due_dates
  // (due_date is not stored in the HTML, only in the DB row)
  const { data: existing } = await supabase
    .from('tasks')
    .select('id, position, due_date, completed_at')
    .eq('user_id', user.id)
    .eq('date', date)
    .order('position', { ascending: true });

  const existingByPos = Object.fromEntries((existing ?? []).map(r => [r.position, r]));

  // Delete existing rows for this date
  const { error: delErr } = await supabase
    .from('tasks').delete()
    .eq('user_id', user.id).eq('date', date);
  if (delErr) throw delErr;

  if (parsed.length > 0) {
    const rows = parsed.map(t => {
      const prev = existingByPos[t.position];
      return {
        user_id:      user.id,
        date,
        position:     t.position,
        html:         t.html,
        text:         t.text,
        done:         t.done,
        // Preserve due_date from DB if HTML doesn't contain @date syntax
        due_date:     t.due_date ?? prev?.due_date ?? null,
        // Set completed_at to today when task is newly checked
        completed_at: t.done
          ? (prev?.completed_at ?? today)
          : null,
        project_tags: t.project_tags,
        note_tags:    t.note_tags,
      };
    });
    const { error: insErr } = await supabase.from('tasks').insert(rows);
    if (insErr) throw insErr;
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
