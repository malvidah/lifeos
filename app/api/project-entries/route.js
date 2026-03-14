import { withAuth } from '../_lib/auth.js';

// GET /api/project-entries?project=big+think[&terms=sleep,running]
//   Returns all content tagged to that project, split by type.
//   Special value: __everything__ (all content, no tag filter).
//   `terms` is a comma-separated list of extra search strings (from LOOK FOR settings).
//
// Data lives in `journal_blocks` and `tasks` tables (new schema).
//
// Response shape:
//   { journalEntries, taskEntries, notes, isEverything }
//
// journalEntries: [{ date, lineIndex, text, project_tags }]
// taskEntries:    [{ date, id, text, done, project_tags }]
// notes:          [] (notes are loaded client-side via useDbSave)

function isValidProject(name) {
  if (name === '__everything__') return true;
  return /^[a-z0-9][a-z0-9 ]{0,38}[a-z0-9]$|^[a-z0-9]$/.test(name);
}

// Convert TipTap HTML to plain text, preserving {project} and [note] markers
function htmlToText(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<span[^>]*data-project-tag="([^"]+)"[^>]*>[^<]*<\/span>/g, '{$1}')
    .replace(/<span[^>]*data-note-link="([^"]+)"[^>]*>[^<]*<\/span>/g, '[$1]')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

// Extract {project} tags from text
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

export const GET = withAuth(async (req, { supabase, user }) => {
  const params  = new URL(req.url).searchParams;
  const project = params.get('project');
  const terms   = (params.get('terms') || '').split(',').map(t => t.trim()).filter(Boolean);

  if (!project || !isValidProject(project))
    return Response.json({ error: 'invalid project name', got: project }, { status: 400 });

  const isEverything = project === '__everything__';

  // ── Fetch from new typed tables ─────────────────────────────────────────────
  const journalQuery = supabase.from('journal_blocks')
    .select('id, date, position, content, project_tags, note_tags')
    .eq('user_id', user.id)
    .order('date', { ascending: true })
    .order('position', { ascending: true });

  const tasksQuery = supabase.from('tasks')
    .select('id, date, position, text, html, done, project_tags, note_tags')
    .eq('user_id', user.id)
    .order('date', { ascending: true })
    .order('position', { ascending: true });

  // For specific projects, filter by project_tags using contains
  if (!isEverything) {
    journalQuery.contains('project_tags', [project.toLowerCase()]);
    tasksQuery.contains('project_tags', [project.toLowerCase()]);
  }

  const [journalR, tasksR] = await Promise.all([journalQuery, tasksQuery]);
  if (journalR.error) throw journalR.error;
  if (tasksR.error)   throw tasksR.error;

  // ── Journal blocks → entries ──────────────────────────────────────────────
  const journalEntries = [];
  // Group blocks by date to compute lineIndex
  const blocksByDate = {};
  for (const block of (journalR.data || [])) {
    if (!blocksByDate[block.date]) blocksByDate[block.date] = [];
    blocksByDate[block.date].push(block);
  }
  for (const [date, blocks] of Object.entries(blocksByDate)) {
    blocks.forEach((block, lineIndex) => {
      const text = htmlToText(block.content);
      if (!text) return;
      const tags = block.project_tags || extractTags(text);
      const matchesProject = isEverything || tags.includes(project);
      const matchesTerms = terms.length > 0 && terms.some(t => text.toLowerCase().includes(t.toLowerCase()));
      if (matchesProject || (!isEverything && matchesTerms)) {
        journalEntries.push({ date, lineIndex, text, project_tags: tags, blockLength: 1 });
      }
    });
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────
  const taskEntries = [];
  for (const task of (tasksR.data || [])) {
    const text = task.text || htmlToText(task.html);
    if (!text) continue;
    const tags = task.project_tags || extractTags(text);
    const matchesProject = isEverything || tags.includes(project);
    const matchesTerms = terms.length > 0 && terms.some(t => text.toLowerCase().includes(t.toLowerCase()));
    if (matchesProject || (!isEverything && matchesTerms)) {
      taskEntries.push({ date: task.date, id: task.id, text, done: task.done, project_tags: tags });
    }
  }

  // ── Also check legacy entries table for older data ─────────────────────────
  // This ensures data written before the migration still shows up.
  try {
    const [legacyJournal, legacyTasks] = await Promise.all([
      supabase.from('entries').select('date, data')
        .eq('user_id', user.id).eq('type', 'journal')
        .order('date', { ascending: true }),
      supabase.from('entries').select('date, data')
        .eq('user_id', user.id).eq('type', 'tasks')
        .order('date', { ascending: true }),
    ]);

    // Only include legacy entries for dates NOT already covered by new tables
    const journalDates = new Set(Object.keys(blocksByDate));
    const taskDates = new Set((tasksR.data || []).map(t => t.date));

    for (const row of (legacyJournal.data || [])) {
      if (journalDates.has(row.date)) continue;
      const text = typeof row.data === 'string' ? row.data : '';
      if (!text) continue;
      text.split('\n').forEach((line, lineIndex) => {
        if (!line.trim()) return;
        const tags = extractTags(line);
        const matchesProject = isEverything || tags.includes(project);
        const matchesTerms = terms.length > 0 && terms.some(t => line.toLowerCase().includes(t.toLowerCase()));
        if (matchesProject || (!isEverything && matchesTerms)) {
          journalEntries.push({ date: row.date, lineIndex, text: line, project_tags: tags });
        }
      });
    }

    for (const row of (legacyTasks.data || [])) {
      if (taskDates.has(row.date)) continue;
      const tasks = parseLegacyTasks(row.data);
      tasks.forEach(task => {
        const tags = extractTags(task.text);
        const matchesProject = isEverything || tags.includes(project);
        const matchesTerms = terms.length > 0 && terms.some(t => task.text.toLowerCase().includes(t.toLowerCase()));
        if (matchesProject || (!isEverything && matchesTerms)) {
          taskEntries.push({ date: row.date, id: task.id, text: task.text, done: task.done, project_tags: tags });
        }
      });
    }
  } catch (_) { /* entries table might not exist or have different schema */ }

  return Response.json({
    journalEntries,
    taskEntries,
    notes: [],
    isEverything,
  });
});

// Parse legacy task data from entries table (old JSON array or old TipTap HTML)
function parseLegacyTasks(data) {
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
      const text = htmlToText(m[2]);
      if (text) tasks.push({ id: `html_${idx++}`, text, done: m[1] === 'true' });
    }
    return tasks;
  }
  return [];
}
