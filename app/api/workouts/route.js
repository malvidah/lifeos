import { withAuth } from '../_lib/auth.js';

// GET /api/workouts?project=health[&terms=sleep,running]
// Returns workouts tagged to the project, or matching any search terms.
export const GET = withAuth(async (req, { supabase, user }) => {
  const params  = new URL(req.url).searchParams;
  const project = params.get('project');
  const terms   = (params.get('terms') || '').split(',').map(t => t.trim()).filter(Boolean);

  let q = supabase.from('workouts')
    .select('id, date, source, type, title, duration_min, distance_m, calories, avg_hr, project_tags')
    .eq('user_id', user.id)
    .order('date', { ascending: false })
    .limit(500);

  if (project && project !== '__everything__') {
    const filters = [`project_tags.cs.{${project}}`];
    terms.forEach(t => filters.push(`title.ilike.%${t}%`));
    q = q.or(filters.join(','));
  }

  const { data, error } = await q;
  if (error) throw error;
  return Response.json({ workouts: data || [] });
});
