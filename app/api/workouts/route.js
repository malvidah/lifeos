import { withAuth } from '../_lib/auth.js';

// GET /api/workouts?date=YYYY-MM-DD    → workouts on that date
//   Returns { workouts: [...], data: <card-format manual rows | null> }
//   The `data` field is consumed by useDbSave / dbLoad in WorkoutsCard.
// GET /api/workouts?project=big+think  → workouts tagged to that project (all dates)
// GET /api/workouts?start=...&end=...  → workouts in a date range
//
// POST /api/workouts  { date, data: [{id, text, dist, pace, kcal}, ...] }
//   Card batch format: full-replaces all source='manual' rows for the date.
//   Called by useDbSave in WorkoutsCard.
//
// POST /api/workouts  { date, source?, type?, title?, duration_min?, distance_m?,
//                       calories?, avg_hr?, project_tags?, external_id?, raw? }
//   Single-workout format: insert or upsert one workout.
//
// PATCH /api/workouts  { date, rows: [{source, text, dist, pace, kcal, id?}, ...] }
//   Batch-replace synced (oura/strava) rows for the date. Used by WorkoutsCard.
// PATCH /api/workouts  { id, ...fields }   → update a single workout field
// DELETE /api/workouts?id=UUID             → delete a manual workout

export const GET = withAuth(async (req, { supabase, user }) => {
  const { searchParams } = new URL(req.url);
  const date    = searchParams.get('date');
  const project = searchParams.get('project');
  const start   = searchParams.get('start');
  const end     = searchParams.get('end');

  let query = supabase
    .from('workouts')
    .select('id, date, source, type, title, duration_min, distance_m, calories, avg_hr, project_tags, external_id, created_at, raw')
    .eq('user_id', user.id);

  if (date) {
    query = query.eq('date', date);
  } else if (project) {
    query = query.contains('project_tags', [project.toLowerCase()]);
  } else if (start && end) {
    query = query.gte('date', start).lte('date', end);
  } else {
    return Response.json({ error: 'date, project, or start+end required' }, { status: 400 });
  }

  const { data, error } = await query.order('date', { ascending: false });
  if (error) throw error;

  const workouts = data ?? [];

  // Build card-format data for useDbSave / dbLoad in WorkoutsCard (source='manual' only)
  if (date) {
    const manual = workouts.filter(r => r.source === 'manual');
    const cardData = manual.length
      ? manual.map(r => ({
          id:   r.id,
          text: r.title ?? '',
          dist: r.raw?.dist ?? null,
          pace: r.raw?.pace ?? null,
          kcal: r.calories ?? null,
        }))
      : null;
    return Response.json({ workouts, data: cardData });
  }

  return Response.json({ workouts });
});

export const POST = withAuth(async (req, { supabase, user }) => {
  const body = await req.json();
  const { date } = body;
  if (!date) return Response.json({ error: 'date required' }, { status: 400 });

  // ── Card batch format: { date, data: [{id, text, dist, pace, kcal}, ...] } ──
  // Full-replace all source='manual' rows for the date (called by useDbSave).
  if (Array.isArray(body.data)) {
    const rows = body.data.filter(r => r.text?.trim());
    const { error: rpcErr } = await supabase.rpc('batch_replace_workouts', {
      p_user_id: user.id,
      p_date:    date,
      p_sources: ['manual'],
      p_rows:    rows.map(r => ({
        title:    r.text,
        source:   'manual',
        calories: r.kcal ? Number(r.kcal) : null,
        raw:      { dist: r.dist ?? null, pace: r.pace ?? null },
      })),
    });
    if (rpcErr) return Response.json({ error: rpcErr.message }, { status: 500 });
    return Response.json({ ok: true });
  }

  // ── Single-workout format ─────────────────────────────────────────────────
  const {
    source = 'manual', type = null, title = null,
    duration_min = null, distance_m = null, calories = null,
    avg_hr = null, project_tags = [], external_id = null, raw = null,
  } = body;

  const row = {
    user_id: user.id,
    date, source, type, title,
    duration_min, distance_m, calories, avg_hr,
    project_tags: project_tags.map(t => t.toLowerCase()),
    external_id, raw,
  };

  // Upsert for synced workouts (dedup by external_id); plain insert for manual.
  let query;
  if (external_id) {
    query = supabase
      .from('workouts')
      .upsert(row, { onConflict: 'user_id,source,external_id' })
      .select()
      .single();
  } else {
    query = supabase
      .from('workouts')
      .insert(row)
      .select()
      .single();
  }

  const { data, error } = await query;
  if (error) throw error;
  return Response.json({ workout: data });
});

export const PATCH = withAuth(async (req, { supabase, user }) => {
  const body = await req.json();

  // ── Batch synced row replace: { date, rows: [...] } ──────────────────────
  // Replaces oura/strava rows for a date. Used by WorkoutsCard after live fetch.
  if (body.rows !== undefined) {
    const { date, rows } = body;
    if (!date) return Response.json({ error: 'date required' }, { status: 400 });

    const toInsert = (rows || []).filter(r => r.text?.trim() && r.source !== 'manual');
    const { error: rpcErr } = await supabase.rpc('batch_replace_workouts', {
      p_user_id: user.id,
      p_date:    date,
      p_sources: ['oura', 'strava'],
      p_rows:    toInsert.map(r => ({
        title:    r.text,
        source:   r.source || 'oura',
        calories: r.kcal ? Number(r.kcal) : null,
        raw:      { clientId: r.id ?? null, dist: r.dist ?? null, pace: r.pace ?? null },
      })),
    });
    if (rpcErr) return Response.json({ error: rpcErr.message }, { status: 500 });
    return Response.json({ ok: true });
  }

  // ── Single row update: { id, ...fields } ─────────────────────────────────
  const { id, ...rest } = body;
  if (!id) return Response.json({ error: 'id or rows required' }, { status: 400 });

  const allowed = ['date', 'type', 'title', 'duration_min', 'distance_m', 'calories', 'avg_hr', 'project_tags'];
  const patch = Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k)));
  if (patch.project_tags) patch.project_tags = patch.project_tags.map(t => t.toLowerCase());

  const { error } = await supabase
    .from('workouts').update(patch)
    .eq('id', id).eq('user_id', user.id);
  if (error) throw error;

  return Response.json({ ok: true });
});

export const DELETE = withAuth(async (req, { supabase, user }) => {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabase
    .from('workouts').delete()
    .eq('id', id).eq('user_id', user.id);
  if (error) throw error;

  return Response.json({ ok: true });
});
