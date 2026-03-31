// ─── Shared task-text → HTML conversion ──────────────────────────────────────
// Converts raw task text (with serialized tokens like {project}, {h:daily:Daily},
// {r:mwf:M·W·F}, {r:mwf:M·W·F:3}, {r:daily:Until Apr 1:2026-04-01}, {d:title},
// etc.) into the tiptap-compatible <li> HTML that the editor expects.
//
// Also expands common slash shorthands (/h daily, /r mwf, /r mwf 2,
// /r MM.DD.YYYY, /d drawing-title, /p project) into serialized token form.

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

/**
 * Expand slash commands into serialized tokens.
 *
 * /h <schedule>          → {h:schedule:Label}           (habit, shows in Habits card)
 * /r <schedule>          → {r:schedule:Label}           (recurring, not in Habits)
 * /r <schedule> <N>      → {r:schedule:Label:N}         (repeat N times then stop)
 * /r MM.DD.YYYY          → {r:daily:Until Mon DD:YYYY-MM-DD}  (repeat daily until date)
 * /r YYYY-MM-DD          → {r:daily:Until Mon DD:YYYY-MM-DD}  (same, ISO format)
 * /d <title>             → {d:title}                    (link a drawing by title)
 * /p <project>           → {project}
 * /l <place>             → {l:place}
 * /g <goal>              → {g:goal}
 */
export function expandSlashCommands(text) {
  if (!text) return text;

  // /h <schedule> → {h:schedule:Label}
  text = text.replace(/\/h\s+(\S+)/gi, (_, key) => {
    const k = key.toLowerCase();
    return `{h:${k}:${SCHEDULE_MAP[k] || k}}`;
  });

  // /r — handles three forms: until-date, count-limited, plain schedule
  text = text.replace(/\/r\s+(\S+)(?:\s+(\d+))?/gi, (_, key, count) => {
    // Until-date: /r MM.DD.YYYY or /r YYYY-MM-DD
    const dotDate = key.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    const isoDate = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dotDate || isoDate) {
      let yyyy, mm, dd;
      if (dotDate) {
        [, mm, dd, yyyy] = dotDate;
      } else {
        [, yyyy, mm, dd] = isoDate;
      }
      const iso = `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
      const label = `Until ${MONTH_NAMES[parseInt(mm,10)-1]} ${parseInt(dd,10)}`;
      return `{r:daily:${label}:${iso}}`;
    }
    // Plain schedule or count-limited
    const k = key.toLowerCase();
    const label = SCHEDULE_MAP[k] || k;
    return count ? `{r:${k}:${label}:${count}}` : `{r:${k}:${label}}`;
  });

  // /d <drawing title> → {d:title}  (title may be multi-word, stops at next token)
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

  // {r:key:label}, {r:key:label:N} (count), {r:key:label:YYYY-MM-DD} (until)
  inner = inner.replace(/\{r:([^:}]+):([^:}]*)(?::([^}]*))?\}/g, (_, key, label, suffix) => {
    if (!suffix) {
      return `<span data-recurrence="${key}" data-recurrence-label="${label}">↻ ${label}</span>`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(suffix)) {
      return `<span data-recurrence="${key}" data-recurrence-label="${label}" data-recurrence-until="${suffix}">↻ ${label}</span>`;
    }
    if (/^\d+$/.test(suffix)) {
      return `<span data-recurrence="${key}" data-recurrence-label="${label}" data-recurrence-count="${suffix}">↻ ${label} ×${suffix}</span>`;
    }
    return `<span data-recurrence="${key}" data-recurrence-label="${label}">↻ ${label}</span>`;
  });

  // {h:key:label} or {h:key:label:N} or {h:key:label:Nd}
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
  const re = /\{([a-z0-9][a-z0-9 ]*[a-z0-9]|[a-z0-9])\}/gi;
  let m;
  while ((m = re.exec(text || '')) !== null) {
    if (!m[0].startsWith('{r:') && !m[0].startsWith('{l:') && !m[0].startsWith('{h:') && !m[0].startsWith('{g:') && !m[0].startsWith('{d:')) {
      tags.push(m[1].toLowerCase());
    }
  }
  return tags;
}

/**
 * Parse due/until date from task text.
 * Reads @YYYY-MM-DD or until-date embedded in {r:key:label:YYYY-MM-DD}.
 */
export function parseDueDate(text) {
  const m1 = (text || '').match(/@(\d{4}-\d{2}-\d{2})/);
  if (m1) return m1[1];
  const m2 = (text || '').match(/\{r:[^:]+:[^:]+:(\d{4}-\d{2}-\d{2})\}/);
  if (m2) return m2[1];
  return null;
}
