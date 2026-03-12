function extractTags(text) {
  if (!text || typeof text !== 'string') return [];
  const seen = new Set(); const tags = [];
  // New format: {projectname}
  const reNew = /\{([a-z0-9][a-z0-9 ]*[a-z0-9]|[a-z0-9])\}/g;
  let m;
  while ((m = reNew.exec(text)) !== null) {
    const lower = m[1].toLowerCase();
    if (!seen.has(lower)) { seen.add(lower); tags.push(lower); }
  }
  // Legacy format: #ProjectName — normalise to lowercase
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
// BigThink → Big Think  (used for project-level labels, not inline chips)
// Also handles all-lowercase normalized tags: 'daylab' → 'Daylab'
export function tagDisplayName(name) {
  // camelCase split (legacy mixed-case keys like 'BigThink' → 'Big Think')
  const spaced = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  // Capitalize first letter of each word
  return spaced.replace(/\b\w/g, c => c.toUpperCase());
}
// Pastel accent palette for project chips — warm tones that fit the dark theme
// projectColor and CHIP_TOKENS are imported from DayLabEditor — single source of truth
const projectColor = _projectColor;
