// ─── Tag / project utilities ──────────────────────────────────────────────────

export function extractTags(text) {
  if (!text || typeof text !== 'string') return [];
  const seen = new Set(); const tags = [];
  const reNew = /\{([a-z0-9][a-z0-9 ]*[a-z0-9]|[a-z0-9])\}/g;
  let m;
  while ((m = reNew.exec(text)) !== null) {
    const lower = m[1].toLowerCase();
    if (!seen.has(lower)) { seen.add(lower); tags.push(lower); }
  }
  const reLegacy = /#([A-Za-z][A-Za-z0-9]+)(?![A-Za-z0-9])/g;
  while ((m = reLegacy.exec(text)) !== null) {
    const lower = m[1].toLowerCase();
    if (!seen.has(lower)) { seen.add(lower); tags.push(lower); }
  }
  return tags;
}

export function extractTagsFromAll(notes, tasks) {
  const tags = new Set();
  extractTags(notes || '').forEach(t => tags.add(t));
  (Array.isArray(tasks) ? tasks : []).forEach(task => {
    if (task?.text) extractTags(task.text).forEach(t => tags.add(t));
  });
  return [...tags];
}

export function tagDisplayName(name) {
  const spaced = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return spaced.replace(/\b\w/g, c => c.toUpperCase());
}
