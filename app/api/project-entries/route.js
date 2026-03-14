import { withAuth } from '../_lib/auth.js';

// GET /api/project-entries?project=big+think[&terms=sleep,running]
//   Returns all content tagged to that project, split by type.
//   Special value: __everything__ (all content, no tag filter).
//   `terms` is a comma-separated list of extra search strings (from LOOK FOR settings).
//
// Data lives in the `entries` table (type='journal' and type='tasks').
// Journal entries: one row per day, data = plain text with \n-separated lines.
//   Project tags are stored as {tagname} in the text.
// Task entries: one row per day, data = HTML string (TipTap) or old [{id,text,done}] array.
//
// Response shape:
//   { journalEntries, taskEntries, notes, isEverything }
//
// journalEntries: [{ date, lineIndex, text, project_tags }]
// taskEntries:    [{ date, id, text, done, project_tags }]
// notes:          [] (notes are loaded client-side via useDbSave)

// ── Tag extraction — mirrors lib/tags.js ────────────────────────────────────
function extractTags(text) {
  if (!text || typeof text !== 'string') return [];
  const seen = new Set(); const tags = [];
  const reNew = /\{([a-z0-9][a-z0-9 ]*[a-z0-9]|[a-z0-9])\}/g;
  let m;
  while ((m = reNew.exec(text)) !== null) {
    const lower = m[1].toLowerCase();
    if (!seen.has(lower)) { seen.add(lower); tags.push(lower); }
  }
  const reLegacy = /#([A-Za-z][A-Za-z0-9]+)(?![A-Za-z0-9])/g;
  while ((m = reLegacy.exec(text)) !== null) {
    const lower = m[1].toLowerCase();
    if (!seen.has(lower)) { seen.add(lower); tags.push(lower); }
  }
  return tags;
}

// Convert TipTap task HTML to plain text, preserving {project} markers
function taskHtmlToText(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<span[^>]*data-project-tag="([^"]+)"[^>]*>[^<]*<\/span>/g, '{$1}')
    .replace(/<span[^>]*data-note-link="([^"]+)"[^>]*>[^<]*<\/span>/g, '[$1]')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

// Parse task data — handles old JSON array and new TipTap HTML
function parseTasks(data) {
  if (Array.isArray(data)) {
    return data.filter(t => t?.text).map((t, i) => ({
      id: t.id ?? `old_${i}`, text: t.text, done: !!t.done,
    }));
  }
  if (typeof data === 'string' && data.includes('data-type="taskItem"')) {
    const tasks = [];
    const liRe = /<li[^>]*data-type="taskItem"[^>]*data-checked="(true|false)"[^>]*>([\s\S]*?)<\/li>/g;
    let m, idx = 0;
    while ((m = liRe.exec(data)) !== null) {
      const text = taskHtmlToText(m[2]);
      if (text) tasks.push({ id: `html_${idx++}`, text, done: m[1] === 'true' });
    }
    return tasks;
  }
  return [];
}

function isValidProject(name) {
  if (name === '__everything__') return true;
  return /^[a-z0-9][a-z0-9 ]{0,38}[a-z0-9]$|^[a-z0-9]$/.test(name);
}

export const GET = withAuth(async (req, { supabase, user }) => {
  const params  = new URL(req.url).searchParams;
  const project = params.get('project');
  const terms   = (params.get('terms') || '').split(',').map(t => t.trim()).filter(Boolean);

  if (!project || !isValidProject(project))
    return Response.json({ error: 'invalid project name', got: project }, { status: 400 });

  const isEverything = project === '__everything__';

  // Fetch raw journal and task entries from the entries table
  const [journalR, tasksR] = await Promise.all([
    supabase.from('entries')
      .select('date, data')
      .eq('user_id', user.id)
      .eq('type', 'journal')
      .order('date', { ascending: true }),
    supabase.from('entries')
      .select('date, data')
      .eq('user_id', user.id)
      .eq('type', 'tasks')
      .order('date', { ascending: true }),
  ]);

  if (journalR.error) throw journalR.error;
  if (tasksR.error)   throw tasksR.error;

  // ── Journal: split each day's text into lines, filter by project/terms ──────
  const journalEntries = [];
  for (const row of (journalR.data || [])) {
    const text = typeof row.data === 'string' ? row.data : '';
    if (!text) continue;
    const lines = text.split('\n');
    lines.forEach((line, lineIndex) => {
      if (!line.trim()) return;
      const tags = extractTags(line);
      const matchesProject = isEverything || tags.includes(project);
      const matchesTerms   = terms.length > 0 && terms.some(t => line.toLowerCase().includes(t.toLowerCase()));
      if (matchesProject || (!isEverything && matchesTerms)) {
        journalEntries.push({ date: row.date, lineIndex, text: line, project_tags: tags });
      }
    });
  }

  // ── Tasks: parse each day's tasks, filter by project/terms ──────────────────
  const taskEntries = [];
  for (const row of (tasksR.data || [])) {
    const tasks = parseTasks(row.data);
    tasks.forEach(task => {
      const tags = extractTags(task.text);
      const matchesProject = isEverything || tags.includes(project);
      const matchesTerms   = terms.length > 0 && terms.some(t => task.text.toLowerCase().includes(t.toLowerCase()));
      if (matchesProject || (!isEverything && matchesTerms)) {
        taskEntries.push({ date: row.date, id: task.id, text: task.text, done: task.done, project_tags: tags });
      }
    });
  }

  return Response.json({
    journalEntries,
    taskEntries,
    notes: [],
    isEverything,
  });
});
