"use client";
import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { useTheme } from "../theme/ThemeContext.jsx";
import { mono, serif, F, R } from "../theme/tokens.js";
import { todayKey, toKey, fmtDate } from "../utils/dates.js";
import { tagDisplayName, extractTags, extractTagsFromAll } from "../utils/tags.js";
import { projectColor, Card, ChevronBtn, TaskFilterBtns, RichLine, NavigationContext } from "../ui/index.jsx";
import { createClient } from "../../lib/supabase.js";
const TAGS_CACHE = { tags: null, connections: [], recency: {} };

// ─── ProjectsCard ─────────────────────────────────────────────────────────────
// Source of truth: #tags present in the DB (notes + tasks). projectsMeta is
// metadata-only (description). No tag in DB = no project button, period.
export function MapCard({ allTags, connections, onSelectProject, token, userId, taskFilter, setTaskFilter }) {
  const { C } = useTheme();
  const graphRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [scale, setScale] = useState(1);
  const [hovered, setHovered] = useState(null);
  const [graphCollapsed, setGraphCollapsed] = useState(false);
  const containerRef = useRef(null);
  const dragStart = useRef(null);

  useEffect(() => {
    const tagList = ['__health__', ...(allTags || [])];
    const lower = tagList.map(t => t.toLowerCase());
    const idxOf = {};
    lower.forEach((t, i) => { idxOf[t] = i; });

    const deg = new Array(tagList.length).fill(0);
    const edges = [];
    for (const c of (connections || [])) {
      const si = idxOf[c.source];
      const ti = idxOf[c.target];
      if (si == null || ti == null) continue;
      const w = Math.min(c.weight, 10);
      edges.push({ si, ti, w });
      deg[si]++;
      deg[ti]++;
    }
    const maxDeg = Math.max(1, ...deg);

    const n = tagList.length;
    const nodes = tagList.map((name, i) => {
      const angle = (i / n) * Math.PI * 2;
      const radius = 180 + (deg[i] / maxDeg) * 80;
      return {
        id: name,
        label: name === '__health__' ? 'HEALTH' : tagDisplayName(name).toUpperCase(),
        color: name === '__health__' ? C.green : projectColor(name),
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        vx: 0, vy: 0,
        r: 16 + (deg[i] / maxDeg) * 14,
      };
    });

    const K = Math.sqrt((700 * 700) / Math.max(n, 1)) * 0.9;
    for (let iter = 0; iter < 280; iter++) {
      const alpha = (1 - iter / 280) * (1 - iter / 280);
      for (let a = 0; a < nodes.length; a++) {
        for (let b = a + 1; b < nodes.length; b++) {
          const na = nodes[a]; const nb = nodes[b];
          let ddx = nb.x - na.x || 0.1; let ddy = nb.y - na.y || 0.1;
          const dd = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
          const ff = (K * K / dd) * alpha * 0.5;
          na.vx -= (ddx / dd) * ff; na.vy -= (ddy / dd) * ff;
          nb.vx += (ddx / dd) * ff; nb.vy += (ddy / dd) * ff;
        }
      }
      for (const edge of edges) {
        const na = nodes[edge.si]; const nb = nodes[edge.ti];
        let ddx = nb.x - na.x; let ddy = nb.y - na.y;
        const dd = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
        const rest = K * (1.1 - edge.w * 0.04);
        const ff = (dd - rest) * 0.2 * alpha;
        na.vx += (ddx / dd) * ff; na.vy += (ddy / dd) * ff;
        nb.vx -= (ddx / dd) * ff; nb.vy -= (ddy / dd) * ff;
      }
      for (const node of nodes) {
        node.vx -= node.x * 0.012 * alpha;
        node.vy -= node.y * 0.012 * alpha;
        node.x += node.vx * 0.4;
        node.y += node.vy * 0.4;
        node.vx *= 0.7;
        node.vy *= 0.7;
      }
    }

    {
      const xs = nodes.map(nd => nd.x), ys = nodes.map(nd => nd.y);
      const mnX = Math.min(...xs), mxX = Math.max(...xs);
      const mnY = Math.min(...ys), mxY = Math.max(...ys);
      const spanX = mxX - mnX || 1, spanY = mxY - mnY || 1;
      nodes.forEach(nd => {
        nd.x = ((nd.x - mnX) / spanX - 0.5) * 600;
        nd.y = ((nd.y - mnY) / spanY - 0.5) * 400;
      });
    }

    graphRef.current = { nodes, edges };
    setReady(true);

    function doFit() {
      if (!containerRef.current) return;
      var rect = containerRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) { requestAnimationFrame(doFit); return; }
      var allX = nodes.map(nd => nd.x);
      var allY = nodes.map(nd => nd.y);
      var minX = Math.min.apply(null, allX) - 40;
      var maxX = Math.max.apply(null, allX) + 40;
      var minY = Math.min.apply(null, allY) - 40;
      var maxY = Math.max.apply(null, allY) + 40;
      var gW = maxX - minX, gH = maxY - minY;
      var newScale = Math.min(rect.width / gW, rect.height / gH) * 0.92;
      setScale(newScale);
      setTx(rect.width / 2 - ((minX + maxX) / 2) * newScale);
      setTy(rect.height / 2 - ((minY + maxY) / 2) * newScale);
    }
    requestAnimationFrame(doFit);
  }, []); // eslint-disable-line

  const PILL_SCALE = 0.85;
  const edgeAlpha = Math.max(0, Math.min(1, (scale - 0.2) / 0.4));

  function handleWheel(e) {
    e.preventDefault();
    if (!containerRef.current) return;
    var rect = containerRef.current.getBoundingClientRect();
    var mx = e.clientX - rect.left, my = e.clientY - rect.top;
    var factor = e.deltaY < 0 ? 1.12 : 0.89;
    setScale(prev => Math.max(0.12, Math.min(3, prev * factor)));
    setTx(prev => mx - (mx - prev) * factor);
    setTy(prev => my - (my - prev) * factor);
  }
  function handleMouseDown(e) {
    if (e.target.closest('[data-node]')) return;
    dragStart.current = { cx: e.clientX, cy: e.clientY, ox: tx, oy: ty };
  }
  function handleMouseMove(e) {
    if (!dragStart.current) return;
    setTx(dragStart.current.ox + e.clientX - dragStart.current.cx);
    setTy(dragStart.current.oy + e.clientY - dragStart.current.cy);
  }
  function handleMouseUp() { dragStart.current = null; }

  // Touch pan support for mobile
  const touchStart = useRef(null);
  function handleTouchStart(e) {
    if (e.touches.length === 1) {
      touchStart.current = { cx: e.touches[0].clientX, cy: e.touches[0].clientY, ox: tx, oy: ty };
    }
  }
  function handleTouchMove(e) {
    if (!touchStart.current || e.touches.length !== 1) return;
    e.preventDefault();
    setTx(touchStart.current.ox + e.touches[0].clientX - touchStart.current.cx);
    setTy(touchStart.current.oy + e.touches[0].clientY - touchStart.current.cy);
  }
  function handleTouchEnd() { touchStart.current = null; }

  const { nodes, edges } = graphRef.current || { nodes: [], edges: [] };

  // Render as a plain Widget-style card — no outer wrapper, no rogue margins
  return (
    <Card style={{ height: 'auto' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'11px 14px',
        borderBottom: graphCollapsed ? 'none' : `1px solid ${C.border}`,
        flexShrink:0, cursor:'pointer' }}
        onClick={() => setGraphCollapsed(c => !c)}>
        <ChevronBtn collapsed={graphCollapsed} onToggle={e => { e.stopPropagation(); setGraphCollapsed(c => !c); }}/>
        <span style={{ fontFamily:mono, fontSize:F.sm, letterSpacing:'0.06em',
          textTransform:'uppercase', color:C.muted, flex:1 }}>Map</span>
        {!graphCollapsed && (
          <span style={{ fontFamily:mono, fontSize:9, color:C.dim }}>
            {(allTags||[]).length + 1} projects · pinch/scroll to zoom
          </span>
        )}
      </div>

      {/* Canvas */}
      {!graphCollapsed && (
        <div ref={containerRef}
          style={{ height: 340, position:'relative', overflow:'hidden',
            cursor: dragStart.current ? 'grabbing' : 'grab' }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart} onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}>
          {!ready && (
            <div style={{ position:'absolute', inset:0, display:'flex',
              alignItems:'center', justifyContent:'center',
              fontFamily:mono, fontSize:F.sm, color:C.dim }}>
              Laying out graph…
            </div>
          )}
          {ready && (
            <svg width="100%" height="100%" style={{ display:'block' }}>
              <defs>
                <pattern id="dotgrid" x={tx % (24 * scale)} y={ty % (24 * scale)}
                  width={24 * scale} height={24 * scale} patternUnits="userSpaceOnUse">
                  <circle cx={12 * scale} cy={12 * scale}
                    r={Math.max(0.6, scale * 0.7)} fill={C.border2} opacity="0.7"/>
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#dotgrid)"/>
              <g transform={`translate(${tx},${ty}) scale(${scale})`}>
                {edgeAlpha > 0 && edges.map((edge, i) => {
                  const na = nodes[edge.si]; const nb = nodes[edge.ti];
                  if (!na || !nb) return null;
                  return (
                    <line key={i} x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                      stroke={na.color}
                      strokeWidth={Math.max(0.4, edge.w * 0.35)}
                      strokeOpacity={edgeAlpha * 0.15 * Math.min(1, edge.w / 2)}/>
                  );
                })}
                {nodes.map((node, i) => {
                  const isPill = scale >= PILL_SCALE;
                  const isHov = hovered === i;
                  const col = node.color;
                  const pw = node.label.length * 7.2 + 26;
                  return (
                    <g key={node.id} data-node="1"
                      transform={`translate(${node.x},${node.y})`}
                      style={{ cursor:'pointer' }}
                      onClick={() => onSelectProject(node.id)}
                      onMouseEnter={() => setHovered(i)}
                      onMouseLeave={() => setHovered(null)}>
                      {isPill ? (
                        <>
                          <rect x={-pw/2} y={-13} width={pw} height={26} rx={13}
                            fill={isHov ? col+'33' : col+'18'}
                            stroke={isHov ? col : col+'55'}
                            strokeWidth={isHov ? 1.5 : 1}/>
                          <text x={0} y={4} textAnchor="middle"
                            style={{ fontFamily:mono, fontSize:10.5, fill:isHov ? col : col+'cc',
                              letterSpacing:'0.06em', pointerEvents:'none', userSelect:'none' }}>
                            {node.label}
                          </text>
                        </>
                      ) : (
                        <>
                          <circle r={node.r}
                            fill={isHov ? col+'33' : col+'18'}
                            stroke={isHov ? col : col+'55'}
                            strokeWidth={isHov ? 2 : 1.5}/>
                          {scale >= 0.32 && (
                            <text y={node.r + 11} textAnchor="middle"
                              style={{ fontFamily:mono, fontSize:Math.max(8, 9 / scale),
                                fill:col+'99', pointerEvents:'none', userSelect:'none' }}>
                              {node.label.length > 9 ? node.label.slice(0,8)+'…' : node.label}
                            </text>
                          )}
                        </>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
          {/* Zoom buttons */}
          <div style={{ position:'absolute', bottom:12, right:12,
            display:'flex', flexDirection:'column', gap:4 }}>
            {[{label:'+',f:1.25},{label:'−',f:0.8}].map(({label,f}) => (
              <button key={label}
                onClick={() => setScale(prev => Math.max(0.12, Math.min(3, prev * f)))}
                style={{ width:30, height:30, background:C.surface,
                  border:`1px solid ${C.border2}`, borderRadius:6,
                  color:C.muted, fontFamily:mono, fontSize:16, cursor:'pointer',
                  display:'flex', alignItems:'center', justifyContent:'center' }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// Module-level cache: survives ProjectsCard mount/unmount so the nav never flashes empty.
export function ProjectsCard({ date, token, userId, onSelectProject }) {
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
      fetch('/api/all-tags', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      fetch('/api/tag-connections', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    ]).then(function(results) {
      var tagsRes = results[0];
      var connsRes = results[1];
      const tags = Array.isArray(tagsRes.tags) ? tagsRes.tags : [];
      const conns = Array.isArray(connsRes.connections) ? connsRes.connections : [];
      const rec = connsRes.recency || {};
      TAGS_CACHE.tags = tags; TAGS_CACHE.connections = conns; TAGS_CACHE.recency = rec;
      setAllTagsRaw(tags); setConnections(conns); setRecency(rec);
    }).catch(function() { setAllTagsRaw([]); });
  }, [token]); // eslint-disable-line

  // Re-fetch when today's notes/tasks change (new tag added or deleted)
  const prevTagsKey = useRef('');
  useEffect(() => {
    const key = todayTags ? [...todayTags].sort().join(',') : '';
    if (key === prevTagsKey.current || !token) return;
    prevTagsKey.current = key;
    fetch('/api/all-tags', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setAllTags(Array.isArray(d.tags) ? d.tags : []))
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
    window.addEventListener('lifeos:create-project', handler);
    return () => window.removeEventListener('lifeos:create-project', handler);
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
