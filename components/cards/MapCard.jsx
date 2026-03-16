"use client";
import { useState, useMemo, useRef, Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import { createNoise2D } from "simplex-noise";
import * as THREE from "three";
import { mono, F, projectColor } from "@/lib/tokens";
import { tagDisplayName } from "@/lib/tags";

// ── Layout ───────────────────────────────────────────────────────────────────
function layoutProjects(tags, connections, recency) {
  if (!tags.length) return [];
  const connWeight = {};
  tags.forEach(t => { connWeight[t] = 0; });
  (connections || []).forEach(({ source, target, weight }) => {
    if (connWeight[source] != null) connWeight[source] += weight;
    if (connWeight[target] != null) connWeight[target] += weight;
  });
  const sorted = [...tags].sort((a, b) => (connWeight[b] || 0) - (connWeight[a] || 0));
  const placed = new Map();
  const baseRadius = sorted.length <= 3 ? 2.0 : 1.8;
  sorted.forEach((tag, i) => {
    const angle = (i / sorted.length) * Math.PI * 2 + Math.PI / 4;
    const radius = i === 0 ? 0 : baseRadius + (i / sorted.length) * 3.0;
    placed.set(tag, { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
  });
  for (let iter = 0; iter < 5; iter++) {
    (connections || []).forEach(({ source, target, weight }) => {
      const a = placed.get(source), b = placed.get(target);
      if (!a || !b) return;
      const pull = 0.015 * Math.min(weight, 5);
      a.x += (b.x - a.x) * pull; a.z += (b.z - a.z) * pull;
      b.x -= (b.x - a.x) * pull; b.z -= (b.z - a.z) * pull;
    });
    const entries = [...placed.entries()];
    for (let j = 0; j < entries.length; j++) {
      for (let k = j + 1; k < entries.length; k++) {
        const a = entries[j][1], b = entries[k][1];
        const dx = a.x - b.x, dz = a.z - b.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const minDist = 2.0;
        if (dist < minDist && dist > 0.01) {
          const push = (minDist - dist) * 0.3 / dist;
          a.x += dx * push; a.z += dz * push;
          b.x -= dx * push; b.z -= dz * push;
        }
      }
    }
  }
  const maxConn = Math.max(1, ...Object.values(connWeight));
  return tags.map(tag => {
    const pos = placed.get(tag) || { x: 0, z: 0 };
    const score = (connWeight[tag] || 0) / maxConn;
    return {
      tag, x: pos.x, z: pos.z,
      height: 0.8 + score * 1.2,
      color: projectColor(tag),
      label: tagDisplayName(tag),
      isActive: recency?.[tag] && (Date.now() - new Date(recency[tag]).getTime()) < 7 * 86400000,
      score,
    };
  });
}

// ── Island radius based on project count ─────────────────────────────────────
function islandRadius(projectCount) {
  // 1 project → 4, grows with sqrt so it doesn't explode
  return 3.5 + Math.sqrt(Math.max(1, projectCount)) * 1.8;
}

// ── Floating island terrain ──────────────────────────────────────────────────
const SEG = 80;
const DEPTH = 2.0;

function buildIslandGeo(projects, radius) {
  const noise2D = createNoise2D();
  const size = radius * 2.2; // grid covers beyond the island edge
  const top = new THREE.PlaneGeometry(size, size, SEG, SEG);
  top.rotateX(-Math.PI / 2);
  const pos = top.attributes.position;

  // Island shape mask — organic circle with noise on the boundary
  function islandMask(x, z) {
    const dist = Math.sqrt(x * x + z * z);
    const angle = Math.atan2(z, x);
    // Wobbly edge using noise
    const wobble = noise2D(Math.cos(angle) * 2, Math.sin(angle) * 2) * 0.15
                 + noise2D(Math.cos(angle * 3) * 1.5, Math.sin(angle * 3) * 1.5) * 0.08;
    const edgeRadius = radius * (0.85 + wobble);
    if (dist > edgeRadius) return 0;
    // Smooth falloff near edge
    const t = dist / edgeRadius;
    if (t > 0.7) return 1 - ((t - 0.7) / 0.3) * ((t - 0.7) / 0.3);
    return 1;
  }

  const hMap = [];

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const mask = islandMask(x, z);

    if (mask <= 0) {
      // Outside island — drop below view
      pos.setY(i, -10);
      hMap.push(-10);
      continue;
    }

    // Base terrain noise
    let h = noise2D(x * 0.3, z * 0.3) * 0.4
          + noise2D(x * 0.7, z * 0.7) * 0.2
          + noise2D(x * 1.5, z * 1.5) * 0.08;

    // Project peaks
    for (const p of projects) {
      const dx = x - p.x, dz = z - p.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const r = 0.6 + p.score * 0.3;
      if (dist < r * 2.0) {
        const f = Math.max(0, 1 - dist / (r * 2.0));
        h += p.height * f * f * f;
      }
    }

    // Apply island mask — terrain fades to sea level at edges
    h = h * mask + (1 - mask) * -0.1;

    pos.setY(i, h);
    hMap.push(h);
  }

  // Cairn-style vertex colors — bold color bands, warm/cool contrast
  // Distinct steps rather than smooth gradients (cell-shaded feel)
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i);
    if (h < -5) { colors[i*3]=0; colors[i*3+1]=0; colors[i*3+2]=0; continue; }
    const x = pos.getX(i), z = pos.getZ(i);
    const t = Math.max(0, Math.min(1, (h + 0.3) / 2.8));
    const n = noise2D(x * 2.5, z * 2.5) * 0.04;
    let r, g, b;
    if (t < 0.1) { r = 0.18 + n; g = 0.25 + n; b = 0.22 + n; }
    else if (t < 0.25) { r = 0.28 + n; g = 0.38 + n; b = 0.25 + n; }
    else if (t < 0.4) { r = 0.48 + n; g = 0.42 + n; b = 0.25 + n; }
    else if (t < 0.6) { r = 0.65 + n; g = 0.45 + n; b = 0.28 + n; }
    else if (t < 0.8) { r = 0.48 + n; g = 0.45 + n; b = 0.48 + n; }
    else { r = 0.85 + n; g = 0.78 + n; b = 0.7 + n; }
    colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
  }
  top.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  top.computeVertexNormals();

  // ── Underside — rocky floating island bottom ────────────────────────────
  // Build a separate geometry for the underside by extruding edge vertices down
  // into a tapered rocky shape
  const underVerts = [], underIdx = [], underCols = [];
  let vOff = 0;
  const step = size / SEG;
  const half = size / 2;

  // For each grid cell, if it has visible vertices, create underside triangles
  for (let row = 0; row < SEG; row++) {
    for (let col = 0; col < SEG; col++) {
      const i00 = row * (SEG + 1) + col;
      const i10 = row * (SEG + 1) + col + 1;
      const i01 = (row + 1) * (SEG + 1) + col;
      const i11 = (row + 1) * (SEG + 1) + col + 1;

      // Skip cells where all vertices are outside the island
      if (hMap[i00] < -5 && hMap[i10] < -5 && hMap[i01] < -5 && hMap[i11] < -5) continue;

      const corners = [i00, i10, i11, i01];
      const anyVisible = corners.some(idx => hMap[idx] > -5);
      if (!anyVisible) continue;

      // Top positions
      for (const idx of corners) {
        const x = pos.getX(idx), y = pos.getY(idx), z = pos.getZ(idx);
        if (y < -5) continue; // skip invisible

        const dist = Math.sqrt(x * x + z * z);
        // Underside tapers toward center — deeper in middle, shallower at edges
        const taper = Math.max(0.3, 1 - dist / (radius * 1.2));
        const bottomY = y - DEPTH * taper;
        // Add noise to underside for rocky look
        const rockNoise = noise2D(x * 1.2 + 50, z * 1.2 + 50) * 0.4
                        + noise2D(x * 2.5 + 50, z * 2.5 + 50) * 0.2;
        const finalBottomY = bottomY + rockNoise * taper;

        underVerts.push(x, finalBottomY, z);
        // Rocky brown colors with variation
        const cv = 0.15 + noise2D(x * 3, z * 3) * 0.08;
        underCols.push(0.25 + cv, 0.18 + cv * 0.5, 0.12 + cv * 0.3);
      }
    }
  }

  // Simpler approach: create underside as a deformed copy of the top surface
  const underGeo = new THREE.PlaneGeometry(size, size, SEG, SEG);
  underGeo.rotateX(Math.PI / 2); // face downward
  const uPos = underGeo.attributes.position;
  const uColors = new Float32Array(uPos.count * 3);

  for (let i = 0; i < uPos.count; i++) {
    const x = uPos.getX(i), z = -uPos.getZ(i); // flip z due to rotation
    const topH = hMap[i] ?? -10;

    if (topH < -5) {
      uPos.setY(i, -10);
      uColors[i*3] = 0; uColors[i*3+1] = 0; uColors[i*3+2] = 0;
      continue;
    }

    const dist = Math.sqrt(x * x + z * z);
    const taper = Math.max(0.2, 1 - dist / (radius * 1.1));
    const rockNoise = noise2D(x * 1.5 + 50, z * 1.5 + 50) * 0.3
                    + noise2D(x * 3 + 50, z * 3 + 50) * 0.15;
    const bottomY = -(DEPTH * taper + Math.abs(rockNoise) * taper * 0.8);

    uPos.setY(i, bottomY);
    const cv = 0.12 + noise2D(x * 3, z * 3) * 0.06;
    uColors[i*3] = 0.28 + cv; uColors[i*3+1] = 0.2 + cv * 0.5; uColors[i*3+2] = 0.14 + cv * 0.3;
  }

  underGeo.setAttribute('color', new THREE.BufferAttribute(uColors, 3));
  underGeo.computeVertexNormals();

  // ── Edge skirt connecting top surface to underside ──────────────────────
  // Walk the boundary of visible vertices and create side walls
  const skirtVerts = [], skirtIdx = [], skirtCols = [];
  let sOff = 0;

  // Find boundary cells — cells where at least one vertex is visible and one is not
  function isVisible(idx) { return hMap[idx] > -5; }

  // Walk each edge of the grid
  for (let row = 0; row <= SEG; row++) {
    for (let col = 0; col <= SEG; col++) {
      const idx = row * (SEG + 1) + col;
      if (!isVisible(idx)) continue;

      // Check if this is a boundary vertex (adjacent to invisible)
      const neighbors = [];
      if (col > 0) neighbors.push(row * (SEG + 1) + col - 1);
      if (col < SEG) neighbors.push(row * (SEG + 1) + col + 1);
      if (row > 0) neighbors.push((row - 1) * (SEG + 1) + col);
      if (row < SEG) neighbors.push((row + 1) * (SEG + 1) + col);

      const isBoundary = neighbors.some(n => !isVisible(n));
      if (!isBoundary) continue;

      // For boundary vertices, check right and down neighbors to form skirt quads
      const right = col < SEG ? row * (SEG + 1) + col + 1 : -1;
      const down = row < SEG ? (row + 1) * (SEG + 1) + col : -1;

      for (const nIdx of [right, down]) {
        if (nIdx < 0 || !isVisible(nIdx)) continue;
        // Check if neighbor is also boundary
        const nNeighbors = [];
        const nCol = nIdx % (SEG + 1), nRow = Math.floor(nIdx / (SEG + 1));
        if (nCol > 0) nNeighbors.push(nRow * (SEG + 1) + nCol - 1);
        if (nCol < SEG) nNeighbors.push(nRow * (SEG + 1) + nCol + 1);
        if (nRow > 0) nNeighbors.push((nRow - 1) * (SEG + 1) + nCol);
        if (nRow < SEG) nNeighbors.push((nRow + 1) * (SEG + 1) + nCol);
        if (!nNeighbors.some(n => !isVisible(n))) continue;

        // Both are boundary — create a skirt quad
        const x0 = pos.getX(idx), y0 = pos.getY(idx), z0 = pos.getZ(idx);
        const x1 = pos.getX(nIdx), y1 = pos.getY(nIdx), z1 = pos.getZ(nIdx);

        const dist0 = Math.sqrt(x0*x0 + z0*z0);
        const dist1 = Math.sqrt(x1*x1 + z1*z1);
        const t0 = Math.max(0.2, 1 - dist0 / (radius * 1.1));
        const t1 = Math.max(0.2, 1 - dist1 / (radius * 1.1));
        const by0 = -(DEPTH * t0);
        const by1 = -(DEPTH * t1);

        skirtVerts.push(x0, y0, z0, x1, y1, z1, x1, by1, z1, x0, by0, z0);
        skirtIdx.push(sOff, sOff+1, sOff+2, sOff, sOff+2, sOff+3);
        const c1 = [0.32, 0.24, 0.16], c2 = [0.22, 0.15, 0.1];
        skirtCols.push(...c1, ...c1, ...c2, ...c2);
        sOff += 4;
      }
    }
  }

  const skirtGeo = new THREE.BufferGeometry();
  if (skirtVerts.length) {
    skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(skirtVerts, 3));
    skirtGeo.setIndex(skirtIdx);
    skirtGeo.setAttribute('color', new THREE.Float32BufferAttribute(skirtCols, 3));
    skirtGeo.computeVertexNormals();
  }

  return { top, underGeo, skirtGeo, hasSkirt: skirtVerts.length > 0 };
}

