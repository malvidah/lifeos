// Validates a YYYY-MM-DD date string
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isValidDate(str) {
  if (!str || !DATE_RE.test(str)) return false;
  const d = new Date(str + 'T00:00:00');
  return !isNaN(d.getTime()) && d.toISOString().startsWith(str);
}
