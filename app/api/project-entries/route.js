import { withAuth } from '../_lib/auth.js';
import { parseTasks } from '../_lib/parseTasks.js';

function makeMatchRe(storedName) {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const newFmt = `\\{${esc(storedName)}\\}`;
  const pascal = storedName.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  const camel  = storedName.split(/\s+/).join('');
  const legacyParts = new Set([pascal, camel, storedName]);
  const legacyAlts  = [...legacyParts].map(v => `#${esc(v)}(?![A-Za-z0-9])`);
  return new RegExp([newFmt, ...legacyAlts].join('|'), 'i');
}

const HEALTH_RE = /(?:\{health\}|#Health(?![A-Za-z0-9])|\b(health|workout|working out|worked out|run|ran|running|walk|walked|walking|bike|biked|biking|cycle|cycled|cycling|swim|swam|swimming|hike|hiked|hiking|gym|lift|lifted|lifting|yoga|stretch|stretching|sleep|slept|sleeping|recovery|recover|calories|calorie|nutrition|diet|meal|eat|ate|eating|exercise|exercised|exercising|weight|reps|sets|miles|km|heart rate|hrv|steps|active|activity|fitness|training|trained|train|breathwork|meditation|meditate|meditating|rest|resting|rested|sick|illness|pain|sore|soreness|energy|fatigue|tired|exhausted|hydrat|water|protein|macros|cardio|strength|endurance|mobility|flexibility|vo2|pace|distance)\b)/i;

function isValidProject(name) {
  if (name === '__everything__') return true;
  return /^[a-z0-9][a-z0-9 ]{0,38}[a-z0-9]$|^[a-z0-9]$/.test(name);
}

export const GET = withAuth(async (req, { supabase, user }) => {
  const project = new URL(req.url).searchParams.get('project');
  if (!project || !isValidProject(project))
    return Response.json({ error: 'invalid project name', got: project }, { status: 400 });

  const isEverything = project === '__everything__';

  const { data: notesRows, error: ne } = await supabase
    .from('entries').select('date, data')
    .eq('user_id', user.id).eq('type', 'journal')
    .order('date', { ascending: true });
  if (ne) throw ne;

  const matchRe = isEverything ? null : makeMatchRe(project);

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
      if (!matchRe || block.some(l => matchRe.test(l.text)))
        block.forEach(l => journalEntries.push({ date: row.date, text: l.text, lineIndex: l.lineIndex }));
    }
  }

  const { data: tasksRows, error: te } = await supabase
    .from('entries').select('date, data')
    .eq('user_id', user.id).eq('type', 'tasks')
    .order('date', { ascending: true });
  if (te) throw te;

  const taskEntries = [];
  for (const row of tasksRows || []) {
    for (const task of parseTasks(row.data)) {
      if (!matchRe || matchRe.test(task.text))
        taskEntries.push({ date: row.date, id: task.id, text: task.text, done: task.done });
    }
  }

  return Response.json({ journalEntries, taskEntries, isEverything });
});
