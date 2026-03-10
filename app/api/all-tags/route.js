import { createClient } from '@supabase/supabase-js';

function getUserClient(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return { supabase: null };
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  return { supabase };
}

// Score a tag key: prefer more interior uppercase letters (better camelCase)
// e.g. 'DayLab' scores higher than 'DayLAb' or 'daylab'
function camelScore(s) {
  let score = 0;
  for (let i = 1; i < s.length; i++) {
    if (s[i] >= 'A' && s[i] <= 'Z' && s[i-1] >= 'a' && s[i-1] <= 'z') score++;
  }
  return score;
}

const TAG_RE = /#([A-Za-z][A-Za-z0-9]+)(?![A-Za-z0-9])/g;

export async function GET(req) {
  const { supabase } = getUserClient(req);
  if (!supabase) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const [notesR, tasksR] = await Promise.all([
      supabase.from('entries').select('data').eq('user_id', user.id).eq('type', 'notes'),
      supabase.from('entries').select('data').eq('user_id', user.id).eq('type', 'tasks'),
    ]);

    // lower → best-cased version
    const best = new Map();

    const consider = (tag) => {
      const lower = tag.toLowerCase();
      const cur = best.get(lower);
      if (!cur || camelScore(tag) > camelScore(cur)) best.set(lower, tag);
    };

    for (const row of notesR.data || []) {
      const text = typeof row.data === 'string' ? row.data : '';
      TAG_RE.lastIndex = 0;
      let m;
      while ((m = TAG_RE.exec(text)) !== null) consider(m[1]);
    }

    for (const row of tasksR.data || []) {
      for (const task of (Array.isArray(row.data) ? row.data : [])) {
        if (!task?.text) continue;
        TAG_RE.lastIndex = 0;
        let m;
        while ((m = TAG_RE.exec(task.text)) !== null) consider(m[1]);
      }
    }

    return Response.json({ tags: [...best.values()].sort() });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
