import { createClient } from '@supabase/supabase-js';

function getUserClient(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return { supabase: null, token: null };
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  return { supabase, token };
}

// Matches a line if it contains:
//   1. #ProjectName (existing tag syntax)
//   2. The project name as a plain word, case-insensitive (e.g. "work", "Work", "WORK")
//      — word boundaries so "network" doesn't match "work"
function makeMatchRe(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // #Tag match OR plain word match (case-insensitive, word boundary)
  return new RegExp(`#${escaped}(?![A-Za-z0-9])|\\b${escaped}\\b`, 'i');
}

export async function GET(req) {
  const { supabase } = getUserClient(req);
  if (!supabase) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const project = searchParams.get('project');
  const isEverything = project === '__everything__';
  if (!project || (!isEverything && !/^[A-Za-z][A-Za-z0-9]+$/.test(project))) {
    return Response.json({ error: 'invalid project name' }, { status: 400 });
  }

  try {
    // Fetch all notes entries for this user
    const { data: notesRows, error: ne } = await supabase
      .from('entries').select('date, data')
      .eq('user_id', user.id).eq('type', 'notes')
      .order('date', { ascending: true });
    if (ne) throw ne;

    const matchRe = isEverything ? null : makeMatchRe(project);

    // Extract journal entries using block-level grouping:
    // Consecutive non-empty lines form a "block". If any line in the block
    // matches (tag OR plain word), include ALL lines of that block.
    const journalEntries = [];
    for (const row of notesRows || []) {
      const text = typeof row.data === 'string' ? row.data : '';
      if (!text.trim()) continue;
      if (!isEverything && !matchRe.test(text)) continue;

      const lines = text.split('\n');
      let i = 0;
      while (i < lines.length) {
        if (!lines[i].trim()) { i++; continue; }
        const block = [];
        while (i < lines.length && lines[i].trim()) {
          block.push({ text: lines[i].trim(), lineIndex: i });
          i++;
        }
        if (isEverything || block.some(l => matchRe.test(l.text))) {
          block.forEach(l => journalEntries.push({ date: row.date, text: l.text, lineIndex: l.lineIndex }));
        }
      }
    }

    // Fetch tasks
    const taskEntries = [];
    const { data: tasksRows, error: te } = await supabase
      .from('entries').select('date, data')
      .eq('user_id', user.id).eq('type', 'tasks')
      .order('date', { ascending: true });
    if (te) throw te;
    for (const row of tasksRows || []) {
      const tasks = Array.isArray(row.data) ? row.data : [];
      tasks.forEach(task => {
        if (!task?.text) return;
        if (isEverything || matchRe.test(task.text)) {
          taskEntries.push({ date: row.date, id: task.id, text: task.text, done: !!task.done });
        }
      });
    }

    return Response.json({ journalEntries, taskEntries, isEverything });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
