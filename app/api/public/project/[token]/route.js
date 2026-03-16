import { getServiceClient } from '../../../_lib/auth.js';

// ─── GET /api/public/project/[token] ─────────────────────────────────────────
// Unauthenticated endpoint — returns read-only project data for a share link.
export async function GET(_req, { params }) {
  const { token } = await params;
  if (!token) return Response.json({ error: 'missing token' }, { status: 400 });

  const sb = getServiceClient();

  // Look up the project by share_token
  const { data: project, error: pErr } = await sb
    .from('projects')
    .select('user_id, name, color')
    .eq('share_token', token)
    .eq('is_public', true)
    .single();

  if (pErr || !project) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }

  const { user_id, name, color } = project;
  const tagFilter = [name];

  // Fetch journal entries and tasks that belong to this project
  const [journalR, tasksR] = await Promise.all([
    sb.from('journal_blocks')
      .select('date, type, content, images')
      .eq('user_id', user_id)
      .overlaps('project_tags', tagFilter)
      .order('date', { ascending: false })
      .limit(200),
    sb.from('tasks')
      .select('date, title, status, priority')
      .eq('user_id', user_id)
      .overlaps('project_tags', tagFilter)
      .order('date', { ascending: false })
      .limit(200),
  ]);

  return Response.json({
    project: { name, color },
    journalEntries: journalR.data ?? [],
    taskEntries: tasksR.data ?? [],
  });
}
