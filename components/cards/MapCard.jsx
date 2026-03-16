"use client";
import { useState, useMemo, useRef, Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Html, Cloud, Sky } from "@react-three/drei";
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
  sorted.forEach((tag, i) => {
    const angle = (i / sorted.length) * Math.PI * 2 + Math.PI / 4;
    const radius = i === 0 ? 0 : 1.2 + (i / sorted.length) * 2.5;
    placed.set(tag, { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
  });
  for (let iter = 0; iter < 8; iter++) {
    (connections || []).forEach(({ source, target, weight }) => {
      const a = placed.get(source), b = placed.get(target);
      if (!a || !b) return;
      const pull = 0.03 * Math.min(weight, 5);
      a.x += (b.x - a.x) * pull; a.z += (b.z - a.z) * pull;
      b.x -= (b.x - a.x) * pull; b.z -= (b.z - a.z) * pull;
    });
  }
  const maxConn = Math.max(1, ...Object.values(connWeight));
  return tags.map(tag => {
    const pos = placed.get(tag) || { x: 0, z: 0 };
    const score = (connWeight[tag] || 0) / maxConn;
    return {
      tag, x: pos.x, z: pos.z,
      height: 0.6 + score * 2.0,
      color: projectColor(tag),
      label: tagDisplayName(tag),
      isActive: recency?.[tag] && (Date.now() - new Date(recency[tag]).getTime()) < 7 * 86400000,
      score,
    };
  });
}

// ── Terrain + sides as one geometry ──────────────────────────────────────────
const SIZE = 8, SEG = 72, DEPTH = 1.2;

function buildTerrainGeo(projects) {
  const noise2D = createNoise2D();
  const top = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  top.rotateX(-Math.PI / 2);
  const pos = top.attributes.position;
  const hMap = []; // store heights for edge walls

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    let h = noise2D(x * 0.35, z * 0.35) * 0.35
          + noise2D(x * 0.8, z * 0.8) * 0.15
          + noise2D(x * 1.6, z * 1.6) * 0.06;
    for (const p of projects) {
      const dx = x - p.x, dz = z - p.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const r = 0.7 + p.score * 0.5;
      if (dist < r * 2.5) {
        const f = Math.max(0, 1 - dist / (r * 2.5));
        h += p.height * f * f;
      }
    }
    // Gentle edge fade — pull edges down slightly
    const edgeDist = Math.max(Math.abs(x), Math.abs(z)) / (SIZE / 2);
    if (edgeDist > 0.85) h *= 1 - (edgeDist - 0.85) / 0.15 * 0.3;
    pos.setY(i, h);
    hMap.push(h);
  }

  // Vertex colors
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i);
    const t = Math.max(0, Math.min(1, (h + 0.3) / 2.5));
    let r, g, b;
    if (t < 0.15) { r = 0.25; g = 0.35; b = 0.22; } // deep green valley
    else if (t < 0.3) { r = 0.32 + t; g = 0.38 + t * 0.5; b = 0.22; } // green slopes
    else if (t < 0.55) { r = 0.48 + t * 0.3; g = 0.4 + t * 0.2; b = 0.25 + t * 0.1; } // brown
    else if (t < 0.8) { r = 0.55 + t * 0.15; g = 0.5 + t * 0.1; b = 0.4 + t * 0.08; } // rocky
    else { r = 0.75 + t * 0.2; g = 0.73 + t * 0.2; b = 0.7 + t * 0.2; } // snow
    colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
  }
  top.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  top.computeVertexNormals();

  // Build side walls — connect terrain edge vertices down to -DEPTH
  const half = SIZE / 2;
  const step = SIZE / SEG;
  const sideVerts = [], sideIdx = [], sideCols = [];
  const edges = [
    { fixed: 'z', val: -half, axis: 'x', dir: 1 },  // front (−z)
    { fixed: 'z', val: half, axis: 'x', dir: -1 },   // back (+z)
    { fixed: 'x', val: -half, axis: 'z', dir: -1 },  // left (−x)
    { fixed: 'x', val: half, axis: 'z', dir: 1 },    // right (+x)
  ];

  function getHeight(x, z) {
    const col = Math.round((x + half) / step);
    const row = Math.round((z + half) / step);
    const idx = row * (SEG + 1) + col;
    return hMap[idx] ?? 0;
  }

  let vOff = 0;
  for (const edge of edges) {
    for (let i = 0; i < SEG; i++) {
      const a = -half + i * step, b = -half + (i + 1) * step;
      let x0, z0, x1, z1;
      if (edge.axis === 'x') {
        x0 = edge.dir > 0 ? a : b; x1 = edge.dir > 0 ? b : a;
        z0 = z1 = edge.val;
      } else {
        z0 = edge.dir > 0 ? a : b; z1 = edge.dir > 0 ? b : a;
        x0 = x1 = edge.val;
      }
      const h0 = getHeight(x0, z0), h1 = getHeight(x1, z1);
      // Two triangles: top-left, top-right, bottom-right, bottom-left
      sideVerts.push(x0, h0, z0, x1, h1, z1, x1, -DEPTH, z1, x0, -DEPTH, z0);
      sideIdx.push(vOff, vOff + 1, vOff + 2, vOff, vOff + 2, vOff + 3);
      // Earth layer colors (darker at bottom)
      const c1 = [0.38, 0.28, 0.2], c2 = [0.25, 0.18, 0.12];
      sideCols.push(...c1, ...c1, ...c2, ...c2);
      vOff += 4;
    }
  }

  const sideGeo = new THREE.BufferGeometry();
  sideGeo.setAttribute('position', new THREE.Float32BufferAttribute(sideVerts, 3));
  sideGeo.setIndex(sideIdx);
  sideGeo.setAttribute('color', new THREE.Float32BufferAttribute(sideCols, 3));
  sideGeo.computeVertexNormals();

  // Bottom
  const botGeo = new THREE.PlaneGeometry(SIZE, SIZE);
  botGeo.rotateX(Math.PI / 2);
  botGeo.translate(0, -DEPTH, 0);

  return { top, sideGeo, botGeo };
}

