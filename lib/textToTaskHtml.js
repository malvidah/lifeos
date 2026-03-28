// ─── Shared task-text → HTML conversion ──────────────────────────────────────
// Converts raw task text (with serialized tokens like {project}, {h:daily:Daily},
// {r:mwf:M·W·F}, etc.) into the tiptap-compatible <li> HTML that the editor expects.
//
// Also expands common slash shorthands (/h daily, /r mwf, /p project) into
// serialized token form before rendering, so voice-action and other non-editor
// entry points produce correct HTML.

const SCHEDULE_MAP = {
  daily:    'Daily',
  weekdays: 'M·T·W·R·F',
  mwf:      'M·W·F',
  tr:       'T·R',
  rf:       'R·F',
  weekends: 'S·U',
  mon:      'M', tue: 'T', wed: 'W', thu: 'R', thurs: 'R', fri: 'F',
  sat:      'S', sun: 'U',
  '1pw':    '1/week', '2pw': '2/week', '3pw': '3/week',
};

/**
 * Expand slash commands (/h daily, /r mwf, /p name) into serialized tokens.
 */
export function expandSlashCommands(text) {
  if (!text) return text;
  // /h <schedule> → {h:schedule:Label}
  text = text.replace(/\/h\s+(\S+)/gi, (_, key) => {
    const k = key.toLowerCase();
    const label = SCHEDULE_MAP[k] || k;
    return `{h:${k}:${label}}`;
  });
  // /r <schedule> → {r:schedule:Label}
  text = text.replace(/\/r\s+(\S+)/gi, (_, key) => {
    const k = key.toLowerCase();
    const label = SCHEDULE_MAP[k] || k;
    return `{r:${k}:${label}}`;
  });
  // /p <project> → {project}
  text = text.replace(/\/p\s+(\S+)/gi, (_, name) => `{${name}}`);
  // /l <place> → {l:place}
  text = text.replace(/\/l\s+(\S+)/gi, (_, name) => `{l:${name}}`);
  // /g <goal> → {g:goal}
  text = text.replace(/\/g\s+(\S+)/gi, (_, name) => `{g:${name}}`);
  // /d <date> → @date
  text = text.replace(/\/d\s+(\d{4}-\d{2}-\d{2})/gi, (_, d) => `@${d}`);
  return text;
}

/**
 * Convert task text with serialized tokens into tiptap-compatible HTML.
 * @param {string} rawText  — task text (with {project}, {h:key:label}, etc.)
 * @param {boolean} done    — whether the task is checked
 * @returns {string} HTML <li> element
 */
export function textToTaskHtml(rawText, done = false) {
  let inner = (rawText || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  inner = inner.replace(/\{r:([^:}]+):([^}]*)\}/g, '<span data-recurrence="$1" data-recurrence-label="$2">↻ $2</span>');
  inner = inner.replace(/\{h:([^:}]+):([^}]*)\}/g, (match, key, rest) => {
    const segs = rest.split(':');
    const lastSeg = segs[segs.length - 1];
    const hasDays = segs.length > 1 && /^\d+d$/i.test(lastSeg);
    const hasCount = !hasDays && segs.length > 1 && /^\d+$/.test(lastSeg);
    const days = hasDays ? parseInt(lastSeg, 10) : null;
    const count = hasCount ? lastSeg : null;
    const label = (hasDays || hasCount) ? segs.slice(0, -1).join(':') : rest;
    const displayLabel = count ? `${label} ×${count}` : days ? `${label} ${days}d` : label;
    const countAttr = count ? ` data-habit-count="${count}"` : '';
    const daysAttr = days ? ` data-habit-days="${days}"` : '';
    return `<span data-habit="${key}" data-habit-label="${label}"${countAttr}${daysAttr}>🎯 ${displayLabel}</span>`;
  });
  inner = inner.replace(/\{l:([^}]+)\}/g, '<span data-place-tag="$1">📍 $1</span>');
  inner = inner.replace(/\{g:([^}]+)\}/g, '<span data-goal="$1">🏁 $1</span>');
  inner = inner.replace(/\{([a-z0-9][a-z0-9 ]*[a-z0-9]|[a-z0-9])\}/gi, '<span data-project-tag="$1">⛰️ $1</span>');
  inner = inner.replace(/@(\d{4}-\d{2}-\d{2})/g, '<span data-date-tag="$1">⏳ $1</span>');
  inner = inner.replace(/\[([^\]]+)\]/g, '<span data-note-link="$1">$1</span>');
  return `<li data-type="taskItem" data-checked="${done ? 'true' : 'false'}"><label><input type="checkbox"${done ? ' checked="checked"' : ''}><span></span></label><div><p>${inner}</p></div></li>`;
}

/**
 * Parse project tags from task text.
 */
export function parseProjectTags(text) {
  const tags = [];
  const re = /\{([a-z0-9][a-z0-9 ]*[a-z0-9]|[a-z0-9])\}/gi;
  let m;
  while ((m = re.exec(text || '')) !== null) {
    if (!m[0].startsWith('{r:') && !m[0].startsWith('{l:') && !m[0].startsWith('{h:') && !m[0].startsWith('{g:')) {
      tags.push(m[1].toLowerCase());
    }
  }
  return tags;
}

/**
 * Parse due date from task text.
 */
export function parseDueDate(text) {
  const m = (text || '').match(/@(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}