function Terrain({ projects, radius }) {
  const { top, underGeo, skirtGeo, hasSkirt } = useMemo(
    () => buildIslandGeo(projects, radius), [projects, radius]
  );
  const mat = { flatShading: true, vertexColors: true, roughness: 0.85, metalness: 0.02, side: THREE.FrontSide };
  return (
    <group>
      <mesh geometry={top} receiveShadow castShadow>
        <meshStandardMaterial {...mat} emissiveIntensity={0} />
      </mesh>
      <mesh geometry={underGeo} receiveShadow>
        <meshStandardMaterial flatShading vertexColors roughness={0.9} metalness={0.02} side={THREE.BackSide} />
      </mesh>
      {hasSkirt && (
        <mesh geometry={skirtGeo} receiveShadow>
          <meshStandardMaterial flatShading vertexColors roughness={0.9} metalness={0.02} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

// ── Water — circular, matching island shape ──────────────────────────────────
function Water({ radius }) {
  return (
    <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <circleGeometry args={[radius * 0.9, 64]} />
      <meshStandardMaterial color="#2A5068" roughness={0.3} metalness={0.15} flatShading />
    </mesh>
  );
}

// ── Mountain icon SVG ────────────────────────────────────────────────────────
function MountainIcon({ color, size = 10 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ verticalAlign: 'middle', marginRight: 5 }}>
      <path d="M8 2L13.5 13H2.5L8 2Z" fill={color} opacity={0.6} />
      <path d="M11 6L14.5 13H7.5L11 6Z" fill={color} opacity={0.35} />
    </svg>
  );
}

// ── Labels ───────────────────────────────────────────────────────────────────
function Labels({ projects, onSelect, hovered, setHovered }) {
  return projects.map(p => {
    const isHov = hovered === p.tag;
    return (
      <Html key={p.tag} position={[p.x, p.height + 0.5, p.z]} center
        occlude={!isHov}
        style={{ pointerEvents: 'auto', zIndex: isHov ? 9999 : 1 }}
        zIndexRange={isHov ? [9999, 9999] : [3, 0]}>
        <div onClick={() => onSelect(p.tag)}
          onMouseEnter={() => setHovered(p.tag)}
          onMouseLeave={() => setHovered(null)}
          style={{
            background: isHov ? p.color : 'var(--dl-card, #1a1a1a)',
            border: `1px solid ${p.color}${isHov ? '' : '55'}`,
            borderRadius: 100, padding: '4px 14px',
            fontFamily: mono, fontSize: 12, letterSpacing: '0.06em',
            textTransform: 'uppercase', whiteSpace: 'nowrap',
            color: isHov ? '#fff' : p.color,
            cursor: 'pointer', fontWeight: isHov ? 600 : 400,
            boxShadow: `0 2px 8px rgba(0,0,0,0.2)`,
            transition: 'all 0.15s', userSelect: 'none',
            display: 'flex', alignItems: 'center',
          }}>
          <MountainIcon color={isHov ? '#fff' : p.color} />
          {p.label.toUpperCase()}
        </div>
      </Html>
    );
  });
}

// ── Environment ──────────────────────────────────────────────────────────────
function Environment({ hour }) {
  const h = hour ?? 14;
  const sunAngle = ((h - 6) / 12) * Math.PI;
  const sunX = Math.cos(sunAngle) * 10;
  const sunY = Math.sin(sunAngle) * 10;
  const isNight = h < 6 || h > 20;
  const isDusk = (h >= 17 && h <= 20) || (h >= 5 && h < 7);

  return (
    <>
      <ambientLight intensity={isNight ? 0.15 : 0.45} color={isNight ? '#4455AA' : '#D4C8B0'} />
      <directionalLight
        position={[sunX, sunY, 4]}
        intensity={isNight ? 0.1 : isDusk ? 0.8 : 1.1}
        color={isDusk ? '#FF9050' : isNight ? '#6677BB' : '#FFE4C0'}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[-4, 2, -3]} intensity={0.15} color="#8090B0" />
    </>
  );
}

// ── Scene ────────────────────────────────────────────────────────────────────
function Scene({ projects, radius, onSelect, hovered, setHovered, hour }) {
  const peakY = projects.length
    ? projects.reduce((max, p) => Math.max(max, p.height), 0) * 0.85
    : 0.5;
  return (
    <>
      <Environment hour={hour} />
      <Terrain projects={projects} radius={radius} />
      <Water radius={radius} />
      <Labels projects={projects} onSelect={onSelect} hovered={hovered} setHovered={setHovered} />
      <OrbitControls
        enablePan enableZoom enableRotate
        minDistance={6} maxDistance={30}
        maxPolarAngle={Math.PI / 2.3}
        minPolarAngle={Math.PI / 8}
        target={[0, peakY, 0]}
        autoRotate autoRotateSpeed={0.3}
      />
    </>
  );
}

// ── Exports ──────────────────────────────────────────────────────────────────
export function MapCard({ allTags, connections, recency, onSelectProject }) {
  const [hovered, setHovered] = useState(null);
  const projects = useMemo(
    () => layoutProjects(allTags || [], connections, recency),
    [allTags, connections, recency]
  );

  const hour = new Date().getHours() + new Date().getMinutes() / 60;
  const radius = useMemo(() => islandRadius(projects.length), [projects.length]);

  // Camera distance: fit the island with some padding
  const camDist = useMemo(() => {
    const maxSpread = projects.reduce((m, p) => Math.max(m, Math.abs(p.x), Math.abs(p.z)), radius * 0.5);
    const dist = (maxSpread + 2) / Math.tan((15 * Math.PI) / 180);
    return Math.max(8, Math.min(30, dist * 0.55));
  }, [projects, radius]);

  if (!projects.length) {
    return (
      <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: mono, fontSize: F.sm, color: "var(--dl-middle)", background: 'var(--dl-well)', borderRadius: 12 }}>
        No projects yet
      </div>
    );
  }

  const isNight = hour < 6 || hour > 20;
  const isDusk = (hour >= 17 && hour <= 20) || (hour >= 5 && hour < 7);
  const skyTop = isNight ? '#0A0A1A' : isDusk ? '#2A1520' : '#8AAAC8';
  const skyBot = isNight ? '#1A1A30' : isDusk ? '#C07040' : '#C4B8A4';

  return (
    <div style={{
      height: 450, borderRadius: 12, overflow: 'hidden',
      background: `linear-gradient(180deg, ${skyTop} 0%, ${skyBot} 100%)`,
    }}>
      <Canvas
        shadows
        camera={{ position: [camDist * 0.66, camDist * 0.38, camDist * 0.66], fov: 30, near: 0.1, far: 100 }}
        style={{ width: '100%', height: '100%' }}
      >
        <Suspense fallback={null}>
          <Scene projects={projects} radius={radius} onSelect={onSelectProject}
            hovered={hovered} setHovered={setHovered} hour={hour} />
        </Suspense>
        <fog attach="fog" args={[isNight ? '#0A0A1A' : isDusk ? '#C07040' : '#C4B8A4', 18, 40]} />
      </Canvas>
    </div>
  );
}

export function MountainBackground() { return null; }
