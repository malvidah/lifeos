// ─── Centralized task text cleaning ──────────────────────────────────────────
// Single source of truth for normalizing task text for comparison/matching.
// Used everywhere that needs to compare task text: GET suppression, POST
// dedup, complete-recurring, habits API, and client-side matching.
//
// Strips all structured tokens so only the human-readable task name remains.

export function cleanTaskText(text) {
  if (!text) return '';
  return text
    // Serialized tokens: {h:key:label}, {r:key:label}, {l:place}, {project}
    .replace(/\{[^}]+\}/g, '')
    // Slash commands: /h daily, /r mwf, etc.
    .replace(/\/[hr]\s+\S+/gi, '')
    // Rendered emoji chips from TipTap nodes
    .replace(/🎯\s*[A-Za-z·\s]+/g, '')
    .replace(/↻\s*[A-Za-z·\s]+/g, '')
    // Date tokens: @2026-03-26
    .replace(/@\d{4}-\d{2}-\d{2}/g, '')
    // Normalize whitespace and trim
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
