import { withAuth } from '../_lib/auth.js';

// GET /api/export — full data export for the authenticated user
// Returns JSON with all tables; the frontend creates the ZIP.

const TABLES = [
  'entries',
  'notes',
  'tasks',
  'projects',
  'health_metrics',
  'health_scores',
  'tag_connections',
];

export const GET = withAuth(async (req, { supabase, user }) => {
  const results = {};
  const counts = {};

  // Query all tables in parallel
  const queries = TABLES.map(async (table) => {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('user_id', user.id);

    if (error) {
      // Table might not exist — return empty array rather than failing
      console.warn(`[export] failed to query ${table}:`, error.message);
      results[table] = [];
      counts[`${table}_count`] = 0;
      return;
    }

    results[table] = data ?? [];
    counts[`${table}_count`] = (data ?? []).length;
  });

  await Promise.all(queries);

  const metadata = {
    exported_at: new Date().toISOString(),
    user_id: user.id,
    ...counts,
  };

  return Response.json({
    metadata,
    ...results,
  });
});
