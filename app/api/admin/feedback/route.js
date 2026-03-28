import { withAuth, getServiceClient } from '../../_lib/auth.js';

const OWNER_EMAIL = 'marvin.liyanage@gmail.com';

// GET /api/admin/feedback
//   Returns all feedback entries with user email. Owner-only.
//
// PATCH /api/admin/feedback  { id, status }
//   Update feedback status (new/read/resolved). Owner-only.

export const GET = withAuth(async (req, { user }) => {
  if (user.email !== OWNER_EMAIL) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  const svc = getServiceClient();

  const { data, error } = await svc
    .from('feedback')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;

  // Fetch user emails for each unique user_id
  const userIds = [...new Set((data || []).map(f => f.user_id))];
  const emailMap = {};
  for (const uid of userIds) {
    const { data: { user: u } } = await svc.auth.admin.getUserById(uid);
    if (u) emailMap[uid] = u.email;
  }

  const entries = (data || []).map(f => ({
    ...f,
    user_email: emailMap[f.user_id] || 'unknown',
  }));

  return Response.json({ feedback: entries });
});

export const PATCH = withAuth(async (req, { user }) => {
  if (user.email !== OWNER_EMAIL) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  const { id, status } = await req.json();

  if (!id) return Response.json({ error: 'id is required' }, { status: 400 });

  const VALID = ['new', 'read', 'resolved'];
  if (!status || !VALID.includes(status)) {
    return Response.json({ error: 'status must be new, read, or resolved' }, { status: 400 });
  }

  const svc = getServiceClient();
  const { data, error } = await svc
    .from('feedback')
    .update({ status })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;

  return Response.json({ feedback: data });
});
