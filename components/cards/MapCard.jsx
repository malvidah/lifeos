"use client";
import { useState, useEffect, useRef } from "react";
import { mono, F, projectColor } from "@/lib/tokens";
import { tagDisplayName } from "@/lib/tags";
import { Card, ChevronBtn } from "../ui/primitives.jsx";

export function MapCard({ allTags, connections, onSelectProject, token, userId, taskFilter, setTaskFilter }) {
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
    const tagList = allTags || [];
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
        label: tagDisplayName(name).toUpperCase(),
        color: projectColor(name),
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
        borderBottom: graphCollapsed ? 'none' : "1px solid var(--dl-border)",
        flexShrink:0, cursor:'pointer' }}
        onClick={() => setGraphCollapsed(c => !c)}>
        <ChevronBtn collapsed={graphCollapsed} onToggle={e => { e.stopPropagation(); setGraphCollapsed(c => !c); }}/>
        <span style={{ fontFamily:mono, fontSize:F.sm, letterSpacing:'0.06em',
          textTransform:'uppercase', color:"var(--dl-muted)", flex:1 }}>Map</span>
        {!graphCollapsed && (
          <span style={{ fontFamily:mono, fontSize:9, color:"var(--dl-dim)" }}>
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
              fontFamily:mono, fontSize:F.sm, color:"var(--dl-dim)" }}>
              Laying out graph…
            </div>
          )}
          {ready && (
            <svg width="100%" height="100%" style={{ display:'block' }}>
              <defs>
                <pattern id="dotgrid" x={tx % (24 * scale)} y={ty % (24 * scale)}
                  width={24 * scale} height={24 * scale} patternUnits="userSpaceOnUse">
                  <circle cx={12 * scale} cy={12 * scale}
                    r={Math.max(0.6, scale * 0.7)} fill={"var(--dl-border2)"} opacity="0.7"/>
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
                style={{ width:30, height:30, background:"var(--dl-surface)",
                  border:"1px solid var(--dl-border2)", borderRadius:6,
                  color:"var(--dl-muted)", fontFamily:mono, fontSize:16, cursor:'pointer',
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
