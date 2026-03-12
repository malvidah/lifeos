import { getUserClient } from '../_lib/google.js';

// Projects are stored as {projectname} (lowercase, no spaces inside braces).
// Legacy: #ProjectName format still matched during migration window.
const TAG_RE_NEW    = /\{([a-z0-9][a-z0-9 ]*[a-z0-9]|[a-z0-9])\}/g;
const TAG_RE_LEGACY = /#([A-Za-z][A-Za-z0-9]+)(?![A-Za-z0-9])/g;

const BUILTIN_LOWER = new Set(['health']);

export async function GET(req) {
  const { supabase } = getUserClient(req);
  if (!supabase) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  try {
    // Read both current and legacy type names to work before + after migration
    const [journalR, legacyNotesR, tasksR, legacyTasksR] = await Promise.all([
      supabase.from('entries').select('data').eq('user_id', user.id).eq('type', 'journal'),
      supabase.from('entries').select('data').eq('user_id', user.id).eq('type', 'notes'),
      supabase.from('entries').select('data').eq('user_id', user.id).eq('type', 'tasks'),
      supabase.from('entries').select('data').eq('user_id', user.id).eq('type', 'workouts'),
    ]);

    const tags = new Set();

    const scanText = (text) => {
      if (typeof text !== 'string') return;
      TAG_RE_NEW.lastIndex = 0;
      let m;
      while ((m = TAG_RE_NEW.exec(text)) !== null) {
        const lower = m[1].toLowerCase();
        if (!BUILTIN_LOWER.has(lower)) tags.add(lower);
      }
      // Legacy #Tag support — normalize to lowercase
      TAG_RE_LEGACY.lastIndex = 0;
      while ((m = TAG_RE_LEGACY.exec(text)) !== null) {
        const lower = m[1].toLowerCase();
        if (!BUILTIN_LOWER.has(lower)) tags.add(lower);
      }
    };

    for (const row of [...(journalR.data || []), ...(legacyNotesR.data || [])]) {
      scanText(typeof row.data === 'string' ? row.data : '');
    }
    for (const row of [...(tasksR.data || []), ...(legacyTasksR.data || [])]) {
      for (const task of (Array.isArray(row.data) ? row.data : [])) {
        if (task?.text) scanText(task.text);
      }
    }

    return Response.json({ tags: [...tags].sort() });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
