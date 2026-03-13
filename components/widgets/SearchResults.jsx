"use client";
import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { useTheme } from "@/lib/theme";
import { serif, mono, F, R, projectColor } from "@/lib/tokens";
import { toKey, fmtDate, MONTHS_SHORT, DAYS_SHORT } from "@/lib/dates";
import { extractTags } from "@/lib/tags";
import { useNavigation } from "@/lib/contexts";
import { createClient } from "@/lib/supabase";
import { TagChip } from "../ui/primitives.jsx";

export function useSearch(query, token, userId) {
  const [results, setResults] = useState(null); // null=idle, []=empty, [...]=hits
  const [loading, setLoading] = useState(false);
  const debRef = useRef(null);

  useEffect(() => {
    clearTimeout(debRef.current);
    const q = query.trim();
    if (!q || q.length < 2) { setResults(null); return; }
    debRef.current = setTimeout(() => run(q), 200);
    return () => clearTimeout(debRef.current);
  }, [query, token, userId]); // eslint-disable-line

  async function run(q) {
    if (!token || !userId) return;
    setLoading(true);
    try {
      const sb = createClient();
      await sb.auth.setSession({ access_token: token, refresh_token: '' });
      const like = `%${q}%`;

      const [notesR, tasksR, mealsR, workoutsR] = await Promise.all([
        sb.from('journal_blocks').select('date, content')
          .eq('user_id', userId).ilike('content', like)
          .order('date', { ascending: false }).limit(200)
          .then(r => r.data || []),
        sb.from('tasks').select('date, text, done')
          .eq('user_id', userId).ilike('text', like)
          .order('date', { ascending: false }).limit(200)
          .then(r => r.data || []),
        sb.from('meal_items').select('date, content, ai_calories')
          .eq('user_id', userId).ilike('content', like)
          .order('date', { ascending: false }).limit(200)
          .then(r => r.data || []),
        sb.from('workouts').select('date, title')
          .eq('user_id', userId).ilike('title', like)
          .order('date', { ascending: false }).limit(200)
          .then(r => r.data || []),
      ]);

      const hits = [];
      notesR.forEach(row => {
        (row.content || '').split('\n').filter(l => l.trim()).forEach(line => {
          hits.push({ type: 'journal', date: row.date, text: line });
        });
      });
      tasksR.forEach(row => {
        if (row.text?.trim())
          hits.push({ type: 'task', date: row.date, text: row.text, done: row.done });
      });
      mealsR.forEach(row => {
        if (row.content?.trim())
          hits.push({ type: 'meal', date: row.date, text: row.content, kcal: row.ai_calories });
      });
      workoutsR.forEach(row => {
        if (row.title?.trim())
          hits.push({ type: 'workouts', date: row.date, text: row.title });
      });
      hits.sort((a, b) => b.date.localeCompare(a.date));
      setResults(hits.slice(0, 80));
    } catch(e) { setResults([]); }
    setLoading(false);
  }

  return { results, loading };
}

// ─── SearchResults: renders result blocks with keyword highlight ──────────────
export function SearchResults({ results, loading, query, onSelectDate }) {
  const { C } = useTheme();
  const TYPE_LABEL = { journal: 'Journal', task: 'Task', meal: 'Meal', activity: 'Workout' };
  const TYPE_COLOR = { journal: "var(--dl-accent)", task: "var(--dl-accent)", meal: "var(--dl-red)", activity: "var(--dl-blue)" };

  function highlight(text, q) {
    if (!q || !text) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark style={{ background: C.accent + '30', color: "var(--dl-accent)", borderRadius: 2, padding: '0 1px', fontStyle: 'normal' }}>
          {text.slice(idx, idx + q.length)}
        </mark>
        {text.slice(idx + q.length)}
      </>
    );
  }

  if (loading && !results) return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}>
      <span style={{ fontFamily: mono, fontSize: 9, color: "var(--dl-muted)", letterSpacing: '0.15em', textTransform: 'uppercase' }}>searching…</span>
    </div>
  );

  if (!results || query.trim().length < 2) return null;

  if (results.length === 0) return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
      <span style={{ fontFamily: mono, fontSize: 10, color: "var(--dl-dim)", letterSpacing: '0.06em' }}>No results match your search</span>
    </div>
  );

  // Group by date → then by type, preserving project-view card order
  const TYPE_ORDER = ['task', 'journal', 'meal', 'activity'];
  const TYPE_SECTION = { task: 'Tasks', journal: 'Journal', meal: 'Meals', activity: 'Workouts' };
  const byDate = [];
  let lastDate = null;
  results.forEach(hit => {
    if (hit.date !== lastDate) { byDate.push({ date: hit.date, hits: [] }); lastDate = hit.date; }
    byDate[byDate.length - 1].hits.push(hit);
  });

  return (
    <div style={{ padding: '0 10px 180px' }}>
      {byDate.map(({ date, hits }) => {
        const byType = {};
        hits.forEach(h => { if (!byType[h.type]) byType[h.type] = []; byType[h.type].push(h); });
        const types = TYPE_ORDER.filter(t => byType[t]);
        return (
          <div key={date} style={{ marginBottom: 20 }}>
            {/* Date header */}
            <div
              onClick={() => onSelectDate && onSelectDate(date)}
              style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
                color: "var(--dl-muted)", padding: '10px 2px 8px', cursor: 'pointer', display: 'inline-block',
                transition: 'color 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.color = "var(--dl-text)"}
              onMouseLeave={e => e.currentTarget.style.color = "var(--dl-muted)"}
            >{fmtDate(date)}</div>

            {/* Per-type outlined card */}
            {types.map(type => (
              <div key={type}
                onClick={() => onSelectDate && onSelectDate(date)}
                style={{
                  marginBottom: 8, borderRadius: 10, cursor: 'pointer',
                  border: "1px solid var(--dl-border)",
                  overflow: 'hidden',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = "var(--dl-surface)";
                  e.currentTarget.style.borderColor = "var(--dl-border2)";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = "var(--dl-border)";
                }}
              >
                {/* Card header — type label */}
                <div style={{
                  fontFamily: mono, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase',
                  color: TYPE_COLOR[type] + 'cc', padding: '7px 12px 5px',
                  borderBottom: "1px solid var(--dl-border)",
                }}>
                  {TYPE_SECTION[type]}
                </div>
                {/* Entries */}
                {byType[type].map((hit, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '7px 12px',
                    borderBottom: i < byType[type].length - 1 ? "1px solid var(--dl-border)" : 'none',
                  }}>
                    {type === 'task' && (
                      <div style={{ width: 13, height: 13, flexShrink: 0, borderRadius: 3, marginTop: 5,
                        border: `1.5px solid ${hit.done ? "var(--dl-accent)" : "var(--dl-border2)"}`,
                        background: hit.done ? "var(--dl-accent)" : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {hit.done && <span style={{ fontSize: 9, color: "var(--dl-bg)", lineHeight: 1 }}>✓</span>}
                      </div>
                    )}
                    <div style={{ flex: 1, fontFamily: serif, fontSize: F.md, lineHeight: 1.6,
                      color: hit.done ? "var(--dl-muted)" : "var(--dl-text)", whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      textDecoration: hit.done ? 'line-through' : 'none',
                      opacity: hit.done ? 0.5 : 1 }}>
                      {highlight(hit.text, query.trim())}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}


// ─── Map card ───────────────────────────────────────────────
