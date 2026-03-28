// ─── Recurrence parsing and matching ──────────────────────────────────────────
// Parses /d syntax from task text and checks if a date matches a schedule.

const DAY_MAP = { su: 0, sun: 0, sunday: 0, sundays: 0,
  mo: 1, mon: 1, monday: 1, mondays: 1,
  tu: 2, tue: 2, tuesday: 2, tuesdays: 2,
  we: 3, wed: 3, wednesday: 3, wednesdays: 3,
  th: 4, thu: 4, thurs: 4, thursday: 4, thursdays: 4,
  fr: 5, fri: 5, friday: 5, fridays: 5,
  sa: 6, sat: 6, saturday: 6, saturdays: 6,
  m: 1, t: 2, w: 3, r: 4, f: 5, s: 6, u: 0 };

// Short day codes for compact input: m t w r f s u (r=thursday, u=sunday)
const SHORT_DAYS = { m: 1, t: 2, w: 3, r: 4, f: 5, s: 6, u: 0 };

/**
 * Parse /d <schedule> from task text.
 * Returns { cleanText, recurrence } where recurrence is null if no /d found.
 *
 * Examples:
 *   "/d daily"              → { rule: "daily" }
 *   "/d weekdays"           → { rule: "weekly", days: [1,2,3,4,5] }
 *   "/d every monday"       → { rule: "weekly", days: [1] }
 *   "/d mon wed fri"        → { rule: "weekly", days: [1,3,5] }
 *   "/d m w f"              → { rule: "weekly", days: [1,3,5] }
 *   "/d biweekly tuesday"   → { rule: "biweekly", days: [2], anchor: "YYYY-MM-DD" }
 *   "/d monthly 15"         → { rule: "monthly", dayOfMonth: 15 }
 */
export function parseRecurrence(text, anchorDate) {
  if (!text) return { cleanText: text, recurrence: null };

  const match = text.match(/\/h\s+(.+?)(?:\s*$)/i);
  if (!match) return { cleanText: text, recurrence: null };

  const cleanText = text.replace(/\/h\s+.+?(?:\s*$)/i, '').trim();
  const schedule = match[1].toLowerCase().trim();

  // /d daily
  if (schedule === 'daily' || schedule === 'everyday' || schedule === 'every day') {
    return { cleanText, recurrence: { rule: 'daily' } };
  }

  // /d weekdays
  if (schedule === 'weekdays' || schedule === 'weekday') {
    return { cleanText, recurrence: { rule: 'weekly', days: [1, 2, 3, 4, 5] } };
  }

  // /d weekends
  if (schedule === 'weekends' || schedule === 'weekend') {
    return { cleanText, recurrence: { rule: 'weekly', days: [0, 6] } };
  }

  // /d monthly <number>
  const monthlyMatch = schedule.match(/^monthly\s+(\d+)$/);
  if (monthlyMatch) {
    return { cleanText, recurrence: { rule: 'monthly', dayOfMonth: parseInt(monthlyMatch[1]) } };
  }

  // /d biweekly <day>
  const biweeklyMatch = schedule.match(/^biweekly\s+(\w+)$/);
  if (biweeklyMatch) {
    const day = DAY_MAP[biweeklyMatch[1]];
    if (day !== undefined) {
      return { cleanText, recurrence: { rule: 'biweekly', days: [day], anchor: anchorDate } };
    }
  }

  // /d every <day>
  const everyMatch = schedule.match(/^every\s+(\w+)$/);
  if (everyMatch) {
    const day = DAY_MAP[everyMatch[1]];
    if (day !== undefined) {
      return { cleanText, recurrence: { rule: 'weekly', days: [day] } };
    }
  }

  // /d mwf or /d mwrf (concatenated single-letter codes, no spaces)
  if (/^[mtwrfsu]{2,7}$/i.test(schedule)) {
    const days = [...schedule.toLowerCase()].map(c => SHORT_DAYS[c]).filter(d => d !== undefined);
    if (days.length > 0) {
      return { cleanText, recurrence: { rule: 'weekly', days: [...new Set(days)].sort() } };
    }
  }

  // /d mon wed fri OR /d m w f (space-separated day names/codes)
  const parts = schedule.split(/\s+/);
  const days = parts.map(p => DAY_MAP[p] ?? SHORT_DAYS[p]).filter(d => d !== undefined);
  if (days.length > 0) {
    return { cleanText, recurrence: { rule: 'weekly', days: [...new Set(days)].sort() } };
  }

  // Couldn't parse — leave text unchanged
  return { cleanText: text, recurrence: null };
}

/**
 * Parse N from an xperweek schedule key (e.g. '1pw' → 1, '2pw' → 2).
 * Returns null if not an xperweek key.
 */
