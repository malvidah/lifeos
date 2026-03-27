// ─── Centralized task text cleaning ──────────────────────────────────────────
// Single source of truth for normalizing task text for comparison/matching.
// Used everywhere that needs to compare task text: GET suppression, POST
// dedup, complete-recurring, habits API, and client-side matching.
//
// Strips all structured tokens so only the human-readable task name remains.

// Strip tokens, normalize whitespace, lowercase — for comparison/matching
export function cleanTaskText(text) {
  if (!text) return '';
  return stripTokens(text).toLowerCase();
}

// Strip tokens, normalize whitespace, preserve case — for display
export function displayTaskText(text) {
  if (!text) return '';
  return stripTokens(text);
}

function stripTokens(text) {
  return text
    // Serialized tokens: {h:key:label}, {r:key:label}, {l:place}, {project}, {g:goal}
    .replace(/\{[^}]+\}/g, '')
    // Slash commands: /h daily, /r mwf, /p project, /n note, /l place, /d date, /g goal, etc.
    .replace(/\/[hrnpldg]\s+\S+/gi, '')
    // Rendered emoji chips from TipTap nodes
    .replace(/🎯\s*[A-Za-z·\s]+/g, '')
    .replace(/↻\s*[A-Za-z·\s]+/g, '')
    .replace(/🏔️\s*[A-Za-z·\s]+/g, '')
    // Date tokens: @2026-03-26
    .replace(/@\d{4}-\d{2}-\d{2}/g, '')
    // Note links: [note name]
    .replace(/\[[^\]]+\]/g, '')
    // Normalize whitespace and trim
    .replace(/\s+/g, ' ')
    .trim();
}
