// ─── Recurrence parsing and matching ──────────────────────────────────────────
// Parses /d syntax from task text and checks if a date matches a schedule.

const DAY_MAP = { su: 0, sun: 0, sunday: 0, mo: 1, mon: 1, monday: 1, tu: 2, tue: 2, tuesday: 2,
  we: 3, wed: 3, wednesday: 3, th: 4, thu: 4, thursday: 4, fr: 5, fri: 5, friday: 5,
  sa: 6, sat: 6, saturday: 6, m: 1, t: 2, w: 3, r: 4, f: 5, s: 6, u: 0 };

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

  const match = text.match(/\/d\s+(.+?)(?:\s*$)/i);
  if (!match) return { cleanText: text, recurrence: null };

  const cleanText = text.replace(/\/d\s+.+?(?:\s*$)/i, '').trim();
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