export function xperweekTarget(key) {
  if (!key) return null;
  const m = String(key).match(/^(\d+)pw$/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Get suggestion items for /r autocomplete.
 * Labels use M·W·F dot-separated format.
 */
export function getRecurrenceSuggestions(query) {
  const q = query.toLowerCase().trim();
  const options = [
    { label: 'Daily',     key: 'daily',    search: 'daily everyday' },
    { label: '1/week',    key: '1pw',      search: '1x per week once weekly 1 per week 1pw' },
    { label: '2/week',    key: '2pw',      search: '2x per week twice weekly 2 per week 2pw' },
    { label: '3/week',    key: '3pw',      search: '3x per week three times weekly 3 per week 3pw' },
    { label: 'M·T·W·R·F', key: 'weekdays', search: 'weekdays weekday mtwrf' },
    { label: 'M·W·F',     key: 'mwf',      search: 'mwf monday wednesday friday' },
    { label: 'T·R',       key: 'tr',       search: 'tth tuesday thursday tr tuesdays thursdays' },
    { label: 'S·U',       key: 'weekends', search: 'weekends weekend su saturday sunday saturdays sundays' },
    { label: 'M',  key: 'mon', search: 'monday mon mondays m every' },
    { label: 'T',  key: 'tue', search: 'tuesday tue tuesdays t every' },
    { label: 'W',  key: 'wed', search: 'wednesday wed wednesdays w every' },
    { label: 'R',  key: 'thu', search: 'thursday thu thursdays thurs r every' },
    { label: 'F',  key: 'fri', search: 'friday fri fridays f every' },
    { label: 'S',  key: 'sat', search: 'saturday sat saturdays s every' },
    { label: 'U',  key: 'sun', search: 'sunday sun sundays u every' },
  ];
  if (!q) return options.map(o => `__recurrence__:${o.key}:${o.label}`);
  return options
    .filter(o => o.search.includes(q) || o.label.toLowerCase().includes(q) || o.key.includes(q))
    .map(o => `__recurrence__:${o.key}:${o.label}`);
}

/**
 * Convert a suggestion key to a recurrence object.
 */
export function keyToRecurrence(key, anchorDate) {
  // "Npw" keys: flexible N-times-per-week schedule (any days, tracked weekly)
  const pwTarget = xperweekTarget(key);
  if (pwTarget !== null && pwTarget > 0) return { rule: 'xperweek', target: pwTarget };

  switch (key) {
    case 'daily': return { rule: 'daily' };
    case 'weekdays': return { rule: 'weekly', days: [1,2,3,4,5] };
    case 'mwf': return { rule: 'weekly', days: [1,3,5] };
    case 'tr': return { rule: 'weekly', days: [2,4] };
    case 'rf': return { rule: 'weekly', days: [4,5] };
    case 'weekends': return { rule: 'weekly', days: [0,6] };
    case 'mon': return { rule: 'weekly', days: [1] };
    case 'tue': return { rule: 'weekly', days: [2] };
    case 'wed': return { rule: 'weekly', days: [3] };
    case 'thu': return { rule: 'weekly', days: [4] };
    case 'fri': return { rule: 'weekly', days: [5] };
    case 'sat': return { rule: 'weekly', days: [6] };
    case 'sun': return { rule: 'weekly', days: [0] };
    default: return null;
  }
}

/**
 * Format recurrence as a human-readable label.
 */
// Single-letter day codes for chip display
const DLETTER = ['U','M','T','W','R','F','S'];
export function recurrenceLabel(rec) {
  if (!rec) return '';
  if (rec.rule === 'daily') return 'Daily';
  if (rec.rule === 'xperweek') return `${rec.target}/week`;
  if (rec.rule === 'weekly') {
    return (rec.days || []).map(d => DLETTER[d]).join('·');
  }
  if (rec.rule === 'biweekly') return `Bi·${DLETTER[rec.days?.[0]] || ''}`;
  if (rec.rule === 'monthly') return `${rec.dayOfMonth}th`;
  return '';
}

/**
 * Check if a date matches a recurrence schedule.
 * @param {string} dateStr - YYYY-MM-DD
 * @param {object} recurrence - { rule, days?, dayOfMonth?, anchor? }
 * @returns {boolean}
 */
export function matchesSchedule(dateStr, recurrence) {
  if (!recurrence || !dateStr) return false;
  const d = new Date(dateStr + 'T12:00:00');
  const dow = d.getDay(); // 0=Sun, 6=Sat

  switch (recurrence.rule) {
    case 'daily':
      return true;

    // xperweek: task appears every day (you can complete it any day of the week)
    case 'xperweek':
      return true;

    case 'weekly':
      return (recurrence.days || []).includes(dow);

    case 'biweekly': {
      if (!(recurrence.days || []).includes(dow)) return false;
      const anchor = new Date((recurrence.anchor || dateStr) + 'T12:00:00');
      const diffDays = Math.round((d - anchor) / 86400000);
      const diffWeeks = Math.floor(diffDays / 7);
      return diffWeeks % 2 === 0;
    }

    case 'monthly':
      return d.getDate() === recurrence.dayOfMonth;

    default:
      return false;
  }
}

/**
 * Calculate streak: consecutive completed instances going backward from today.
 * @param {Array} instances - [{date, done}] sorted by date descending
 * @param {object} recurrence - schedule to check which dates are expected
 * @returns {number} streak count
 */
export function calculateStreak(instances, recurrence) {
  if (!instances?.length || !recurrence) return 0;
  const completed = new Set(instances.filter(i => i.done).map(i => i.date));
  let streak = 0;
  const d = new Date();
  // Walk backward up to 365 days
  for (let i = 0; i < 365; i++) {
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (matchesSchedule(dateStr, recurrence)) {
      if (completed.has(dateStr)) streak++;
      else break; // streak broken
    }
    d.setDate(d.getDate() - 1);
  }
  return streak;
}
