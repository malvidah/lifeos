import { getUserClient } from '../_lib/google.js';

const TAG_RE = /#([A-Za-z][A-Za-z0-9]+)(?![A-Za-z0-9])/g;

function tagsIn(text) {
  const s = new Set();
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(text)) !== null) s.add(m[1].toLowerCase());
  return s;
}

export async function GET(req) {
  const { supabase } = getUserClient(req);
  if (!supabase) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const [notesR, tasksR] = await Promise.all([
      supabase.from('entries').select('data, date').eq('user_id', user.id).eq('type', 'notes'),
      supabase.from('entries').select('data, date').eq('user_id', user.id).eq('type', 'tasks'),
    ]);

    const coMap = new Map();
    const recency = new Map();

    // Group all tags by date first
    const byDate = new Map();
    for (const row of notesR.data || []) {
      const tags = tagsIn(typeof row.data === 'string' ? row.data : '');
      const existing = byDate.get(row.date) || new Set();
      tags.forEach(t => existing.add(t));
      byDate.set(row.date, existing);
    }
    for (const row of tasksR.data || []) {
      const tags = new Set();
      for (const task of (Array.isArray(row.data) ? row.data : [])) {
        if (task?.text) tagsIn(task.text).forEach(t => tags.add(t));
      }
      const existing = byDate.get(row.date) || new Set();
      tags.forEach(t => existing.add(t));
      byDate.set(row.date, existing);
    }

    for (const [date, tags] of byDate) {
      const arr = [...tags];
      for (const t of arr) {
        if (!recency.has(t) || date > recency.get(t)) recency.set(t, date);
      }
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const key = [arr[i], arr[j]].sort().join('|');
          coMap.set(key, (coMap.get(key) || 0) + 1);
        }
      }
    }

    const connections = [];
    for (const [key, weight] of coMap) {
      const [source, target] = key.split('|');
      connections.push({ source, target, weight });
    }

    return Response.json({ connections, recency: Object.fromEntries(recency) });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
