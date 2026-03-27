// Validates a YYYY-MM-DD date string
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isValidDate(str) {
  if (!str || !DATE_RE.test(str)) return false;
  const d = new Date(str + 'T00:00:00');
  return !isNaN(d.getTime()) && d.toISOString().startsWith(str);
}

// Validates a UUID v4 string
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isValidUuid(str) {
  return typeof str === 'string' && UUID_RE.test(str);
}

// Max task text length (bytes) — prevents oversized payloads
export const MAX_TASK_TEXT = 2000;
