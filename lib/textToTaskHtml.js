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

const MONTH_NUMS = {
  jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
  january:1, february:2, march:3, april:4, june:6, july:7, august:8,
  september:9, october:10, november:11, december:12,
};

// ── Shared helpers ─────────────────────────────────────────────────────────────

/**
 * Try to parse a string (or two adjacent words) as a date.
 * Handles: YYYY-MM-DD, MM.DD.YYYY, MM/DD/YYYY, MM/DD, MM.DD,
 *          "Month DD [YYYY]", "DD Month [YYYY]".
 * Returns YYYY-MM-DD string or null.
 */
function parseNaturalDate(str) {
  if (!str) return null;
  const s = str.trim().toLowerCase().replace(/,/g, '');

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // MM/DD/YYYY or MM/DD (slash-separated)
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (slash) {
    let [, mm, dd, yyyy] = slash;
    if (!yyyy) yyyy = new Date().getFullYear();
    else if (String(yyyy).length === 2) yyyy = '20' + yyyy;
    return `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
  }

  // MM.DD.YYYY or MM.DD (dot-separated)
  const dot = s.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/);
  if (dot) {
    let [, mm, dd, yyyy] = dot;
    if (!yyyy) yyyy = new Date().getFullYear();
    else if (String(yyyy).length === 2) yyyy = '20' + yyyy;
    return `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
  }

  // "Month DD [YYYY]"  e.g. "april 10", "apr 10 2026"
  const md = s.match(/^([a-z]+)\s+(\d{1,2})(?:\s+(\d{4}))?$/);
  if (md) {
    const mm = MONTH_NUMS[md[1]];
    if (mm) {
      const yyyy = md[3] || new Date().getFullYear();
      return `${yyyy}-${String(mm).padStart(2,'0')}-${String(md[2]).padStart(2,'0')}`;
    }
  }

  // "DD Month [YYYY]"  e.g. "10 april", "10 apr 2026"
  const dm = s.match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/);
  if (dm) {
    const mm = MONTH_NUMS[dm[2]];
    if (mm) {
      const yyyy = dm[3] || new Date().getFullYear();
      return `${yyyy}-${String(mm).padStart(2,'0')}-${String(dm[1]).padStart(2,'0')}`;
    }
  }

  return null;
}

/**
 * Build a {type:key:label[:suffix]} token from the full input string after /r or /h.
 *
 * Supported forms (all work for both /r and /h):
 *   "daily"              → schedule only
 *   "mwf"               → schedule only
 *   "april 10"          → daily, until Apr 10 (current year)
 *   "april 10 2026"     → daily, until Apr 10 2026
 *   "04/10/2026"        → daily, until Apr 10 2026
 *   "04/10"             → daily, until Apr 10 (current year)
 *   "10.29.2026"        → daily, until Oct 29 2026 (legacy dot format)
 *   "2026-04-10"        → daily, until Apr 10 2026 (ISO)
 *   "5 days"            → daily, show for 5 days from creation
 *   "daily april 10"    → daily schedule, until Apr 10
 *   "mwf april 10"      → M·W·F schedule, until Apr 10
 *   "mwf 5 days"        → M·W·F schedule, for 5 days
 *   "mwf 5"             → M·W·F, count limit 5
 *   "mwf 30d"           → M·W·F, days limit 30
 */
