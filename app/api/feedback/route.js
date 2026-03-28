import { withAuth } from '../_lib/auth.js';

// POST /api/feedback  { text }
//   Submit feedback from any authenticated user.

export const POST = withAuth(async (req, { supabase, user }) => {
  const { text } = await req.json();

  if (!text || typeof text !== 'string' || !text.trim()) {
    return Response.json({ error: 'text is required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('feedback')
    .insert({ user_id: user.id, text: text.trim() })
    .select()
    .single();

  if (error) throw error;

  return Response.json({ feedback: data });
});
