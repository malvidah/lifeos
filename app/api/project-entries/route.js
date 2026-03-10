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

const TAG_RE = (name) => new RegExp(`#${name}(?![A-Za-z0-9])`, 'i');

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

    const tagRe = isEverything ? null : TAG_RE(project);

    // Extract journal lines
    const journalEntries = [];
    for (const row of notesRows || []) {
      const text = typeof row.data === 'string' ? row.data : '';
      if (!text.trim()) continue;
      if (!isEverything && !tagRe.test(text)) continue;
      text.split('\n').forEach((line, lineIndex) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        if (isEverything || tagRe.test(line)) {
          journalEntries.push({ date: row.date, text: trimmed, lineIndex });
        }
      });
    }

    // Tasks only for tagged projects (Everything skips tasks — too noisy)
    const taskEntries = [];
    if (!isEverything) {
      const { data: tasksRows, error: te } = await supabase
        .from('entries').select('date, data')
        .eq('user_id', user.id).eq('type', 'tasks')
        .order('date', { ascending: true });
      if (te) throw te;
      for (const row of tasksRows || []) {
        const tasks = Array.isArray(row.data) ? row.data : [];
        tasks.forEach(task => {
          if (task?.text && tagRe.test(task.text)) {
            taskEntries.push({ date: row.date, id: task.id, text: task.text, done: !!task.done });
          }
        });
      }
    }

    return Response.json({ journalEntries, taskEntries, isEverything });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
