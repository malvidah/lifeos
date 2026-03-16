import { withAuth } from '../_lib/auth.js';
import { parseRecurrence, matchesSchedule, calculateStreak } from '@/lib/recurrence.js';

// GET /api/habits?date=YYYY-MM-DD
//   Returns recurring task instances for this date + creates missing instances.
//
// POST /api/habits  { text, schedule }
//   Create a recurring task template. schedule is the raw "/d ..." text.
//
// PATCH /api/habits  { id, done }
//   Toggle a recurring task instance (flag it).
//
// GET /api/habits?stats=true&project=name
//   Returns flag counts and streaks per habit for a project.

export const GET = withAuth(async (req, { supabase, user }) => {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');
  const stats = searchParams.get('stats');
  const project = searchParams.get('project');

  // ── Stats mode: flag counts + streaks per habit for a project ────────
  if (stats && project) {
    const { data: templates } = await supabase
      .from('tasks')
      .select('id, text, recurrence, project_tags')
      .eq('user_id', user.id)
      .eq('is_template', true)
      .contains('project_tags', [project.toLowerCase()]);

    if (!templates?.length) return Response.json({ habits: [] });

    const habitStats = await Promise.all(templates.map(async t => {
      const { data: instances } = await supabase
        .from('tasks')
        .select('date, done')
        .eq('recurrence_parent_id', t.id)
        .eq('user_id', user.id)
        .order('date', { ascending: false })
        .limit(365);

      const flagCount = (instances || []).filter(i => i.done).length;
      const streak = calculateStreak(instances || [], t.recurrence);

      return {
        id: t.id,
        text: t.text,
        recurrence: t.recurrence,
        flagCount,
        streak,
      };
    }));

    return Response.json({ habits: habitStats });
  }

  // ── Date mode: get/create instances for this date ───────────────────
  if (!date) return Response.json({ error: 'date required' }, { status: 400 });

  // Find all active templates for this user
  const { data: templates } = await supabase
    .from('tasks')
    .select('id, text, html, recurrence, project_tags, note_tags')
    .eq('user_id', user.id)
    .eq('is_template', true);

  if (!templates?.length) return Response.json({ instances: [] });

  // Filter to templates that match this date
  const matching = templates.filter(t => matchesSchedule(date, t.recurrence));
  if (!matching.length) return Response.json({ instances: [] });

  // Check which already have instances for this date
  const templateIds = matching.map(t => t.id);
  const { data: existing } = await supabase
    .from('tasks')
    .select('id, recurrence_parent_id, done, text, html, project_tags')
    .eq('user_id', user.id)
    .eq('date', date)
    .in('recurrence_parent_id', templateIds);

  const existingParents = new Set((existing || []).map(e => e.recurrence_parent_id));

  // Create missing instances
  const toCreate = matching
    .filter(t => !existingParents.has(t.id))
    .map(t => ({
      user_id: user.id,
      date,
      text: t.text,
      html: t.html || `<li data-type="taskItem" data-checked="false"><p>${t.text}</p></li>`,
      done: false,
      project_tags: t.project_tags || [],
      note_tags: t.note_tags || [],
      recurrence_parent_id: t.id,
      position: 9000, // sort to end
    }));

  if (toCreate.length) {
    await supabase.from('tasks').insert(toCreate);
  }

  // Return all instances for this date (existing + newly created)
  const { data: allInstances } = await supabase
    .from('tasks')
    .select('id, text, html, done, project_tags, recurrence_parent_id, date')
    .eq('user_id', user.id)
    .eq('date', date)
    .not('recurrence_parent_id', 'is', null);

  return Response.json({ instances: allInstances || [] });
});

export const POST = withAuth(async (req, { supabase, user }) => {
  const { text, project } = await req.json();
  if (!text) return Response.json({ error: 'text required' }, { status: 400 });

  const today = new Date().toISOString().slice(0, 10);
  const { cleanText, recurrence } = parseRecurrence(text, today);

  if (!recurrence) {
    return Response.json({ error: 'Could not parse schedule. Use /d daily, /d m w f, /d every monday, etc.' }, { status: 400 });
  }

  const tags = project ? [project.toLowerCase()] : [];

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      user_id: user.id,
      date: today,
      text: cleanText,
      html: `<li data-type="taskItem" data-checked="false"><p>${cleanText}</p></li>`,
      done: false,
      is_template: true,
      recurrence,
      project_tags: tags,
      position: 0,
    })
    .select()
    .single();

  if (error) throw error;
  return Response.json({ template: data });
});

export const PATCH = withAuth(async (req, { supabase, user }) => {
  const { id, done } = await req.json();
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const patch = { done: !!done };
  if (done) patch.completed_at = new Date().toISOString().slice(0, 10);
  else patch.completed_at = null;

  const { error } = await supabase
    .from('tasks').update(patch)
    .eq('id', id).eq('user_id', user.id);
  if (error) throw error;

  return Response.json({ ok: true });
});
