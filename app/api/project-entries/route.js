import { withAuth } from '../_lib/auth.js';
import { extractTags } from '@/lib/tags';

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
        journalEntries.push({ date, lineIndex, text, content: block.content, project_tags: tags, blockLength: 1 });
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

  return Response.json({
    journalEntries,
    taskEntries,
    notes: [],
    isEverything,
  });
});