function Terrain({ projects }) {
  const { top, sideGeo, botGeo } = useMemo(() => buildTerrainGeo(projects), [projects]);
  const mat = { flatShading: true, vertexColors: true, roughness: 0.85, metalness: 0.02 };
  return (
    <group>
      <mesh geometry={top} receiveShadow castShadow>
        <meshStandardMaterial {...mat} />
      </mesh>
      <mesh geometry={sideGeo} receiveShadow>
        <meshStandardMaterial {...mat} />
      </mesh>
      <mesh geometry={botGeo}>
        <meshStandardMaterial color="#1E1510" roughness={1} />
      </mesh>
    </group>
  );
}

// ── Water plane (lake in low areas) ──────────────────────────────────────────
function Water() {
  return (
    <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[SIZE, SIZE]} />
      <meshStandardMaterial color="#4A7890" transparent opacity={0.35} roughness={0.2} metalness={0.1} />
    </mesh>
  );
}

// ── Labels ───────────────────────────────────────────────────────────────────
function Labels({ projects, onSelect, hovered, setHovered }) {
  return projects.map(p => (
    <Html key={p.tag} position={[p.x, p.height + 0.5, p.z]} center
      style={{ pointerEvents: 'auto' }} zIndexRange={[10, 0]}>
      <div onClick={() => onSelect(p.tag)}
        onMouseEnter={() => setHovered(p.tag)}
        onMouseLeave={() => setHovered(null)}
        style={{
          background: hovered === p.tag ? p.color : 'var(--dl-card, #1a1a1a)',
          border: `1px solid ${p.color}${hovered === p.tag ? '' : '55'}`,
          borderRadius: 100, padding: '4px 14px',
          fontFamily: mono, fontSize: 12, letterSpacing: '0.06em',
          textTransform: 'uppercase', whiteSpace: 'nowrap',
          color: hovered === p.tag ? '#fff' : p.color,
          cursor: 'pointer', fontWeight: hovered === p.tag ? 600 : 400,
          boxShadow: `0 2px 8px rgba(0,0,0,0.2)`,
          transition: 'all 0.15s', userSelect: 'none',
        }}>
        {p.isActive && <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: p.color, marginRight: 6, verticalAlign: 'middle' }} />}
        {p.label.toUpperCase()}
      </div>
    </Html>
  ));
}

// ── Environment ──────────────────────────────────────────────────────────────
function Environment({ hour }) {
  // Sun position based on hour (0-24)
  const h = hour ?? 14;
  const sunAngle = ((h - 6) / 12) * Math.PI; // 6am=0, 12pm=PI/2, 6pm=PI
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
      <Cloud position={[-4, 4.5, -2]} speed={0.1} opacity={isNight ? 0.05 : 0.6} width={5} depth={1.5} segments={12} color="white" />
      <Cloud position={[3, 5, 2]} speed={0.15} opacity={isNight ? 0.04 : 0.5} width={4} depth={1} segments={10} color="white" />
      {!isNight && <Cloud position={[0, 5.5, -4]} speed={0.08} opacity={0.4} width={6} depth={1.5} segments={14} color="white" />}
      {!isNight && <Cloud position={[-2, 6, 4]} speed={0.12} opacity={0.3} width={4} depth={1} segments={8} color="white" />}
    </>
  );
}

// ── Scene ────────────────────────────────────────────────────────────────────
function Scene({ projects, onSelect, hovered, setHovered, hour }) {
  return (
    <>
      <Environment hour={hour} />
      <Terrain projects={projects} />
      <Water />
      <Labels projects={projects} onSelect={onSelect} hovered={hovered} setHovered={setHovered} />
      <OrbitControls
        enablePan enableZoom enableRotate
        minDistance={6} maxDistance={22}
        maxPolarAngle={Math.PI / 2.3}
        minPolarAngle={Math.PI / 8}
        target={[0, 0.5, 0]}
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

  // Current hour for lighting
  const hour = new Date().getHours() + new Date().getMinutes() / 60;

  if (!projects.length) {
    return (
      <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: mono, fontSize: F.sm, color: "var(--dl-middle)", background: 'var(--dl-well)', borderRadius: 12 }}>
        No projects yet
      </div>
    );
  }

  // Sky gradient based on time of day
  const isNight = hour < 6 || hour > 20;
  const isDusk = (hour >= 17 && hour <= 20) || (hour >= 5 && hour < 7);
  const skyTop = isNight ? '#0A0A1A' : isDusk ? '#2A1520' : '#8AAAC8';
  const skyBot = isNight ? '#1A1A30' : isDusk ? '#C07040' : '#C4B8A4';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 0,
      background: `linear-gradient(180deg, ${skyTop} 0%, ${skyBot} 100%)`,
    }}>
      <Canvas
        shadows
        camera={{ position: [10, 7, 10], fov: 30, near: 0.1, far: 100 }}
        style={{ width: '100%', height: '100%' }}
      >
        <Suspense fallback={null}>
          <Scene projects={projects} onSelect={onSelectProject}
            hovered={hovered} setHovered={setHovered} hour={hour} />
        </Suspense>
        <fog attach="fog" args={[isNight ? '#0A0A1A' : isDusk ? '#C07040' : '#C4B8A4', 14, 28]} />
      </Canvas>
    </div>
  );
}

export function MountainBackground() { return null; }
