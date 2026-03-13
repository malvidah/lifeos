import { withAuth } from '../_lib/auth.js';

// Builds a tag co-occurrence graph from project_tags[] on journal_blocks and tasks.
// Returns: { connections: [{ source, target, weight }], recency: { tag: latestDate } }

function canonical(lower) { return lower; }

export const GET = withAuth(async (req, { supabase, user }) => {
  const [journalR, tasksR] = await Promise.all([
    supabase.from('journal_blocks').select('date, project_tags').eq('user_id', user.id),
    supabase.from('tasks').select('date, project_tags').eq('user_id', user.id),
  ]);

  // Build per-date tag sets
  const byDate = new Map();

  for (const row of [...(journalR.data || []), ...(tasksR.data || [])]) {
    const tags = (row.project_tags || []).map(t => canonical(t.toLowerCase())).filter(Boolean);
    if (!tags.length) continue;
    const existing = byDate.get(row.date) || new Set();
    tags.forEach(t => existing.add(t));
    byDate.set(row.date, existing);
  }

  const coMap = new Map();
  const recency = new Map();

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
});
