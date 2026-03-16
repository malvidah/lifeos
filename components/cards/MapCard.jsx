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
  return 3.5 + Math.sqrt(Math.max(1, projectCount)) * 1.8;
}

// ── Floating island with iceberg-shaped underside ────────────────────────────
// Strategy: build a revolution solid. The edge profile goes from the terrain
// surface → vertical/overhanging cliff → tapers inward to a rocky point below.
// Uses radial slices (like an orange) with noise on every parameter.

const TOP_SEG = 80;

function buildIslandGeo(projects, radius) {
  const noise2D = createNoise2D();
  const size = radius * 2.2;
  const DEPTH = radius * 0.6; // iceberg depth scales with island size

  // ── Irregular edge radius per angle ──────────────────────────────────────
  // Pre-compute a wobbly edge radius for ~128 angular samples
  const ANGLE_SAMPLES = 128;
  const edgeRadii = [];
  for (let i = 0; i < ANGLE_SAMPLES; i++) {
    const a = (i / ANGLE_SAMPLES) * Math.PI * 2;
    const wobble = noise2D(Math.cos(a) * 2.2, Math.sin(a) * 2.2) * 0.18
                 + noise2D(Math.cos(a * 2.7) * 1.8, Math.sin(a * 2.7) * 1.8) * 0.1
                 + noise2D(Math.cos(a * 5) * 1.2, Math.sin(a * 5) * 1.2) * 0.05;
    edgeRadii.push(radius * (0.82 + wobble));
  }

  function getEdgeRadius(angle) {
    const a = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const idx = (a / (Math.PI * 2)) * ANGLE_SAMPLES;
    const i0 = Math.floor(idx) % ANGLE_SAMPLES;
    const i1 = (i0 + 1) % ANGLE_SAMPLES;
    const t = idx - Math.floor(idx);
    return edgeRadii[i0] * (1 - t) + edgeRadii[i1] * t;
  }

  function islandMask(x, z) {
    const dist = Math.sqrt(x * x + z * z);
    const angle = Math.atan2(z, x);
    const edgeR = getEdgeRadius(angle);
    if (dist > edgeR) return 0;
    const t = dist / edgeR;
    if (t > 0.75) return 1 - ((t - 0.75) / 0.25) * ((t - 0.75) / 0.25);
    return 1;
  }

  // ── Top surface ──────────────────────────────────────────────────────────
  const top = new THREE.PlaneGeometry(size, size, TOP_SEG, TOP_SEG);
  top.rotateX(-Math.PI / 2);
  const pos = top.attributes.position;
  const hMap = [];

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const mask = islandMask(x, z);

    if (mask <= 0) {
      pos.setY(i, -20);
      hMap.push(-20);
      continue;
    }

    let h = noise2D(x * 0.3, z * 0.3) * 0.4
          + noise2D(x * 0.7, z * 0.7) * 0.2
          + noise2D(x * 1.5, z * 1.5) * 0.08;

    for (const p of projects) {
      const dx = x - p.x, dz = z - p.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const r = 0.6 + p.score * 0.3;
      if (dist < r * 2.0) {
        const f = Math.max(0, 1 - dist / (r * 2.0));
        h += p.height * f * f * f;
      }
    }

    h = h * mask + (1 - mask) * -0.05;
    pos.setY(i, h);
    hMap.push(h);
  }

  // Vertex colors — Cairn style
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i);
    if (h < -10) { colors[i*3]=0; colors[i*3+1]=0; colors[i*3+2]=0; continue; }
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

  // ── Cliff + underside as a revolution solid ──────────────────────────────
  // Build rings from the edge downward, tapering inward to a point.
  // Each ring is at a different Y level with noise-displaced radius.
  const RING_SEGS = 64;   // vertices per ring
  const RINGS = 16;       // vertical rings from cliff top to bottom tip

  const cliffVerts = [];
  const cliffCols = [];
  const cliffIdx = [];

  for (let ring = 0; ring <= RINGS; ring++) {
    const t = ring / RINGS; // 0 = cliff top (edge), 1 = bottom tip
    const y = -t * DEPTH;

    // Taper: radius shrinks as we go down. Inverted-mountain profile.
    // Use a curve that starts wide (edge radius) and narrows to a point.
    // Slight overhang near top, then taper accelerates.
    const taper = t < 0.15
      ? 1.0 + t * 0.3  // slight overhang near top (cliff bulges out)
      : (1 - ((t - 0.15) / 0.85)) ** 1.6; // accelerating taper to point

    for (let seg = 0; seg <= RING_SEGS; seg++) {
      const angle = (seg / RING_SEGS) * Math.PI * 2;
      const baseR = getEdgeRadius(angle);

      // Add rocky noise that increases with depth
      const rockNoise = noise2D(Math.cos(angle) * 4 + t * 3, Math.sin(angle) * 4 + t * 5) * 0.12
                      + noise2D(Math.cos(angle) * 8 + t * 7, Math.sin(angle) * 8 + t * 3) * 0.06;
      const r = baseR * taper + rockNoise * radius * (0.3 + t * 0.4);

      // Vertical noise — makes cliff faces uneven
      const yNoise = noise2D(Math.cos(angle) * 3 + 20, Math.sin(angle) * 3 + 20) * 0.3 * t;

      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      cliffVerts.push(x, y + yNoise, z);

      // Colors: brownish at top (matching terrain edge) → dark grey/charcoal at bottom
      const warmth = (1 - t);
      const n = noise2D(x * 2 + 30, z * 2 + 30) * 0.05;
      const cr = 0.12 + warmth * 0.25 + n;
      const cg = 0.10 + warmth * 0.15 + n * 0.5;
      const cb = 0.08 + warmth * 0.08 + n * 0.3;
      cliffCols.push(cr, cg, cb);
    }
  }

  // Build triangle indices connecting adjacent rings
  for (let ring = 0; ring < RINGS; ring++) {
    for (let seg = 0; seg < RING_SEGS; seg++) {
      const a = ring * (RING_SEGS + 1) + seg;
      const b = a + 1;
      const c = a + (RING_SEGS + 1);
      const d = c + 1;
      cliffIdx.push(a, c, b, b, c, d);
    }
  }

  const cliffGeo = new THREE.BufferGeometry();
  cliffGeo.setAttribute('position', new THREE.Float32BufferAttribute(cliffVerts, 3));
  cliffGeo.setAttribute('color', new THREE.Float32BufferAttribute(cliffCols, 3));
  cliffGeo.setIndex(cliffIdx);
  cliffGeo.computeVertexNormals();

  // ── Connect top surface edge to cliff top ring ───────────────────────────
  // Build a skirt that bridges the terrain boundary to the cliff's first ring
  const skirtVerts = [], skirtCols = [], skirtIdx = [];
  let sOff = 0;

  function isVisible(idx) { return hMap[idx] > -10; }

  // For each cliff top vertex, find the nearest terrain boundary vertex
  // Simpler: just walk boundary vertices and connect to cliff ring
  for (let seg = 0; seg < RING_SEGS; seg++) {
    const angle0 = (seg / RING_SEGS) * Math.PI * 2;
    const angle1 = ((seg + 1) / RING_SEGS) * Math.PI * 2;
    const eR0 = getEdgeRadius(angle0);
    const eR1 = getEdgeRadius(angle1);

    // Top surface edge points (at terrain height)
    const x0 = Math.cos(angle0) * eR0 * 0.95;
    const z0 = Math.sin(angle0) * eR0 * 0.95;
    const x1 = Math.cos(angle1) * eR1 * 0.95;
    const z1 = Math.sin(angle1) * eR1 * 0.95;

    // Find terrain height at these points (approximate from nearest grid vertex)
    function terrainH(x, z) {
      const col = Math.round((x + size / 2) / (size / TOP_SEG));
      const row = Math.round((z + size / 2) / (size / TOP_SEG));
      const idx = Math.min(Math.max(row, 0), TOP_SEG) * (TOP_SEG + 1) + Math.min(Math.max(col, 0), TOP_SEG);
      const h = hMap[idx];
      return h > -10 ? h : 0;
    }

    const y0t = terrainH(x0, z0);
    const y1t = terrainH(x1, z1);

    // Cliff ring points (from first ring of cliff geometry)
    const cx0 = cliffVerts[seg * 3];
    const cy0 = cliffVerts[seg * 3 + 1];
    const cz0 = cliffVerts[seg * 3 + 2];
    const cx1 = cliffVerts[(seg + 1) * 3];
    const cy1 = cliffVerts[(seg + 1) * 3 + 1];
    const cz1 = cliffVerts[(seg + 1) * 3 + 2];

    skirtVerts.push(
      x0, y0t, z0,
      x1, y1t, z1,
      cx1, cy1, cz1,
      cx0, cy0, cz0,
    );
    const sc = [0.35, 0.25, 0.18];
    skirtCols.push(...sc, ...sc, ...sc, ...sc);
    skirtIdx.push(sOff, sOff+1, sOff+2, sOff, sOff+2, sOff+3);
    sOff += 4;
  }

  const skirtGeo = new THREE.BufferGeometry();
  skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(skirtVerts, 3));
  skirtGeo.setAttribute('color', new THREE.Float32BufferAttribute(skirtCols, 3));
  skirtGeo.setIndex(skirtIdx);
  skirtGeo.computeVertexNormals();

  return { top, cliffGeo, skirtGeo };
}

function Terrain({ projects, radius }) {
  const { top, cliffGeo, skirtGeo } = useMemo(
    () => buildIslandGeo(projects, radius), [projects, radius]
  );
  const topMat = { flatShading: true, vertexColors: true, roughness: 0.85, metalness: 0.02 };
  const cliffMat = { flatShading: true, vertexColors: true, roughness: 0.95, metalness: 0.01 };
  return (
    <group>
      <mesh geometry={top} receiveShadow castShadow>
        <meshStandardMaterial {...topMat} />
      </mesh>
      <mesh geometry={cliffGeo} receiveShadow castShadow>
        <meshStandardMaterial {...cliffMat} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={skirtGeo} receiveShadow>
        <meshStandardMaterial {...cliffMat} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// ── Water — circular, matching island shape ──────────────────────────────────
function Water({ radius }) {
  return (
    <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <circleGeometry args={[radius * 0.85, 64]} />
      <meshStandardMaterial color="#2A5068" roughness={0.3} metalness={0.15} flatShading />
    </mesh>
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
          }}>
          {p.isActive && <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: isHov ? '#fff' : p.color, marginRight: 6, verticalAlign: 'middle' }} />}
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
