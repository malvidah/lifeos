/**
 * parseTasks — normalize task data from either storage format.
 *
 * Old format: JSON array  [{id, text, done}, ...]   (pre-TipTap)
 * New format: HTML string  '<ul data-type="taskList"><li data-type="taskItem" data-checked="...">'
 *             (written by TipTap TaskList/TaskItem — stored via editor.getHTML())
 *
 * Returns: [{id, text, done}]  — consistent shape for all callers.
 */
export function parseTasks(data) {
  // Old format — JSON array
  if (Array.isArray(data)) {
    return data.filter(t => t?.text).map((t, i) => ({
      id:   t.id   ?? `old_${i}`,
      text: t.text,
      done: !!t.done,
    }));
  }

  // New TipTap HTML format — TipTap outputs data-checked before data-type, so match
  // any attribute order by capturing the whole opening tag and parsing separately.
  if (typeof data === 'string' && data.includes('data-type="taskItem"')) {
    const tasks = [];
    const liRe = /<li\b([^>]*)>([\s\S]*?)<\/li>/g;
    let m, idx = 0;
    while ((m = liRe.exec(data)) !== null) {
      const attrs = m[1];
      if (!attrs.includes('data-type="taskItem"')) continue;
      const doneMatch = attrs.match(/data-checked="(true|false)"/);
      const done = doneMatch?.[1] === 'true';
      // Preserve project/note chip attrs as {name}/[name] before stripping HTML —
      // otherwise the regex in project-entries can't match chip-tagged tasks.
      const inner = m[2]
        .replace(/<span\b[^>]*\bdata-project-tag="([^"]*)"[^>]*>[^<]*<\/span>/g, '{$1}')
        .replace(/<span\b[^>]*\bdata-note-link="([^"]*)"[^>]*>[^<]*<\/span>/g, '[$1]');
      const text = inner.replace(/<[^>]+>/g, '').trim();
      if (text) tasks.push({ id: `html_${idx++}`, text, done });
    }
    return tasks;
  }

  return [];
}