function buildScheduleToken(type, rawInput) {
  const input = (rawInput || '').trim();

  // ── 1. Whole input is a formatted date ────────────────────────────────────
  const wholeDate = parseNaturalDate(input);
  if (wholeDate) {
    const [, yyyy, mm, dd] = wholeDate.match(/(\d{4})-(\d{2})-(\d{2})/);
    const label = `Until ${MONTH_NAMES[parseInt(mm,10)-1]} ${parseInt(dd,10)}`;
    return `{${type}:daily:${label}:${wholeDate}}`;
  }

  // ── 2. "N days" with no schedule prefix ───────────────────────────────────
  const justDays = input.match(/^(\d+)\s+days?$/i);
  if (justDays) return `{${type}:daily:Daily:${justDays[1]}d}`;

  // ── 3. Schedule key + optional suffix ─────────────────────────────────────
  const spaceIdx = input.indexOf(' ');
  if (spaceIdx === -1) {
    // Single token — schedule key only
    const k = input.toLowerCase();
    const label = SCHEDULE_MAP[k] || k;
    return `{${type}:${k}:${label}}`;
  }

  const key  = input.slice(0, spaceIdx).toLowerCase();
  const rest = input.slice(spaceIdx + 1).trim();
  const scheduleLabel = SCHEDULE_MAP[key] || key;

  // 3a. Rest is a date (any format, including natural language)
  const dateStr = parseNaturalDate(rest);
  if (dateStr) {
    const [, yyyy, mm, dd] = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    const untilLabel = `Until ${MONTH_NAMES[parseInt(mm,10)-1]} ${parseInt(dd,10)}`;
    return `{${type}:${key}:${scheduleLabel} ${untilLabel}:${dateStr}}`;
  }

  // 3b. "N days" suffix  e.g. "daily 5 days"
  const restDays = rest.match(/^(\d+)\s+days?$/i);
  if (restDays) return `{${type}:${key}:${scheduleLabel}:${restDays[1]}d}`;

  // 3c. Legacy: Nd (days) or N (count) — single token suffix
  return `{${type}:${key}:${scheduleLabel}:${rest}}`;
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

  // Repeated tasks default to 1 completion when no explicit limit is given.
  // Habits are infinite — no default count applied.
  // The implicit ×1 is not shown in the label to keep the UI clean; the behaviour
  // (task disappears after one check-off) matches user expectation for /r tasks.
  const effectiveSuffix = (!suffix && type === 'r') ? '1' : suffix;

  if (effectiveSuffix) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(effectiveSuffix)) {
      extraAttrs = ` data-${attr}-until="${effectiveSuffix}"`;
    } else if (/^\d+d$/i.test(effectiveSuffix)) {
      const days  = parseInt(effectiveSuffix, 10);
      extraAttrs  = ` data-${attr}-days="${days}"`;
      displayLabel = `${label} ${days}d`;
    } else if (/^\d+$/.test(effectiveSuffix)) {
      const count = parseInt(effectiveSuffix, 10);
      extraAttrs  = ` data-${attr}-count="${count}"`;
      // Only show ×N when an explicit count > 1 was given; hide the implicit default.
      if (suffix && count > 1) displayLabel = `${label} ×${count}`;
    }
  }

  return `<span data-${attr}="${key}" data-${attr}-label="${label}"${extraAttrs}>${emoji} ${displayLabel}</span>`;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Expand slash commands into serialized tokens.
 *
 * /h and /r accept identical syntax:
 *   /r daily              → {r:daily:Daily}
 *   /r mwf 5              → {r:mwf:M·W·F:5}            (appear 5 more times)
 *   /r daily 30d          → {r:daily:Daily:30d}         (show for 30 days)
 *   /r april 10           → {r:daily:Until Apr 10:YYYY-04-10}
 *   /r april 10 2026      → {r:daily:Until Apr 10:2026-04-10}
 *   /r 04/10/2026         → {r:daily:Until Apr 10:2026-04-10}
 *   /r 04/10              → {r:daily:Until Apr 10:YYYY-04-10}
 *   /r 10.29.2026         → {r:daily:Until Oct 29:2026-10-29}
 *   /r 5 days             → {r:daily:Daily:5d}          (show for 5 days)
 *   /r mwf april 10       → {r:mwf:M·W·F Until Apr 10:YYYY-04-10}
 *   /r daily 5 days       → {r:daily:Daily:5d}
 *   (all of the above work identically with /h for habits)
 *
 * Other:
 *   /d <title>         → {d:title}   (drawing chip)
 *   /p <project>       → {project}
 *   /l <place>         → {l:place}
 *   /g <goal>          → {g:goal}
 */
export function expandSlashCommands(text) {
  if (!text) return text;

  // /h and /r — capture the full remainder up to the next slash-command, token, date-tag, or end
  for (const type of ['h', 'r']) {
    text = text.replace(
      new RegExp(`\\/${type}\\s+(.+?)(?=\\s*(?:\\/[a-z]|\\{|@)|$)`, 'gi'),
      (_, fullInput) => buildScheduleToken(type, fullInput.trim())
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
  // /tr <trip> → {tr:trip name} — multi-word, stops at next slash command,
  // token, mention, or end of line. Must come BEFORE single-letter expansions
  // so "tr" isn't swallowed.
  text = text.replace(/\/tr\s+([^\/{@}]+?)(?=\s*(?:\/[a-z]|\{|@|$))/gi,
    (_, name) => `{tr:${name.trim()}}`);

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
  inner = inner.replace(/\{d:([^}]+)\}/g, '<span data-drawing-tag="$1">🖼️ $1</span>');

  inner = inner.replace(/\{l:([^}]+)\}/g, '<span data-place-tag="$1">📍 $1</span>');
  inner = inner.replace(/\{tr:([^}]+)\}/g, '<span data-trip-tag="$1">🗺️ $1</span>');
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
    const skip = ['{r:', '{l:', '{h:', '{g:', '{d:', '{tr:'].some(p => m[0].startsWith(p));
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
