"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { mono, serif, F, projectColor } from "@/lib/tokens";
import { tagDisplayName } from "@/lib/tags";
import { Card } from "../ui/primitives.jsx";

// ── Mountain Range ───────────────────────────────────────────────────────────
// Each project = a mountain peak. Height = data volume, proximity = connections.

const PILL_H = 24, PILL_RX = 12, CHAR_W = 7;

function buildMountains(tags, connections, recency) {
  if (!tags.length) return [];

  // Count connections per tag and total weight
  const connCount = {};
  const connWeight = {};
  tags.forEach(t => { connCount[t] = 0; connWeight[t] = 0; });
  (connections || []).forEach(({ source, target, weight }) => {
    if (connCount[source] != null) { connCount[source] += weight; connWeight[source] += weight; }
    if (connCount[target] != null) { connCount[target] += weight; connWeight[target] += weight; }
  });

  // Sort by total connection weight (most connected = center)
  const sorted = [...tags].sort((a, b) => (connWeight[b] || 0) - (connWeight[a] || 0));

  // Place mountains using a connection-based layout:
  // Most connected tag goes to center, then place connected tags nearby
  const placed = new Map();
  const W = 1200;
  const centerX = W / 2;

  // Place first (most connected) at center
  sorted.forEach((tag, i) => {
    // Spread evenly but cluster connected ones
    const baseX = centerX + (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * (W / (tags.length + 1));
    placed.set(tag, { x: Math.max(60, Math.min(W - 60, baseX)) });
  });

  // Refine positions: pull connected tags closer together
  for (let iter = 0; iter < 5; iter++) {
    (connections || []).forEach(({ source, target, weight }) => {
      const a = placed.get(source);
      const b = placed.get(target);
      if (!a || !b) return;
      const dx = b.x - a.x;
      const pull = dx * 0.05 * Math.min(weight, 5);
      a.x += pull;
      b.x -= pull;
    });
    // Push apart if too close
    const arr = [...placed.entries()].sort((a, b) => a[1].x - b[1].x);
    for (let i = 1; i < arr.length; i++) {
      const gap = arr[i][1].x - arr[i - 1][1].x;
      const minGap = 80;
      if (gap < minGap) {
        const push = (minGap - gap) / 2;
        arr[i][1].x += push;
        arr[i - 1][1].x -= push;
      }
    }
  }

  // Build mountain data
  const maxConn = Math.max(1, ...Object.values(connWeight));
  const BASE_Y = 280;
  const MIN_H = 50;
  const MAX_H = 200;

  return tags.map(tag => {
    const { x } = placed.get(tag) || { x: centerX };
    const score = (connWeight[tag] || 0) / maxConn;
    const height = MIN_H + score * (MAX_H - MIN_H);
    const width = 80 + score * 120; // wider base for more connected projects
    const peakY = BASE_Y - height;
    const color = projectColor(tag);
    const label = tagDisplayName(tag);
    const recent = recency?.[tag];
    const isActive = recent && (Date.now() - new Date(recent).getTime()) < 7 * 86400000; // active within 7 days

    return { tag, x, peakY, height, width, color, label, isActive, baseY: BASE_Y };
  });
}

function mountainPath(x, peakY, width, baseY) {
  // Natural mountain shape with slight asymmetry
  const left = x - width / 2;
  const right = x + width / 2;
  const peakOffset = (Math.random() - 0.5) * width * 0.05; // subtle asymmetry
  // Ridge shoulders
  const lShoulder = x - width * 0.15;
  const rShoulder = x + width * 0.18;
  const shoulderY = peakY + (baseY - peakY) * 0.25;

  return `M ${left} ${baseY} `
    + `Q ${left + width * 0.15} ${baseY - (baseY - peakY) * 0.3}, ${lShoulder} ${shoulderY} `
    + `Q ${x - width * 0.05} ${peakY - 5}, ${x + peakOffset} ${peakY} `
    + `Q ${x + width * 0.08} ${peakY - 3}, ${rShoulder} ${shoulderY} `
    + `Q ${right - width * 0.12} ${baseY - (baseY - peakY) * 0.25}, ${right} ${baseY} Z`;
}

export function MapCard({ allTags, connections, onSelectProject, recency }) {
  const [hovered, setHovered] = useState(null);
  const svgRef = useRef(null);

  const mountains = useMemo(
    () => buildMountains(allTags || [], connections, recency),
    [allTags, connections, recency]
  );

  if (!mountains.length) {
    return (
      <Card style={{ height: 'auto' }}>
        <div style={{ padding: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: mono, fontSize: F.sm, color: "var(--dl-middle)" }}>
          No projects yet
        </div>
      </Card>
    );
  }

  const W = 1200, H = 320;

  // Background mountain silhouettes (decorative, no interaction)
  const bgRidges = [
    `M 0 ${H * 0.7} Q ${W * 0.15} ${H * 0.35} ${W * 0.3} ${H * 0.55} Q ${W * 0.5} ${H * 0.3} ${W * 0.7} ${H * 0.5} Q ${W * 0.85} ${H * 0.35} ${W} ${H * 0.6} L ${W} ${H} L 0 ${H} Z`,
    `M 0 ${H * 0.8} Q ${W * 0.2} ${H * 0.5} ${W * 0.4} ${H * 0.65} Q ${W * 0.6} ${H * 0.45} ${W * 0.8} ${H * 0.6} Q ${W * 0.9} ${H * 0.5} ${W} ${H * 0.7} L ${W} ${H} L 0 ${H} Z`,
  ];

  return (
    <div style={{ borderRadius: 10, overflow: 'hidden', background: 'var(--dl-well)', position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Background ridges */}
        <path d={bgRidges[0]} fill="var(--dl-border)" opacity="0.15" />
        <path d={bgRidges[1]} fill="var(--dl-border)" opacity="0.1" />

        {/* Project mountains — back to front (tallest first for layering) */}
        {[...mountains].sort((a, b) => a.height - b.height).map(m => {
          const path = mountainPath(m.x, m.peakY, m.width, m.baseY);
          const isHov = hovered === m.tag;
          return (
            <g key={m.tag}
              onMouseEnter={() => setHovered(m.tag)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onSelectProject(m.tag)}
              style={{ cursor: 'pointer' }}
            >
              {/* Mountain body */}
              <path d={path} fill={m.color} opacity={isHov ? 0.35 : 0.18} />
              <path d={path} fill="none" stroke={m.color} strokeWidth={isHov ? 1.5 : 0.5} opacity={isHov ? 0.6 : 0.25} />

              {/* Snow cap on tall peaks */}
              {m.height > 120 && (
                <circle cx={m.x} cy={m.peakY + 3} r={4} fill="#fff" opacity={0.3} />
              )}

              {/* Active glow */}
              {m.isActive && (
                <circle cx={m.x} cy={m.peakY} r={8} fill={m.color} opacity={0.15} />
              )}
            </g>
          );
        })}

        {/* Labels at peaks — rendered on top */}
        {mountains.map(m => {
          const isHov = hovered === m.tag;
          const pillW = m.label.length * CHAR_W + 24;
          return (
            <g key={`label-${m.tag}`}
              onMouseEnter={() => setHovered(m.tag)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onSelectProject(m.tag)}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x={m.x - pillW / 2} y={m.peakY - PILL_H - 6}
                width={pillW} height={PILL_H} rx={PILL_RX}
                fill={isHov ? m.color : 'var(--dl-card)'}
                fillOpacity={isHov ? 0.9 : 0.85}
                stroke={m.color}
                strokeWidth={isHov ? 1.5 : 0.5}
                strokeOpacity={isHov ? 0.8 : 0.3}
              />
              <text
                x={m.x} y={m.peakY - PILL_H / 2 - 4}
                textAnchor="middle" dominantBaseline="central"
                fill={isHov ? '#fff' : m.color}
                style={{
                  fontFamily: mono, fontSize: 10,
                  letterSpacing: '0.08em', textTransform: 'uppercase',
                  fontWeight: isHov ? 600 : 400,
                  pointerEvents: 'none',
                }}
              >
                {m.label.toUpperCase()}
              </text>
            </g>
          );
        })}

        {/* Ground line */}
        <line x1="0" y1={280} x2={W} y2={280} stroke="var(--dl-border)" strokeWidth="0.5" opacity="0.3" />
      </svg>
    </div>
  );
}
