import { withAuth } from '../../_lib/auth.js';

// POST /api/projects/rename
// Body: { oldName: string, newName: string }
// Renames a project tag across all typed tables that use project_tags[].
// Also updates {oldName} → {newName} references inside journal_blocks.content.
export const POST = withAuth(async (req, { supabase, user }) => {
  const { oldName, newName } = await req.json();

  if (!oldName || !newName || oldName === newName)
    return Response.json({ error: 'invalid names' }, { status: 400 });

  const uid = user.id;
  const tables = ['journal_blocks', 'tasks', 'meal_items', 'workouts'];

  // ── 1. Rename project_tags in all typed tables ─────────────────────────────
  const tagUpdates = tables.map(async table => {
    const { data: rows } = await supabase
      .from(table).select('id, project_tags')
      .eq('user_id', uid)
      .contains('project_tags', [oldName]);

    if (!rows?.length) return 0;
    const upserts = rows.map(r => ({
      id: r.id,
      project_tags: r.project_tags.map(t => t === oldName ? newName : t),
    }));
    await supabase.from(table).upsert(upserts);
    return rows.length;
  });

  // ── 2. Replace {oldName} inline refs in journal content ───────────────────
  const contentUpdate = (async () => {
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const { data: rows } = await supabase
      .from('journal_blocks').select('id, content')
      .eq('user_id', uid)
      .ilike('content', `%{${oldName}}%`);

    if (!rows?.length) return 0;
    const upserts = rows
      .filter(r => r.content?.includes(`{${oldName}}`))
      .map(r => ({
        id: r.id,
        content: r.content.replace(new RegExp(`\\{${esc(oldName)}\\}`, 'gi'), `{${newName}}`),
      }));
    if (upserts.length) await supabase.from('journal_blocks').upsert(upserts);
    return upserts.length;
  })();

  // ── 3. Rename in user_settings.projectSettings if it exists ───────────────
  const settingsUpdate = (async () => {
    const { data: row } = await supabase
      .from('user_settings').select('data').eq('user_id', uid).single();
    const ps = row?.data?.projectSettings ?? {};
    if (!ps[oldName]) return;
    const updated = { ...ps, [newName]: ps[oldName] };
    delete updated[oldName];
    await supabase.from('user_settings')
      .upsert({ user_id: uid, data: { ...(row?.data ?? {}), projectSettings: updated } },
               { onConflict: 'user_id' });
  })();

  const results = await Promise.all([...tagUpdates, contentUpdate, settingsUpdate]);
  return Response.json({ ok: true, updated: results.slice(0, tables.length) });
});
