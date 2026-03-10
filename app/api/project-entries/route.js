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

// "BigThink" → "Big Think", "CuriosityLab" → "Curiosity Lab"
function toDisplayName(name) {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

// Matches a line if it contains:
//   1. #ProjectName  (tag syntax)
//   2. The raw camelCase name as a whole word: BigThink / bigthink / BIGTHINK
//   3. The spaced display name as whole words: "Big Think" / "big think"
//      Word boundaries prevent partial matches (network ≠ work)
function makeMatchRe(name) {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const display = toDisplayName(name);
  const parts = [
    `#${esc(name)}(?![A-Za-z0-9])`,
    `\\b${esc(name)}\\b`,
  ];
  if (display !== name) parts.push(`\\b${esc(display)}\\b`);
  return new RegExp(parts.join('|'), 'i');
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
    const { data: notesRows, error: ne } = await supabase
      .from('entries').select('date, data')
      .eq('user_id', user.id).eq('type', 'notes')
      .order('date', { ascending: true });
    if (ne) throw ne;

    const matchRe = isEverything ? null : makeMatchRe(project);

    // Block-level grouping: consecutive non-empty lines form a block.
    // Include whole block if any line matches tag OR plain word OR spaced name.
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
