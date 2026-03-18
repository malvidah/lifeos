/**
 * parseBlocks.js — server-side utilities for converting TipTap HTML
 * into typed DB rows (journal_blocks, tasks, meal_items).
 *
 * Used by API routes on save. The frontend never calls these directly.
 */

// ── Tag extractors ────────────────────────────────────────────────────────────

export function extractProjectTags(html) {
  const tags = [];
  const re = /data-project-tag="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) tags.push(m[1].toLowerCase().trim());
  return [...new Set(tags)];
}

export function extractNoteTags(html) {
  const tags = [];
  const re = /data-note-link="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) tags.push(m[1].trim());
  return [...new Set(tags)];
}

export function extractDateTags(html) {
  const dates = [];
  const re = /data-date-tag="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) dates.push(m[1].trim());
  return [...new Set(dates)];
}

// ── Journal: HTML → [{position, content, project_tags, note_tags}] ───────────
// Each <p>…</p> block becomes one row. Empty paragraphs are skipped.

export function parseJournalBlocks(html) {
  if (!html || typeof html !== 'string') return [];
  const blocks = [];
  let position = 0;
  // Match <p>...</p> blocks and <div data-imageblock="..."> image blocks
  const blockRe = /<p\b[^>]*>([\s\S]*?)<\/p>|<div\s+data-imageblock="([^"]*)"[^>]*>[\s\S]*?<\/div>/gi;
  let m;
  while ((m = blockRe.exec(html)) !== null) {
    if (m[2] != null) {
      // Image block — store the whole div as content
      blocks.push({
        position: position++,
        content:  m[0],
        project_tags: [],
        note_tags:    [],
      });
    } else {
      const inner = m[1].replace(/<[^>]+>/g, '').trim();
      // Keep empty paragraphs (spacer lines) — trim trailing ones after the loop
      blocks.push({
        position:     position++,
        content:      m[0],
        project_tags: inner ? extractProjectTags(m[0]) : [],
        note_tags:    inner ? extractNoteTags(m[0]) : [],
        _empty:       !inner,
      });
    }
  }
  // Strip trailing empty paragraphs (cursor artifact), keep internal spacers
  while (blocks.length && blocks[blocks.length - 1]._empty) blocks.pop();
  // Clean up internal flag and re-index positions
  return blocks.map((b, i) => { const { _empty, ...rest } = b; return { ...rest, position: i }; });
}

// ── Tasks: HTML → [{position, html, text, done, due_date, project_tags, note_tags}] ──
// Each <li data-type="taskItem"> becomes one row.
// Due dates are parsed from @YYYY-MM-DD in the plain text.

const DUE_DATE_RE = /@(\d{4}-\d{2}-\d{2})/;

export function parseTaskBlocks(html) {
  if (!html || typeof html !== 'string') return [];
  const tasks = [];
  let position = 0;
  const liRe = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRe.exec(html)) !== null) {
    const attrs = m[1];
    if (!attrs.includes('data-type="taskItem"')) continue;
    const doneMatch = attrs.match(/data-checked="(true|false)"/);
    const done = doneMatch?.[1] === 'true';
    const liHtml = m[0];

    // Convert chip spans back to token syntax for plain-text extraction
    const inner = m[2]
      .replace(/<span\b[^>]*\bdata-project-tag="([^"]*)"[^>]*>[^<]*<\/span>/g, '{$1}')
      .replace(/<span\b[^>]*\bdata-note-link="([^"]*)"[^>]*>[^<]*<\/span>/g, '[$1]')
      .replace(/<span\b[^>]*\bdata-date-tag="([^"]*)"[^>]*>[^<]*<\/span>/g, '@$1')
      .replace(/<span\b[^>]*\bdata-recurrence="([^"]*)"[^>]*>[^<]*<\/span>/g, '/r $1');
    const text = inner.replace(/<[^>]+>/g, '').trim();
    if (!text) continue;

    // Prefer date from chip attribute, fall back to plain-text @YYYY-MM-DD
    const dateTagDates = extractDateTags(liHtml);
    const dueDateMatch = text.match(DUE_DATE_RE);
    // Extract tracking attributes (injected by GET /api/tasks)
    const taskIdMatch = attrs.match(/data-task-id="([^"]+)"/);
    const originDateMatch = attrs.match(/data-origin-date="([^"]+)"/);

    const recurringMatch = attrs.match(/data-recurring="true"/);
    tasks.push({
      position:     position++,
      html:         liHtml,
      text,
      done,
      due_date:     dateTagDates[0] ?? (dueDateMatch ? dueDateMatch[1] : null),
      project_tags: extractProjectTags(liHtml),
      note_tags:    extractNoteTags(liHtml),
      task_id:      taskIdMatch?.[1] ?? null,
      origin_date:  originDateMatch?.[1] ?? null,
      recurring:    !!recurringMatch,
    });
  }
  return tasks;
}

// Reconstruct task list HTML from task rows (for GET responses)
export function tasksToHtml(taskRows) {
  if (!taskRows || taskRows.length === 0) return '';
  const items = taskRows
    .sort((a, b) => a.position - b.position)
    .map(t => t.html || `<li data-type="taskItem" data-checked="${t.done ? 'true' : 'false'}"><p>${escHtml(t.text)}</p></li>`)
    .join('');
  return `<ul data-type="taskList">${items}</ul>`;
}

// ── Meals: items array → meal_items rows ─────────────────────────────────────
// Meals are stored as [{id, text, kcal, protein}] arrays (not HTML).
// This normalises them into DB row shape.

export function parseMealItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter(r => r?.text?.trim())
    .map((r, position) => ({
      position,
      content:     r.text.trim(),
      ai_calories: r.kcal   ? Math.round(r.kcal)    : null,
      ai_protein:  r.protein ? Math.round(r.protein) : null,
      // front-end row ID stored so round-trips preserve the same rows
      client_id:   r.id ?? null,
    }));
}

// Reconstruct meals array from meal_items rows (for GET responses)
export function mealItemsToArray(rows) {
  return (rows || [])
    .sort((a, b) => a.position - b.position)
    .map(r => ({
      id:      r.id,      // DB uuid — frontend uses as stable key
      text:    r.content,
      kcal:    r.ai_calories ?? null,
      protein: r.ai_protein  ?? null,
    }));
}

// ── Title extraction ─────────────────────────────────────────────────────────
// Extracts a plain-text title from TipTap HTML (H1 or first line).

export function extractTitle(html) {
  if (!html) return '';
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  if (m) return m[1].replace(/<[^>]+>/g, '').trim();
  return html.replace(/<[^>]+>/g, '').split('\n')[0].trim().slice(0, 200);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
