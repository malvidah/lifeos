import { withAuth } from '../_lib/auth.js';
import { isValidUuid } from '@/lib/validate.js';

// GET /api/goals
//   → { goals: [{id, user_id, name, project, done, position, created_at, updated_at, task_count, habit_count}] }
//   Returns all goals for user with linked task/habit counts.
//
// POST /api/goals  { name, project? }
//   Create a new goal.
//
// PATCH /api/goals  { id, name?, project?, done?, position? }
//   Update a goal.
//
// DELETE /api/goals?id=UUID
//   Delete a goal.

export const GET = withAuth(async (req, { supabase, user }) => {
  const { data, error } = await supabase
    .from('goals')
    .select('*')
    .eq('user_id', user.id)
    .order('position', { ascending: true });

  if (error) throw error;

  // For each goal, count linked tasks and habits
  const goalsWithCounts = await Promise.all((data || []).map(async (goal) => {
    // Count tasks with data-goal="goalname" in html
    const { count: taskCount, error: taskError } = await supabase
      .from('tasks')
      .select('id', { count: 'exact' })
      .eq('user_id', user.id)
      .ilike('html', `%data-goal="${goal.name}"%`)
      .is('deleted_at', null);

    if (taskError) throw taskError;

    // Count habits with both data-habit= AND data-goal="goalname" in html
    const { count: habitCount, error: habitError } = await supabase
      .from('tasks')
      .select('id', { count: 'exact' })
      .eq('user_id', user.id)
      .ilike('html', `%data-habit=%`)
      .ilike('html', `%data-goal="${goal.name}"%`)
      .is('deleted_at', null);

    if (habitError) throw habitError;

    return {
      ...goal,
      task_count: taskCount || 0,
      habit_count: habitCount || 0,
    };
  }));

  return Response.json({ goals: goalsWithCounts });
});

export const POST = withAuth(async (req, { supabase, user }) => {
  const { name, project } = await req.json();

  if (!name || typeof name !== 'string' || !name.trim()) {
    return Response.json({ error: 'name is required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('goals')
    .insert({
      user_id: user.id,
      name: name.trim().toLowerCase(),
      project: project ? project.trim().toLowerCase() : null,
    })
    .select()
    .single();

  // Handle conflict gracefully (duplicate goal name for this user)
  if (error) {
    if (error.code === '23505') {
      // Unique constraint violation
      return Response.json({ goal: null, skipped: 'duplicate' }, { status: 409 });
    }
    throw error;
  }

  return Response.json({ goal: data });
});

export const PATCH = withAuth(async (req, { supabase, user }) => {
  const { id, name, project, done, position } = await req.json();

  if (!id) {
    return Response.json({ error: 'id is required' }, { status: 400 });
  }

  if (!isValidUuid(id)) {
    return Response.json({ error: 'invalid id' }, { status: 400 });
  }

  // Fetch current goal for rename cascade
  const { data: current } = await supabase
    .from('goals').select('name').eq('id', id).eq('user_id', user.id).single();
  const oldName = current?.name;

  // Whitelist allowed fields
  const updates = {};
  if (name !== undefined) updates.name = name.trim().toLowerCase();
  if (project !== undefined) updates.project = project ? project.trim().toLowerCase() : null;
  if (done !== undefined) updates.done = !!done;
  if (position !== undefined) updates.position = position;
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('goals')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) throw error;

  // Rename cascade: update data-goal in all linked tasks/habits
  const newName = updates.name;
  if (newName && oldName && newName !== oldName) {
    // Find all tasks that reference the old goal name
    const { data: linkedTasks } = await supabase
      .from('tasks')
      .select('id, text, html')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .ilike('html', `%data-goal="${oldName}"%`);

    for (const task of (linkedTasks || [])) {
      const updatedHtml = task.html
        .replace(new RegExp(`data-goal="${oldName}"`, 'g'), `data-goal="${newName}"`)
        .replace(new RegExp(`>🏁 ${oldName}<`, 'g'), `>🏁 ${newName}<`)
        .replace(new RegExp(`>🏔️ ${oldName}<`, 'g'), `>🏁 ${newName}<`);
      const updatedText = task.text
        .replace(new RegExp(`\\{g:${oldName}\\}`, 'g'), `{g:${newName}}`);
      await supabase.from('tasks').update({ html: updatedHtml, text: updatedText })
        .eq('id', task.id).eq('user_id', user.id);
    }
  }

  return Response.json({ goal: data });
});

export const DELETE = withAuth(async (req, { supabase, user }) => {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return Response.json({ error: 'id is required' }, { status: 400 });
  }

  if (!isValidUuid(id)) {
    return Response.json({ error: 'invalid id' }, { status: 400 });
  }

  const { error } = await supabase
    .from('goals')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) throw error;

  return Response.json({ ok: true });
});
