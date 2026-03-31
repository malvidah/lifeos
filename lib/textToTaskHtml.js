// ─── Shared task-text → HTML conversion ──────────────────────────────────────
// Converts raw task text (with serialized tokens like {project}, {h:daily:Daily},
// {r:mwf:M·W·F}, {r:mwf:M·W·F:3}, {r:daily:Until Apr 1:2026-04-01}, {d:title},
// etc.) into the tiptap-compatible <li> HTML that the editor expects.
//
// /h and /r behave identically — same schedule syntax, same count/until-date
// suffixes — the only difference is the HTML attribute (data-habit vs
// data-recurrence) and the emoji (🎯 vs ↻). This means the Habits card sees
// /h tasks but not /r tasks.

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

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── Shared helpers ─────────────────────────────────────────────────────────────

/**
 * Build a {type:key:label} or {type:key:label:suffix} token string.
 * Handles three suffix forms:
 *   key = MM.DD.YYYY / YYYY-MM-DD → until-date (daily repeat until that date)
 *   suffix = "Nd"                 → days limit  (e.g. 30d)
 *   suffix = "N"                  → count limit (e.g. 2)
 */
function buildScheduleToken(type, key, suffix) {
  // Until-date: key IS the date (MM.DD.YYYY or YYYY-MM-DD)
  const dotDate = key.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  const isoDate = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dotDate || isoDate) {
    let yyyy, mm, dd;
    if (dotDate) [, mm, dd, yyyy] = dotDate;
    else         [, yyyy, mm, dd] = isoDate;
    const iso   = `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
    const label = `Until ${MONTH_NAMES[parseInt(mm,10)-1]} ${parseInt(dd,10)}`;
    return `{${type}:daily:${label}:${iso}}`;
  }
  const k     = key.toLowerCase();
  const label = SCHEDULE_MAP[k] || k;
  return suffix ? `{${type}:${k}:${label}:${suffix}}` : `{${type}:${k}:${label}}`;
}

/**
 * Render a schedule chip (<span>) from its parsed token parts.
 * type = 'h' → habit chip (data-habit, 🎯)
 * type = 'r' → recurrence chip (data-recurrence, ↻)
 *
 * Suffix rules (shared between h and r):
 *   YYYY-MM-DD → data-{type}-until  (stop appearing after this date)
 *   Nd         → data-{type}-days   (stop after N days from creation)
 *   N          → data-{type}-count  (stop after N completions)
 */
function renderScheduleChip(type, key, label, suffix) {
  const attr  = type === 'h' ? 'habit'      : 'recurrence';
  const emoji = type === 'h' ? '🎯'         : '↻';
  let extraAttrs  = '';
  let displayLabel = label;

  if (suffix) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(suffix)) {
      extraAttrs = ` data-${attr}-until="${suffix}"`;
    } else if (/^\d+d$/i.test(suffix)) {
      const days  = parseInt(suffix, 10);
      extraAttrs  = ` data-${attr}-days="${days}"`;
      displayLabel = `${label} ${days}d`;
    } else if (/^\d+$/.test(suffix)) {
      extraAttrs  = ` data-${attr}-count="${suffix}"`;
      displayLabel = `${label} ×${suffix}`;
    }
  }

  return `<span data-${attr}="${key}" data-${attr}-label="${label}"${extraAttrs}>${emoji} ${displayLabel}</span>`;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Expand slash commands into serialized tokens.
 *
 * /h and /r accept identical syntax:
 *   /h daily           → {h:daily:Daily}
 *   /h mwf 5           → {h:mwf:M·W·F:5}       (complete 5 times, then done)
 *   /h daily 30d       → {h:daily:Daily:30d}    (show for 30 days)
 *   /h 10.29.2026      → {h:daily:Until Oct 29:2026-10-29}
 *   /r mwf             → {r:mwf:M·W·F}
 *   /r mwf 2           → {r:mwf:M·W·F:2}        (appear on next 2 M/W/F)
 *   /r 10.29.2026      → {r:daily:Until Oct 29:2026-10-29}
 *
 * Other:
 *   /d <title>         → {d:title}   (drawing chip)
 *   /p <project>       → {project}
 *   /l <place>         → {l:place}
 *   /g <goal>          → {g:goal}
 */
export function expandSlashCommands(text) {
  if (!text) return text;

  // /h and /r share the same expansion logic — only the type letter differs
  for (const type of ['h', 'r']) {
    text = text.replace(
      new RegExp(`\\/${type}\\s+(\\S+)(?:\\s+(\\S+))?`, 'gi'),
      (_, key, suffix) => buildScheduleToken(type, key, suffix)
    );
  }

  // /d <drawing title> → {d:title}  (multi-word; stops before next token)
  text = text.replace(/\/d\s+([^\/{@}]+?)(?=\s*(?:\/[a-z]|\{|@|$))/gi, (_, title) => `{d:${title.trim()}}`);

  // /p <project> → {project}
  text = text.replace(/\/p\s+(\S+)/gi, (_, name) => `{${name}}`);
  // /l <place> → {l:place}
  text = text.replace(/\/l\s+(\S+)/gi, (_, name) => `{l:${name}}`);
  // /g <goal> → {g:goal}
  text = text.replace(/\/g\s+(\S+)/gi, (_, name) => `{g:${name}}`);

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

  // {h:key:label[:suffix]} and {r:key:label[:suffix]} — shared renderer
  inner = inner.replace(/\{([hr]):([^:}]+):([^:}]*)(?::([^}]*))?\}/g,
    (_, type, key, label, suffix) => renderScheduleChip(type, key, label, suffix));

  // {d:drawing-title} → drawing link chip
  inner = inner.replace(/\{d:([^}]+)\}/g, '<span data-drawing-tag="$1">✏️ $1</span>');

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
  const re   = /\{([a-z0-9][a-z0-9 ]*[a-z0-9]|[a-z0-9])\}/gi;
  let m;
  while ((m = re.exec(text || '')) !== null) {
    const skip = ['{r:', '{l:', '{h:', '{g:', '{d:'].some(p => m[0].startsWith(p));
    if (!skip) tags.push(m[1].toLowerCase());
  }
  return tags;
}

/**
 * Parse due/until date from task text.
 * Reads @YYYY-MM-DD or an until-date embedded in {h/r:key:label:YYYY-MM-DD}.
 */
export function parseDueDate(text) {
  const m1 = (text || '').match(/@(\d{4}-\d{2}-\d{2})/);
  if (m1) return m1[1];
  const m2 = (text || '').match(/\{[hr]:[^:]+:[^:]+:(\d{4}-\d{2}-\d{2})\}/);
  if (m2) return m2[1];
  return null;
}
