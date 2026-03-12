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

  // New TipTap HTML format
  if (typeof data === 'string' && data.includes('data-type="taskItem"')) {
    const tasks = [];
    const liRe = /<li[^>]*data-type="taskItem"[^>]*data-checked="(true|false)"[^>]*>([\s\S]*?)<\/li>/g;
    let m, idx = 0;
    while ((m = liRe.exec(data)) !== null) {
      const done = m[1] === 'true';
      const text = m[2].replace(/<[^>]+>/g, '').trim();
      if (text) tasks.push({ id: `html_${idx++}`, text, done });
    }
    return tasks;
  }

  return [];
}
