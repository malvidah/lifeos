"use client";
import { useState, useEffect, useRef } from "react";
import { mono, F, projectColor } from "@/lib/tokens";
import { tagDisplayName } from "@/lib/tags";
import { Card, ChevronBtn } from "../ui/primitives.jsx";

const CHAR_W = 7.4, PILL_PAD = 28, PILL_H = 26, PILL_RX = 13;

export function MapCard({ allTags, connections, onSelectProject }) {
  const graphRef = useRef(null);
  const [ready, setReady]               = useState(false);
  const [tx, setTx]                     = useState(0);
  const [ty, setTy]                     = useState(0);
  const [scale, setScale]               = useState(1);
  const [hovered, setHovered]           = useState(null);
  const [graphCollapsed, setGraphCollapsed] = useState(false);
  const containerRef = useRef(null);
  const dragStart    = useRef(null);
  const touchStart   = useRef(null);

  useEffect(() => {
    setReady(false);
    const tagList = allTags || [];
    if (!tagList.length) return;

    const idxOf = {};
    tagList.forEach((t, i) => { idxOf[t.toLowerCase()] = i; });

    // Build edges + weighted degree
    const wdeg = new Array(tagList.length).fill(0);
    const edges = [];
    for (const c of (connections || [])) {
      const si = idxOf[c.source?.toLowerCase()];
      const ti = idxOf[c.target?.toLowerCase()];
      if (si == null || ti == null) continue;
      const w = Math.min(c.weight || 1, 10);
      edges.push({ si, ti, w });
      wdeg[si] += w;
      wdeg[ti] += w;
    }
    const maxDeg = Math.max(1, ...wdeg);

    const n = tagList.length;
    const nodes = tagList.map((name, i) => {
      const label = tagDisplayName(name).toUpperCase();
      const pw    = label.length * CHAR_W + PILL_PAD;
      const angle = (i / n) * Math.PI * 2;
      const radius = 220 + (wdeg[i] / maxDeg) * 120;
      return {
        id: name, label, color: projectColor(name),
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        vx: 0, vy: 0,
        pw, // half-width used for repulsion
      };
    });

    // Force-directed layout — pill-aware repulsion so labels never overlap
    const K = Math.sqrt((900 * 700) / Math.max(n, 1)) * 1.05;
    for (let iter = 0; iter < 320; iter++) {
      const alpha = Math.pow(1 - iter / 320, 1.8);

      // Repulsion
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
          const na = nodes[a], nb = nodes[b];
          let dx = nb.x - na.x || 0.1, dy = nb.y - na.y || 0.1;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const minD = (na.pw + nb.pw) / 2 + 36;
          const rep  = (K * K / d) * alpha * 0.5;
          const ovlp = d < minD ? (minD - d) * 2.5 * alpha : 0;
          const f = rep + ovlp;
          na.vx -= (dx / d) * f; na.vy -= (dy / d) * f;
          nb.vx += (dx / d) * f; nb.vy += (dy / d) * f;
        }
      }

      // Attraction along edges
      for (const e of edges) {
        const na = nodes[e.si], nb = nodes[e.ti];
        const dx = nb.x - na.x, dy = nb.y - na.y;
        const d  = Math.sqrt(dx * dx + dy * dy) || 1;
        const rest = K * Math.max(0.35, 1.15 - e.w * 0.05);
        const f = (d - rest) * 0.18 * alpha;
        na.vx += (dx / d) * f; na.vy += (dy / d) * f;
        nb.vx -= (dx / d) * f; nb.vy -= (dy / d) * f;
      }

      // Centre gravity + integrate
      for (const node of nodes) {
        node.vx -= node.x * 0.011 * alpha;
        node.vy -= node.y * 0.011 * alpha;
        node.x  += node.vx * 0.42;
        node.y  += node.vy * 0.42;
        node.vx *= 0.68;
        node.vy *= 0.68;
      }
    }

    // Normalise to canvas space
    const xs = nodes.map(nd => nd.x), ys = nodes.map(nd => nd.y);
    const mnX = Math.min(...xs), mxX = Math.max(...xs);
    const mnY = Math.min(...ys), mxY = Math.max(...ys);
    const spanX = mxX - mnX || 1, spanY = mxY - mnY || 1;
    nodes.forEach(nd => {
      nd.x = ((nd.x - mnX) / spanX - 0.5) * 740;
      nd.y = ((nd.y - mnY) / spanY - 0.5) * 520;
    });

    graphRef.current = { nodes, edges };
    setReady(true);

    function doFit() {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (!rect.width || !rect.height) { requestAnimationFrame(doFit); return; }
      const pad = 56;
      const minX = Math.min(...nodes.map(nd => nd.x - nd.pw / 2)) - pad;
      const maxX = Math.max(...nodes.map(nd => nd.x + nd.pw / 2)) + pad;
      const minY = Math.min(...nodes.map(nd => nd.y - PILL_H / 2)) - pad;
      const maxY = Math.max(...nodes.map(nd => nd.y + PILL_H / 2)) + pad;
      const newScale = Math.min(rect.width / (maxX - minX), rect.height / (maxY - minY)) * 0.94;
      setScale(newScale);
      setTx(rect.width  / 2 - ((minX + maxX) / 2) * newScale);
      setTy(rect.height / 2 - ((minY + maxY) / 2) * newScale);
    }
    requestAnimationFrame(doFit);
  }, [allTags, connections]); // eslint-disable-line

  // ── Interaction handlers ────────────────────────────────────────────────────
  function handleWheel(e) {
    e.preventDefault();
    if (!containerRef.current) return;
    const rect   = containerRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    setScale(p => Math.max(0.12, Math.min(4, p * factor)));
    setTx(p => mx - (mx - p) * factor);
    setTy(p => my - (my - p) * factor);
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
  function handleTouchStart(e) {
    if (e.touches.length === 1)
      touchStart.current = { cx: e.touches[0].clientX, cy: e.touches[0].clientY, ox: tx, oy: ty };
  }
  function handleTouchMove(e) {
    if (!touchStart.current || e.touches.length !== 1) return;
    e.preventDefault();
    setTx(touchStart.current.ox + e.touches[0].clientX - touchStart.current.cx);
    setTy(touchStart.current.oy + e.touches[0].clientY - touchStart.current.cy);
  }
  function handleTouchEnd() { touchStart.current = null; }

  const { nodes, edges } = graphRef.current || { nodes: [], edges: [] };

  return (
    <Card style={{ height: 'auto' }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'11px 14px',
        borderBottom: graphCollapsed ? 'none' : "1px solid var(--dl-border)",
        flexShrink:0, cursor:'pointer' }}
        onClick={() => setGraphCollapsed(c => !c)}>
        <ChevronBtn collapsed={graphCollapsed} onToggle={e => { e.stopPropagation(); setGraphCollapsed(c => !c); }}/>
        <span style={{ fontFamily:mono, fontSize:F.sm, letterSpacing:'0.06em',
          textTransform:'uppercase', color:"var(--dl-highlight)", flex:1 }}>Map</span>
        {!graphCollapsed && (
          <span style={{ fontFamily:mono, fontSize:9, color:"var(--dl-middle)" }}>
            {(allTags||[]).length} projects · scroll to zoom
          </span>
        )}
      </div>

      {/* ── Canvas ─────────────────────────────────────────────────────────── */}
      {!graphCollapsed && (
        <div ref={containerRef}
          style={{ height:400, position:'relative', overflow:'hidden',
            cursor: dragStart.current ? 'grabbing' : 'grab' }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart} onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}>

          {!ready && (
            <div style={{ position:'absolute', inset:0, display:'flex',
              alignItems:'center', justifyContent:'center',
              fontFamily:mono, fontSize:F.sm, color:"var(--dl-middle)" }}>
              Laying out graph…
            </div>
          )}

          {ready && (
            <svg width="100%" height="100%" style={{ display:'block', position:'absolute', inset:0 }}>
              {/* Dot-grid background */}
              <defs>
                <pattern id="mapgrid" x={tx % (24 * scale)} y={ty % (24 * scale)}
                  width={24 * scale} height={24 * scale} patternUnits="userSpaceOnUse">
                  <circle cx={12 * scale} cy={12 * scale}
                    r={Math.max(0.5, scale * 0.65)} fill="var(--dl-border2)" opacity="0.6"/>
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#mapgrid)"/>

              <g transform={`translate(${tx},${ty}) scale(${scale})`}>
                {/* Gradient defs live inside the transform so userSpaceOnUse coords match */}
                <defs>
                  {edges.map((e, i) => {
                    const na = nodes[e.si], nb = nodes[e.ti];
                    if (!na || !nb) return null;
                    return (
                      <linearGradient key={i} id={`eg${i}`} gradientUnits="userSpaceOnUse"
                        x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}>
                        <stop offset="0%"   stopColor={na.color} stopOpacity={0.55}/>
                        <stop offset="100%" stopColor={nb.color} stopOpacity={0.55}/>
                      </linearGradient>
                    );
                  })}
                </defs>

                {/* Edges */}
                {edges.map((e, i) => {
                  const na = nodes[e.si], nb = nodes[e.ti];
                  if (!na || !nb) return null;
                  const isHovEdge = hovered === e.si || hovered === e.ti;
                  const baseOp    = Math.min(0.55, 0.08 + e.w * 0.04);
                  return (
                    <line key={i} x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                      stroke={`url(#eg${i})`}
                      strokeWidth={isHovEdge ? Math.max(1, e.w * 0.55) : Math.max(0.5, e.w * 0.3)}
                      strokeOpacity={isHovEdge ? Math.min(0.85, baseOp * 2.5) : baseOp}
                      strokeLinecap="round"/>
                  );
                })}

                {/* Pill nodes */}
                {nodes.map((node, i) => {
                  const isHov = hovered === i;
                  const col   = node.color;
                  const pw    = node.pw;
                  return (
                    <g key={node.id} data-node="1"
                      transform={`translate(${node.x},${node.y})`}
                      style={{ cursor:'pointer' }}
                      onClick={() => onSelectProject(node.id)}
                      onMouseEnter={() => setHovered(i)}
                      onMouseLeave={() => setHovered(null)}>
                      {/* Pill body */}
                      <rect x={-pw / 2} y={-PILL_H / 2} width={pw} height={PILL_H} rx={PILL_RX}
                        fill={isHov ? col + '38' : col + '16'}
                        stroke={isHov ? col : col + '60'}
                        strokeWidth={isHov ? 1.5 : 1}/>
                      {/* Label */}
                      <text x={0} y={4} textAnchor="middle"
                        style={{ fontFamily:mono, fontSize:10, letterSpacing:'0.055em',
                          fill: isHov ? col : col + 'bb',
                          pointerEvents:'none', userSelect:'none' }}>
                        {node.label}
                      </text>
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
                onClick={() => setScale(p => Math.max(0.12, Math.min(4, p * f)))}
                style={{ width:30, height:30, background:"var(--dl-surface)",
                  border:"1px solid var(--dl-border2)", borderRadius:6,
                  color:"var(--dl-highlight)", fontFamily:mono, fontSize:16,
                  cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
