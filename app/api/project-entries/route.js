import { createClient } from '@supabase/supabase-js';
import { parseTasks } from '../_lib/parseTasks.js';

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

// Project names are stored lowercase, possibly with spaces: "big think", "day lab", "audian"
// Build a regex that matches both storage formats:
//   new: {projectname}  e.g. {big think}
//   legacy: #ProjectName  e.g. #BigThink  (during migration window)
function makeMatchRe(storedName) {
  // storedName is lowercase, may have spaces: "big think"
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // New format: {big think} — exact match of stored name inside braces
  const newFmt = `\\{${esc(storedName)}\\}`;

  // Legacy format: #BigThink — reconstruct camelCase or PascalCase from stored name
  // "big think" → "BigThink" or "bigthink"
  const pascal = storedName.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  const camel  = storedName.split(/\s+/).join('');
  const legacyParts = new Set([pascal, camel, storedName]);
  const legacyAlts  = [...legacyParts].map(v => `#${esc(v)}(?![A-Za-z0-9])`);

  return new RegExp([newFmt, ...legacyAlts].join('|'), 'i');
}

// Health project: {health} tag (new) + #Health (legacy) + broad keyword set
const HEALTH_RE = /(?:\{health\}|#Health(?![A-Za-z0-9])|\b(health|workout|working out|worked out|run|ran|running|walk|walked|walking|bike|biked|biking|cycle|cycled|cycling|swim|swam|swimming|hike|hiked|hiking|gym|lift|lifted|lifting|yoga|stretch|stretching|sleep|slept|sleeping|recovery|recover|calories|calorie|nutrition|diet|meal|eat|ate|eating|exercise|exercised|exercising|weight|reps|sets|miles|km|heart rate|hrv|steps|active|activity|fitness|training|trained|train|breathwork|meditation|meditate|meditating|rest|resting|rested|sick|illness|pain|sore|soreness|energy|fatigue|tired|exhausted|hydrat|water|protein|macros|cardio|strength|endurance|mobility|flexibility|vo2|pace|distance)\b)/i;

// Validate stored project name: lowercase letters, digits, spaces — 1-40 chars
// e.g. "big think", "audian", "day lab", "__everything__", "__health__"
function isValidProject(name) {
  if (name === '__everything__' || name === '__health__') return true;
  return /^[a-z0-9][a-z0-9 ]{0,38}[a-z0-9]$|^[a-z0-9]$/.test(name);
}

export async function GET(req) {
  const { supabase } = getUserClient(req);
  if (!supabase) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const project = searchParams.get('project');

  if (!project || !isValidProject(project)) {
    return Response.json({ error: 'invalid project name', got: project }, { status: 400 });
  }

  const isEverything = project === '__everything__';
  const isHealth     = project === '__health__';

  try {
    const { data: notesRows, error: ne } = await supabase
      .from('entries').select('date, data')
      .eq('user_id', user.id).eq('type', 'journal')
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
    // parseTasks handles both old [{id,text,done}] JSON and new TipTap HTML string formats
    for (const row of tasksRows || []) {
      for (const task of parseTasks(row.data)) {
        if (!matchRe || matchRe.test(task.text)) {
          taskEntries.push({ date: row.date, id: task.id, text: task.text, done: task.done });
        }
      }
    }

    return Response.json({ journalEntries, taskEntries, isEverything, isHealth });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
