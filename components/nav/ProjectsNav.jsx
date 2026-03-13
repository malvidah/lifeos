"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { mono, F } from "@/lib/tokens";
import { extractTags, tagDisplayName } from "@/lib/tags";
import { useDbSave } from "@/lib/db";
import { useProjects } from "@/lib/useProjects";

export default function ProjectsNav({ date, token, userId, onSelectProject }) {
  const { value: notes } = useDbSave(date, 'journal', '', token, userId);
  const { value: tasks }  = useDbSave(date, 'tasks', [], token, userId);

  const { projects, loaded, getColor, upsertProject } = useProjects(token);

  // Which tags exist in today's entries — drives active/dim chip styling
  const todayTags = useMemo(() => {
    const s = new Set();
    extractTags(notes || '').forEach(t => s.add(t.toLowerCase()));
    (Array.isArray(tasks) ? tasks : []).forEach(r => {
      if (r?.text) extractTags(r.text).forEach(t => s.add(t.toLowerCase()));
    });
    return s;
  }, [notes, tasks]);

  // When /p chip creates a new project, upsert it into the DB immediately
  useEffect(() => {
    const handler = (e) => {
      const name = e.detail?.name;
      if (!name || !token) return;
      upsertProject({ name: name.toLowerCase() });
    };
    window.addEventListener('daylab:create-project', handler);
    return () => window.removeEventListener('daylab:create-project', handler);
  }, [upsertProject, token]); // eslint-disable-line

  // Sort by last_active DESC, show top 6 in the strip
  const topProjects = useMemo(() => {
    if (!projects) return [];
    return [...projects.values()]
      .sort((a, b) => {
        const ra = a.last_active || '0';
        const rb = b.last_active || '0';
        return rb < ra ? -1 : rb > ra ? 1 : 0;
      })
      .slice(0, 6);
  }, [projects]);

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
  }, [topProjects.length]); // eslint-disable-line

  // Preserve strip height during initial load — no layout jump
  if (!loaded) return <div style={{ height: 48 }} />;

  // Package icon SVG
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
      {/* Package icon — opens graph/projects view */}
      <button
        onClick={() => onSelectProject('__graph__')}
        title="All Projects"
        style={{
          background:'none', border:'none', cursor:'pointer',
          padding:'8px 12px', display:'flex', alignItems:'center',
          color:"var(--dl-detail)", flexShrink:0, transition:'color 0.15s',
          minWidth:44, minHeight:44, justifyContent:'center',
        }}
        onMouseEnter={e => e.currentTarget.style.color="var(--dl-middle)"}
        onMouseLeave={e => e.currentTarget.style.color="var(--dl-detail)"}
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
        {/* Health — pinned shortcut to 'health' project */}
        <button
          onClick={() => onSelectProject('health')}
          style={{
            background: "var(--dl-green-07)", border:"1px solid "+"var(--dl-green-20)",
            borderRadius:20, padding:'2px 10px',
            fontFamily:mono, fontSize:F.sm, color:"var(--dl-green-67)",
            cursor:'pointer', transition:'all 0.15s',
            letterSpacing:'0.03em', lineHeight:'1.8',
            whiteSpace:'nowrap', flexShrink:0,
          }}
          onMouseEnter={e => { e.currentTarget.style.background="var(--dl-green-13)"; e.currentTarget.style.color="var(--dl-green)"; }}
          onMouseLeave={e => { e.currentTarget.style.background="var(--dl-green-07)"; e.currentTarget.style.color="var(--dl-green-67)"; }}
        >HEALTH</button>

        {/* Divider between pinned and recent */}
        {topProjects.length > 0 && (
          <div style={{width:1, height:14, background:"var(--dl-border2)", flexShrink:0, margin:'0 2px'}}/>
        )}

        {/* Recent project chips — sorted by last_active from DB */}
        {topProjects.map(p => {
          const active = todayTags.has(p.name.toLowerCase());
          const col = getColor(p.name);
          return (
            <button
              key={p.name}
              onClick={() => onSelectProject(p.name)}
              style={{
                background: active ? col+'22' : 'transparent',
                border:`1px solid ${active ? col+'55' : "var(--dl-border2)"}`,
                borderRadius:20, padding:'2px 10px',
                fontFamily:mono, fontSize:F.sm, color: active ? col : "var(--dl-detail)",
                cursor:'pointer', opacity: active ? 1 : 0.35,
                transition:'opacity 0.15s, color 0.15s',
                letterSpacing:'0.03em', lineHeight:'1.8',
                whiteSpace:'nowrap', flexShrink:0,
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity='1'; e.currentTarget.style.color=col; }}
              onMouseLeave={e => { e.currentTarget.style.opacity=active?'1':'0.35'; e.currentTarget.style.color=active?col:"var(--dl-detail)"; }}
            >{tagDisplayName(p.name).toUpperCase()}</button>
          );
        })}
      </div>

      {/* Right fade overlay */}
      <div style={{
        position:'absolute', right:0, top:0, bottom:0, width:32, pointerEvents:'none',
        background:"linear-gradient(to right, transparent, var(--dl-bg))",
        opacity: pcFade ? 1 : 0, transition:'opacity 0.12s ease',
      }}/>
    </div>
  );
}
