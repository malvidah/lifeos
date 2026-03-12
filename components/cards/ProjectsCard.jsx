"use client";
import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { useTheme } from "@/lib/theme";
import { mono, F, R, projectColor } from "@/lib/tokens";
import { toKey, todayKey, shift, fmtDate } from "@/lib/dates";
import { extractTags, extractTagsFromAll, tagDisplayName } from "@/lib/tags";
import { useDbSave } from "@/lib/db";
import { useNavigation } from "@/lib/contexts";
import { Ring, TagChip } from "../ui/primitives.jsx";
import { TaskFilterBtns } from "../widgets/Tasks.jsx";
import { api } from "@/lib/api";

const TAGS_CACHE = { tags: null, connections: [], recency: {} };

export default function ProjectsCard({ date, token, userId, onSelectProject }) {
  const { C } = useTheme();
  const { value: notes } = useDbSave(date, 'journal', '', token, userId);
  const { value: tasks }  = useDbSave(date, 'tasks', [], token, userId);
  // projectsMeta is metadata-only (descriptions). NOT source of truth for project existence.
  const { value: projectsMeta } = useDbSave('global', 'projects', {}, token, userId);

  // Which tags exist in today's entries (for active/dim styling)
  const todayTags = useMemo(() => {
    const s = new Set();
    extractTags(notes || '').forEach(t => s.add(t.toLowerCase()));
    (Array.isArray(tasks) ? tasks : []).forEach(r => {
      if (r?.text) extractTags(r.text).forEach(t => s.add(t.toLowerCase()));
    });
    return s;
  }, [notes, tasks]);

  // Tags that actually exist anywhere in the DB — fetched from /api/all-tags.
  // TAGS_CACHE is module-level so it persists across ProjectsCard mount/unmount cycles,
  // preventing the nav flash that happened when allTags started null every mount.
  const [allTags, setAllTagsRaw] = useState(() => TAGS_CACHE.tags);
  const [connections, setConnections] = useState(() => TAGS_CACHE.connections);
  const [recency, setRecency] = useState(() => TAGS_CACHE.recency);
  const setAllTags = (v) => {
    const tags = typeof v === 'function' ? v(allTags) : v;
    TAGS_CACHE.tags = tags;
    setAllTagsRaw(tags);
  };
  const fetchedRef = useRef(!!TAGS_CACHE.tags); // skip fetch if cache is warm
  useEffect(() => {
    if (!token || fetchedRef.current) return;
    fetchedRef.current = true;
    Promise.all([
      api.get('/api/all-tags', token),
      api.get('/api/tag-connections', token),
    ]).then(([tagsRes, connsRes]) => {
      const tags = Array.isArray(tagsRes?.tags) ? tagsRes.tags : [];
      const conns = Array.isArray(connsRes?.connections) ? connsRes.connections : [];
      const rec = connsRes?.recency || {};
      TAGS_CACHE.tags = tags; TAGS_CACHE.connections = conns; TAGS_CACHE.recency = rec;
      setAllTagsRaw(tags); setConnections(conns); setRecency(rec);
    }).catch(() => { setAllTagsRaw([]); });
  }, [token]); // eslint-disable-line

  // Re-fetch when today's notes/tasks change (new tag added or deleted)
  const prevTagsKey = useRef('');
  useEffect(() => {
    const key = todayTags ? [...todayTags].sort().join(',') : '';
    if (key === prevTagsKey.current || !token) return;
    prevTagsKey.current = key;
    api.get('/api/all-tags', token)
      .then(d => setAllTags(Array.isArray(d?.tags) ? d.tags : []))
      .catch(() => {});
  }, [todayTags, token]); // eslint-disable-line

  // When a new project is created via /p chip, add it immediately to the nav strip
  // without waiting for a DB re-fetch (the entry may not be saved yet).
  useEffect(() => {
    const handler = (e) => {
      const name = e.detail?.name;
      if (!name) return;
      setAllTags(prev => (prev && !prev.includes(name)) ? [...prev, name] : prev);
      // Also bump recency so it sorts to the front
      setRecency(prev => ({ ...prev, [name.toLowerCase()]: new Date().toISOString() }));
    };
    window.addEventListener('daylab:create-project', handler);
    return () => window.removeEventListener('daylab:create-project', handler);
  }, []); // eslint-disable-line

  // Sort by recency, show top 6 in strip
  const _pcSorted = useMemo(function() {
    if (!allTags) return [];
    return allTags.slice().sort(function(a, b) {
      var ra = recency[a.toLowerCase()] || '0';
      var rb = recency[b.toLowerCase()] || '0';
      return rb < ra ? -1 : rb > ra ? 1 : 0;
    });
  }, [allTags, recency]); // eslint-disable-line
  var names = _pcSorted.slice(0, 6);
  var pcHasMore = _pcSorted.length > 6;

  const pcScrollRef = useRef(null);
  const [pcFade, setPcFade] = useState(false);
  useEffect(() => {
    const el = pcScrollRef.current;
    if (!el) return;
    const check = () => {
      const hasOverflow = el.scrollWidth > el.clientWidth + 2;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
      setPcFade(hasOverflow && !atEnd);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    el.addEventListener('scroll', check, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener('scroll', check); };
  }, [names.length]); // eslint-disable-line

  // allTags null only on absolute first load before fetch completes (TAGS_CACHE is empty)
  // Return an empty strip rather than null so layout doesn't collapse
  if (allTags === null) return <div style={{height:48}}/>; // same height as Shell

  // Package icon SVG (grid of dots)
  const PackageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
      <line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>
  );

  return (
    <div style={{ position:'relative', display:'flex', alignItems:'center', gap:0, padding:'4px 0' }}>
      {/* Package icon — opens graph/projects view. Same size/style as search icon. */}
      <button
        onClick={() => onSelectProject('__graph__')}
        title="All Projects"
        style={{
          background:'none', border:'none', cursor:'pointer',
          padding:'8px 12px', display:'flex', alignItems:'center',
          color:C.muted, flexShrink:0, transition:'color 0.15s',
          minWidth:44, minHeight:44, justifyContent:'center',
        }}
        onMouseEnter={e => e.currentTarget.style.color=C.text}
        onMouseLeave={e => e.currentTarget.style.color=C.muted}
      >{PackageIcon}</button>

      {/* Scrollable chips */}
      <div
        ref={pcScrollRef}
        style={{
          display:'flex', alignItems:'center', flexWrap:'nowrap', gap:6,
          padding:'4px 0', overflowX:'auto', scrollbarWidth:'none', msOverflowStyle:'none',
          flex:1, minWidth:0,
        }}
      >
        {/* Health — pinned, always first */}
        <button
          onClick={() => onSelectProject('__health__')}
          style={{
            background: C.green + '11', border:`1px solid ${C.green}33`,
            borderRadius:20, padding:'2px 10px',
            fontFamily:mono, fontSize:F.sm, color:C.green+'aa',
            cursor:'pointer', transition:'all 0.15s',
            letterSpacing:'0.03em', lineHeight:'1.8',
            whiteSpace:'nowrap', flexShrink:0,
          }}
          onMouseEnter={e => { e.currentTarget.style.background=C.green+'22'; e.currentTarget.style.color=C.green; }}
          onMouseLeave={e => { e.currentTarget.style.background=C.green+'11'; e.currentTarget.style.color=C.green+'aa'; }}
        >HEALTH</button>

        {/* Divider between pinned and recent */}
        {names.length > 0 && <div style={{width:1, height:14, background:C.border2, flexShrink:0, margin:'0 2px'}}/>}

        {/* Recent project chips */}
        {names.map(name => {
          const active = todayTags.has(name.toLowerCase());
          const col = projectColor(name);
          return (
            <button
              key={name}
              onClick={() => onSelectProject(name)}
              style={{
                background: active ? col+'22' : 'transparent',
                border:`1px solid ${active ? col+'55' : C.border2}`,
                borderRadius:20, padding:'2px 10px',
                fontFamily:mono, fontSize:F.sm, color: active ? col : C.muted,
                cursor:'pointer', opacity: active ? 1 : 0.35,
                transition:'opacity 0.15s, color 0.15s',
                letterSpacing:'0.03em', lineHeight:'1.8',
                whiteSpace:'nowrap', flexShrink:0,
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity='1'; e.currentTarget.style.color=col; }}
              onMouseLeave={e => { e.currentTarget.style.opacity=active?'1':'0.35'; e.currentTarget.style.color=active?col:C.muted; }}
            >{tagDisplayName(name).toUpperCase()}</button>
          );
        })}
      </div>

      {/* Right fade */}
      <div style={{
        position:'absolute', right:0, top:0, bottom:0, width:32, pointerEvents:'none',
        background:`linear-gradient(to right, transparent, ${C.bg})`,
        opacity: pcFade ? 1 : 0, transition:'opacity 0.12s ease',
      }}/>
    </div>
  );
}

// Shared date formatter used by ProjectView + HealthProjectView
