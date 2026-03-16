"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { mono, serif, F, projectColor } from "@/lib/tokens";
import { tagDisplayName } from "@/lib/tags";

// ── Cairn-inspired color palettes ────────────────────────────────────────────
// Muted earth tones, atmospheric depth, restrained warmth
const SKY_LIGHT = {
  top:    '#C4B8A4',  // warm beige sky
  bottom: '#DED4C0',  // lighter horizon
  mist:   'rgba(210,200,180,0.4)',
};
const SKY_DARK = {
  top:    '#1A1816',  // deep warm black
  bottom: '#2A2520',  // slightly lighter horizon
  mist:   'rgba(20,18,14,0.5)',
};
const MTN_LIGHT = {
  far:    '#B8AE9A',  // distant ridges
  mid:    '#A09882',  // middle range
  near:   '#887E6A',  // foreground
};
const MTN_DARK = {
  far:    '#2A2720',  // distant ridges
  mid:    '#22201A',  // middle range
  near:   '#1A1816',  // foreground
};

// ── Mountain layout computation ──────────────────────────────────────────────
function buildMountains(tags, connections, recency) {
  if (!tags.length) return [];

  const connWeight = {};
  tags.forEach(t => { connWeight[t] = 0; });
  (connections || []).forEach(({ source, target, weight }) => {
    if (connWeight[source] != null) connWeight[source] += weight;
    if (connWeight[target] != null) connWeight[target] += weight;
  });

  const sorted = [...tags].sort((a, b) => (connWeight[b] || 0) - (connWeight[a] || 0));
  const W = 100; // percentage-based for responsive
  const placed = new Map();

  sorted.forEach((tag, i) => {
    const baseX = 50 + (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * (W / (tags.length + 1));
    placed.set(tag, { x: Math.max(8, Math.min(92, baseX)) });
  });

  // Pull connected tags closer
  for (let iter = 0; iter < 5; iter++) {
    (connections || []).forEach(({ source, target, weight }) => {
      const a = placed.get(source);
      const b = placed.get(target);
      if (!a || !b) return;
      const dx = b.x - a.x;
      const pull = dx * 0.04 * Math.min(weight, 5);
      a.x += pull;
      b.x -= pull;
    });
    const arr = [...placed.entries()].sort((a, b) => a[1].x - b[1].x);
    for (let i = 1; i < arr.length; i++) {
      const gap = arr[i][1].x - arr[i - 1][1].x;
      const minGap = 100 / (tags.length + 2);
      if (gap < minGap) {
        const push = (minGap - gap) / 2;
        arr[i][1].x += push;
        arr[i - 1][1].x -= push;
      }
    }
  }

  const maxConn = Math.max(1, ...Object.values(connWeight));

  return tags.map(tag => {
    const { x } = placed.get(tag) || { x: 50 };
    const score = (connWeight[tag] || 0) / maxConn;
    const height = 15 + score * 35; // percentage of viewport height
    const width = 12 + score * 18;
    const color = projectColor(tag);
    const label = tagDisplayName(tag);
    const recent = recency?.[tag];
    const isActive = recent && (Date.now() - new Date(recent).getTime()) < 7 * 86400000;
    return { tag, x, height, width, color, label, isActive };
  });
}

// Generate a mountain SVG path (percentage coordinates)
function mtnPath(cx, peakPct, widthPct, viewW, viewH) {
  const x = (cx / 100) * viewW;
  const w = (widthPct / 100) * viewW;
  const peakY = viewH * (1 - peakPct / 100);
  const baseY = viewH;
  const left = x - w / 2;
  const right = x + w / 2;
  const lShoulder = x - w * 0.12;
  const rShoulder = x + w * 0.15;
  const sY = peakY + (baseY - peakY) * 0.28;

  return `M${left} ${baseY} Q${left + w * 0.18} ${baseY - (baseY - peakY) * 0.3} ${lShoulder} ${sY} `
    + `Q${x - w * 0.04} ${peakY - 4} ${x} ${peakY} `
    + `Q${x + w * 0.06} ${peakY - 2} ${rShoulder} ${sY} `
    + `Q${right - w * 0.15} ${baseY - (baseY - peakY) * 0.25} ${right} ${baseY}Z`;
}

// ── MountainBackground — fixed full-viewport behind cards ────────────────────
export function MountainBackground({ allTags, connections, recency, theme }) {
  const mountains = useMemo(
    () => buildMountains(allTags || [], connections, recency),
    [allTags, connections, recency]
  );

  const sky = theme === 'dark' ? SKY_DARK : SKY_LIGHT;
  const mtn = theme === 'dark' ? MTN_DARK : MTN_LIGHT;
  const W = 1200, H = 600;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
      background: `linear-gradient(180deg, ${sky.top} 0%, ${sky.bottom} 100%)`,
    }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice"
        style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '100%' }}>

        {/* Far distant ridges */}
        <path d={`M0 ${H * 0.6} Q${W * 0.15} ${H * 0.38} ${W * 0.3} ${H * 0.52} Q${W * 0.5} ${H * 0.32} ${W * 0.7} ${H * 0.48} Q${W * 0.85} ${H * 0.36} ${W} ${H * 0.55} L${W} ${H} L0 ${H}Z`}
          fill={mtn.far} opacity="0.5" />
        <path d={`M0 ${H * 0.68} Q${W * 0.2} ${H * 0.45} ${W * 0.4} ${H * 0.58} Q${W * 0.55} ${H * 0.42} ${W * 0.75} ${H * 0.55} Q${W * 0.9} ${H * 0.48} ${W} ${H * 0.62} L${W} ${H} L0 ${H}Z`}
          fill={mtn.mid} opacity="0.4" />

        {/* Project mountains */}
        {[...mountains].sort((a, b) => a.height - b.height).map(m => (
          <path key={m.tag}
            d={mtnPath(m.x, m.height, m.width, W, H)}
            fill={m.color} opacity={0.12}
          />
        ))}
        {mountains.map(m => (
          <path key={`stroke-${m.tag}`}
            d={mtnPath(m.x, m.height, m.width, W, H)}
            fill="none" stroke={m.color} strokeWidth="0.5" opacity="0.2"
          />
        ))}

        {/* Mist at base */}
        <rect x="0" y={H * 0.75} width={W} height={H * 0.25} fill={sky.mist} />
      </svg>
    </div>
  );
}

