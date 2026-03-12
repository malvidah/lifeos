import { withAuth } from '../_lib/auth.js';
import { parseTasks } from '../_lib/parseTasks.js';

const TAG_RE_NEW    = /\{([a-z0-9][a-z0-9 ]*[a-z0-9]|[a-z0-9])\}/g;
const TAG_RE_LEGACY = /#([A-Za-z][A-Za-z0-9]+)(?![A-Za-z0-9])/g;
const BUILTIN_LOWER = new Set(['health']);

export const GET = withAuth(async (req, { supabase, user }) => {
  const [journalR, tasksR] = await Promise.all([
    supabase.from('entries').select('data').eq('user_id', user.id).eq('type', 'journal'),
    supabase.from('entries').select('data').eq('user_id', user.id).eq('type', 'tasks'),
  ]);

  const tags = new Set();
  function scanText(text) {
    if (typeof text !== 'string') return;
    TAG_RE_NEW.lastIndex = 0;
    let m;
    while ((m = TAG_RE_NEW.exec(text)) !== null) {
      const lower = m[1].toLowerCase();
      if (!BUILTIN_LOWER.has(lower)) tags.add(lower);
    }
    TAG_RE_LEGACY.lastIndex = 0;
    while ((m = TAG_RE_LEGACY.exec(text)) !== null) {
      const lower = m[1].toLowerCase();
      if (!BUILTIN_LOWER.has(lower)) tags.add(lower);
    }
  }

  for (const row of (journalR.data || [])) scanText(typeof row.data === 'string' ? row.data : '');
  for (const row of (tasksR.data || [])) for (const task of parseTasks(row.data)) scanText(task.text);

  return Response.json({ tags: [...tags].sort() });
});
