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

function toDisplayName(name) {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

// Match rules:
// 1. Always match #TagName (case-insensitive) — this is the authoritative form
// 2. For multi-word display names (DayLab → "Day Lab"): also match the phrase "Day Lab"
//    This lets entries that mention "Day Lab" without the # show in the project view.
// Single-word names only match via #tag to avoid false positives (e.g. #can ≠ "can't").
function makeMatchRe(name) {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const display = toDisplayName(name);
  // #tag match — case insensitive, must not be followed by alphanumeric
  const parts = [`#${esc(name)}(?![A-Za-z0-9])`];
  // Multi-word display name phrase match
  if (display !== name && display.includes(' ')) {
    parts.push(`\\b${esc(display)}\\b`);
  }
  return new RegExp(parts.join('|'), 'i');
}

// Health project: broad keyword set covering fitness, body, wellness mentions
const HEALTH_RE = /\b(health|workout|working out|worked out|run|ran|running|walk|walked|walking|bike|biked|biking|cycle|cycled|cycling|swim|swam|swimming|hike|hiked|hiking|gym|lift|lifted|lifting|yoga|stretch|stretching|sleep|slept|sleeping|recovery|recover|calories|calorie|nutrition|diet|meal|eat|ate|eating|exercise|exercised|exercising|weight|reps|sets|miles|km|heart rate|hrv|steps|active|activity|fitness|training|trained|train|breathwork|meditation|meditate|meditating|rest|resting|rested|sick|illness|pain|sore|soreness|energy|fatigue|tired|exhausted|hydrat|water|protein|macros|cardio|strength|endurance|mobility|flexibility|vo2|pace|distance)\b/i;

export async function GET(req) {
  const { supabase } = getUserClient(req);
  if (!supabase) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const project = searchParams.get('project');
  const isEverything = project === '__everything__';
  const isHealth = project === '__health__';

  if (!project || (!isEverything && !isHealth && !/^[A-Za-z][A-Za-z0-9]+$/.test(project))) {
    return Response.json({ error: 'invalid project name' }, { status: 400 });
  }

  try {
    const { data: notesRows, error: ne } = await supabase
      .from('entries').select('date, data')
      .eq('user_id', user.id).eq('type', 'notes')
      .order('date', { ascending: true });
    if (ne) throw ne;

    const matchRe = isEverything ? null : isHealth ? HEALTH_RE : makeMatchRe(project);

    const journalEntries = [];
    for (const row of notesRows || []) {
      const text = typeof row.data === 'string' ? row.data : '';
      if (!text.trim()) continue;
      if (matchRe && !matchRe.test(text)) continue;

      const lines = text.split('\n');
      let i = 0;
      while (i < lines.length) {
        if (!lines[i].trim()) { i++; continue; }
        const block = [];
        while (i < lines.length && lines[i].trim()) {
          block.push({ text: lines[i].trim(), lineIndex: i });
          i++;
        }
        if (!matchRe || block.some(l => matchRe.test(l.text))) {
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
        if (!matchRe || matchRe.test(task.text)) {
          taskEntries.push({ date: row.date, id: task.id, text: task.text, done: !!task.done });
        }
      });
    }

    return Response.json({ journalEntries, taskEntries, isEverything, isHealth });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