// ── MapCard — floating label overlay (replaces old graph card) ───────────────
const PILL_H = 24, PILL_RX = 12, CHAR_W = 7;

export function MapCard({ allTags, connections, recency, onSelectProject }) {
  const [hovered, setHovered] = useState(null);

  const mountains = useMemo(
    () => buildMountains(allTags || [], connections, recency),
    [allTags, connections, recency]
  );

  if (!mountains.length) return null;

  // Render just the clickable labels — mountains are in the background
  return (
    <div style={{ position: 'relative', height: 280, pointerEvents: 'none' }}>
      <svg viewBox="0 0 1200 600" preserveAspectRatio="xMidYMax meet"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        {mountains.map(m => {
          const isHov = hovered === m.tag;
          const pillW = m.label.length * CHAR_W + 24;
          const x = (m.x / 100) * 1200;
          const peakY = 600 * (1 - m.height / 100);

          return (
            <g key={m.tag}
              onMouseEnter={() => setHovered(m.tag)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onSelectProject(m.tag)}
              style={{ cursor: 'pointer', pointerEvents: 'auto' }}
            >
              {/* Vertical line from peak to label */}
              <line x1={x} y1={peakY} x2={x} y2={peakY - 30}
                stroke={m.color} strokeWidth="0.5" opacity={isHov ? 0.5 : 0.2} />

              {/* Label pill */}
              <rect
                x={x - pillW / 2} y={peakY - 30 - PILL_H}
                width={pillW} height={PILL_H} rx={PILL_RX}
                fill={isHov ? m.color : 'var(--dl-card)'}
                fillOpacity={isHov ? 0.9 : 0.8}
                stroke={m.color}
                strokeWidth={isHov ? 1.5 : 0.5}
                strokeOpacity={isHov ? 0.8 : 0.3}
              />
              <text
                x={x} y={peakY - 30 - PILL_H / 2}
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

              {/* Active dot */}
              {m.isActive && (
                <circle cx={x + pillW / 2 - 4} cy={peakY - 30 - PILL_H + 4}
                  r="3" fill={m.color} opacity="0.6" />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
