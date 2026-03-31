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

export function extractPlaceTags(html) {
  const tags = [];
  const re = /data-place-tag="([^"]+)"/g;
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

export function extractGoalTags(html) {
  const tags = [];
  const re = /data-goal="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) tags.push(m[1].toLowerCase().trim());
  return [...new Set(tags)];
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
// Each top-level <li data-type="taskItem"> becomes one row.
// Due dates are parsed from @YYYY-MM-DD in the plain text.
// Nested <ul data-type="taskList"> subtasks are preserved in the parent's html
// but excluded from the parent's text field.

const DUE_DATE_RE = /@(\d{4}-\d{2}-\d{2})/;

// Find the position AFTER the closing </li> that matches the <li at liStart.
// Uses depth counting to correctly skip over nested <li> elements.
function findLiEnd(html, liStart) {
  let depth = 0;
  let i = liStart;
  while (i < html.length) {
    if (html[i] === '<') {
      if (html[i + 1] === '/') {
        // Potential closing tag — check for </li>
        if (html[i + 2] === 'l' && html[i + 3] === 'i' &&
            (html[i + 4] === '>' || html[i + 4] === ' ' || html[i + 4] === '\n' || html[i + 4] === '\r')) {
          depth--;
          if (depth === 0) return html.indexOf('>', i) + 1;
        }
      } else {
        // Potential opening tag — check for <li
        if (html[i + 1] === 'l' && html[i + 2] === 'i' &&
            (html[i + 3] === ' ' || html[i + 3] === '>' || html[i + 3] === '\n' || html[i + 3] === '\r')) {
          depth++;
        }
      }
    }
    i++;
  }
  return -1;
}

export function parseTaskBlocks(html) {
  if (!html || typeof html !== 'string') return [];
  const tasks = [];
  let position = 0;

  let i = 0;
  while (i < html.length) {
    // Find next <li
    const liStart = html.indexOf('<li', i);
    if (liStart === -1) break;

    // Confirm it's truly <li (not <link, <list, etc.)
    const c3 = html[liStart + 3];
    if (c3 !== ' ' && c3 !== '>' && c3 !== '\n' && c3 !== '\r') {
      i = liStart + 3;
      continue;
    }

    // Check data-type="taskItem"
    const gtPos = html.indexOf('>', liStart);
    if (gtPos === -1) break;
    const attrs = html.slice(liStart + 3, gtPos);

    if (!attrs.includes('data-type="taskItem"')) {
      i = liStart + 3;
      continue;
    }

    // Find the TRUE matching </li> using depth-aware counting
    const liEnd = findLiEnd(html, liStart);
    if (liEnd === -1) break;

    const liHtml = html.slice(liStart, liEnd);

    // For text extraction: strip any nested <ul data-type="taskList"> subtasks
    // so the parent's text only reflects its own content, not its children's.
    // The nested subtasks are preserved intact in liHtml for storage.
    const liForText = liHtml.replace(/<ul\b[^>]*\bdata-type="taskList"[\s\S]*/i, '');

    // Convert chip spans back to token syntax for plain-text extraction
    const inner = liForText
      .replace(/<span\b[^>]*\bdata-project-tag="([^"]*)"[^>]*>[^<]*<\/span>/g, '{$1}')
      .replace(/<span\b[^>]*\bdata-note-link="([^"]*)"[^>]*>[^<]*<\/span>/g, '[$1]')
      .replace(/<span\b[^>]*\bdata-place-tag="([^"]*)"[^>]*>[^<]*<\/span>/g, '{l:$1}')
      .replace(/<span\b[^>]*\bdata-date-tag="([^"]*)"[^>]*>[^<]*<\/span>/g, '@$1')
      .replace(/<span\b[^>]*\bdata-recurrence="([^"]*)"[^>]*>[^<]*<\/span>/g, (m, key) => {
        const l = m.match(/data-recurrence-label="([^"]*)"/);
        return `{r:${key}:${l ? l[1] : key}}`;
      })
      .replace(/<span\b[^>]*\bdata-habit="([^"]*)"[^>]*>[^<]*<\/span>/g, (m, key) => {
        const l = m.match(/data-habit-label="([^"]*)"/);
        const c = m.match(/data-habit-count="(\d+)"/);
        const d = m.match(/data-habit-days="(\d+)"/);
        const label = l ? l[1] : key;
        if (d) return `{h:${key}:${label}:${d[1]}d}`;
        if (c) return `{h:${key}:${label}:${c[1]}}`;
        return `{h:${key}:${label}}`;
      })
      .replace(/<span\b[^>]*\bdata-goal="([^"]*)"[^>]*>[^<]*<\/span>/g, '{g:$1}');
    const text = inner.replace(/<[^>]+>/g, '').trim();

    // Skip empty items but still advance cursor past the full <li> (including nested)
    if (!text) { i = liEnd; continue; }

    // Prefer date from chip attribute, fall back to plain-text @YYYY-MM-DD
    const dateTagDates = extractDateTags(liHtml);
    const dueDateMatch = text.match(DUE_DATE_RE);
    // Extract tracking attributes (injected by GET /api/tasks)
    const taskIdMatch    = attrs.match(/data-task-id="([^"]+)"/);
    const originDateMatch = attrs.match(/data-origin-date="([^"]+)"/);
    const recurringMatch  = attrs.match(/data-recurring="true"/);
    const doneMatch       = attrs.match(/data-checked="(true|false)"/);
    const done            = doneMatch?.[1] === 'true';

    tasks.push({
      position:     position++,
      html:         liHtml,   // full html including any nested subtasks
      text,
      done,
      due_date:     dateTagDates[0] ?? (dueDateMatch ? dueDateMatch[1] : null),
      project_tags: extractProjectTags(liForText),
      note_tags:    extractNoteTags(liForText),
      task_id:      taskIdMatch?.[1] ?? null,
      origin_date:  originDateMatch?.[1] ?? null,
      recurring:    !!recurringMatch,
    });

    // Advance cursor past the entire <li> block (including all nested content)
    i = liEnd;
  }
  return tasks;
}

// Reconstruct task list HTML from task rows (for GET responses)
const EMPTY_TASK_LIST = '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p></p></div></li></ul>';

export function tasksToHtml(taskRows) {
  if (!taskRows || taskRows.length === 0) return EMPTY_TASK_LIST;
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
