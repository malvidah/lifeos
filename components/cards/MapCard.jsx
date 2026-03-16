"use client";
import { useState, useMemo, useRef, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import { createNoise2D } from "simplex-noise";
import * as THREE from "three";
import { mono, F, projectColor } from "@/lib/tokens";
import { tagDisplayName } from "@/lib/tags";

// 3-step toon gradient (hard shadow/mid/lit bands for cel-shaded look)
function makeToonGradient() {
  const data = new Uint8Array([50, 140, 220]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
const toonGrad = typeof window !== 'undefined' ? makeToonGradient() : null;

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
      const dx = b.x - a.x, dz = b.z - a.z;
      a.x += dx * pull; a.z += dz * pull;
      b.x -= dx * pull; b.z -= dz * pull;
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

function islandRadius(projectCount) {
  return 3.5 + Math.sqrt(Math.max(1, projectCount)) * 1.8;
}

// Shared sky/fog colors based on time of day
function skyColors(hour) {
  const isNight = hour < 6 || hour > 20;
  const isDusk = (hour >= 17 && hour <= 20) || (hour >= 5 && hour < 7);
  return {
    isNight, isDusk,
    skyTop: isNight ? '#0A0A1A' : isDusk ? '#2A1520' : '#8AAAC8',
    skyBot: isNight ? '#1A1A30' : isDusk ? '#C07040' : '#C4B8A4',
    fog:    isNight ? '#0A0A1A' : isDusk ? '#C07040' : '#C4B8A4',
  };
}

// ── Top surface (PlaneGeometry for full terrain detail) ──────────────────────
const TOP_SEG = 80;

function buildTopGeo(projects, radius, noise2D, edgeR) {
  const size = radius * 2.2;
  const top = new THREE.PlaneGeometry(size, size, TOP_SEG, TOP_SEG);
  top.rotateX(-Math.PI / 2);
  const pos = top.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const dist = Math.sqrt(x * x + z * z);
    const angle = Math.atan2(z, x);
    const eR = edgeR(angle);

    if (dist > eR) { pos.setY(i, -20); continue; }

    const t = dist / eR;
    const mask = t > 0.75 ? 1 - ((t - 0.75) / 0.25) ** 2 : 1;

    let h = noise2D(x * 0.3, z * 0.3) * 0.4
          + noise2D(x * 0.7, z * 0.7) * 0.2
          + noise2D(x * 1.5, z * 1.5) * 0.08;

    for (const p of projects) {
      const dx = x - p.x, dz = z - p.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const r = 0.6 + p.score * 0.3;
      if (d < r * 2.0) {
        const f = Math.max(0, 1 - d / (r * 2.0));
        h += p.height * f * f * f;
      }
    }

    pos.setY(i, h * mask + (1 - mask) * -0.05);
  }

  // Vertex colors
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i);
    if (h < -10) { colors[i*3]=0; colors[i*3+1]=0; colors[i*3+2]=0; continue; }
    const x = pos.getX(i), z = pos.getZ(i);
    const ht = Math.max(0, Math.min(1, (h + 0.3) / 2.8));
    const n = noise2D(x * 2.5, z * 2.5) * 0.04;
    if (ht < 0.1) { colors[i*3]=0.18+n; colors[i*3+1]=0.25+n; colors[i*3+2]=0.22+n; }
    else if (ht < 0.25) { colors[i*3]=0.28+n; colors[i*3+1]=0.38+n; colors[i*3+2]=0.25+n; }
    else if (ht < 0.4) { colors[i*3]=0.48+n; colors[i*3+1]=0.42+n; colors[i*3+2]=0.25+n; }
    else if (ht < 0.6) { colors[i*3]=0.65+n; colors[i*3+1]=0.45+n; colors[i*3+2]=0.28+n; }
    else if (ht < 0.8) { colors[i*3]=0.48+n; colors[i*3+1]=0.45+n; colors[i*3+2]=0.48+n; }
    else { colors[i*3]=0.85+n; colors[i*3+1]=0.78+n; colors[i*3+2]=0.7+n; }
  }
  top.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // Remove triangles that touch invisible vertices (y=-20) — these create
  // the vertical wall artifacts at the island boundary.
  const oldIdx = top.index.array;
  const newIdx = [];
  for (let i = 0; i < oldIdx.length; i += 3) {
    const a = oldIdx[i], b = oldIdx[i+1], c = oldIdx[i+2];
    if (pos.getY(a) < -10 || pos.getY(b) < -10 || pos.getY(c) < -10) continue;
    newIdx.push(a, b, c);
  }
  top.setIndex(newIdx);

  top.computeVertexNormals();
  return top;
}

// ── Underside (hand-built rings — no CylinderGeometry) ───────────────────────
// Build explicit vertex rings at each depth level with exact radii.
function buildUndersideGeo(radius, noise2D, edgeR) {
  const DEPTH = radius * 0.9;
  const SEGS = 64;       // vertices per ring
  const RINGS = 22;      // depth levels (0 = top edge, RINGS = bottom tip)

  const verts = [];
  const cols = [];
  const indices = [];

  for (let ring = 0; ring <= RINGS; ring++) {
    const t = ring / RINGS; // 0 = cliff top, 1 = bottom tip
    const y = -t * DEPTH;

    // Taper: full width → narrow point
    const taper = Math.max(0.03, (1 - t) ** 1.5);

    for (let seg = 0; seg <= SEGS; seg++) {
      const angle = (seg / SEGS) * Math.PI * 2;

      // Base radius from edge shape, scaled by taper
      // First 3 rings extend wider to generously overlap with top surface
      const overlap = ring === 0 ? 1.12 : ring === 1 ? 1.08 : ring === 2 ? 1.04 : 1.0;
      const r = edgeR(angle) * taper * overlap;

      // Rock displacement proportional to current radius (shrinks with taper)
      const rock = noise2D(angle * 5 + t * 8, t * 6) * 0.08
                 + noise2D(angle * 11 + t * 13, t * 11) * 0.04;
      const finalR = r * (1 + rock);

      // Vertical noise for jagged cliffs (skip first ring to keep it flush)
      const yN = ring < 2 ? 0
               : noise2D(angle * 5 + 20, t * 4 + 20) * 0.25
               + noise2D(angle * 11 + 40, t * 8) * 0.12;

      const x = Math.cos(angle) * finalR;
      const z = Math.sin(angle) * finalR;
      // First rings pushed above y=0 to overlap terrain surface
      const yOffset = ring === 0 ? 0.25 : ring === 1 ? 0.15 : ring === 2 ? 0.05 : 0;
      verts.push(x, y + yOffset + yN * t * 0.5, z);

      // Color: warm brown at top → dark charcoal at bottom
      const warmth = 1 - t;
      const n = noise2D(x * 2 + 30, z * 2 + 30) * 0.04;
      cols.push(0.10 + warmth * 0.30 + n, 0.08 + warmth * 0.18 + n * 0.4, 0.07 + warmth * 0.10 + n * 0.2);
    }
  }

  // Connect rings with triangles
  for (let ring = 0; ring < RINGS; ring++) {
    for (let seg = 0; seg < SEGS; seg++) {
      const a = ring * (SEGS + 1) + seg;
      const b = a + 1;
      const c = a + (SEGS + 1);
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function Terrain({ projects, radius }) {
  const { topGeo, undersideGeo } = useMemo(() => {
    const noise2D = createNoise2D();
    function edgeR(angle) {
      // Gentle wobble — mostly round with subtle irregularity
      return radius * (0.90
        + noise2D(Math.cos(angle) * 1.5, Math.sin(angle) * 1.5) * 0.07
        + noise2D(Math.cos(angle * 2) * 1.2, Math.sin(angle * 2) * 1.2) * 0.04
      );
    }
    return {
      topGeo: buildTopGeo(projects, radius, noise2D, edgeR),
      undersideGeo: buildUndersideGeo(radius, noise2D, edgeR),
    };
  }, [projects, radius]);

  return (
    <group>
      <mesh geometry={topGeo} receiveShadow castShadow>
        <meshToonMaterial vertexColors gradientMap={toonGrad} />
      </mesh>
      <mesh geometry={undersideGeo} receiveShadow castShadow>
        <meshToonMaterial vertexColors gradientMap={toonGrad} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// ── Labels ───────────────────────────────────────────────────────────────────
function DepthLabel({ p, onSelect, isHov, setHovered }) {
  const htmlRef = useRef();
  const frameCount = useRef(0);
  const pos = useMemo(() => new THREE.Vector3(p.x, p.height + 0.5, p.z), [p.x, p.height, p.z]);

  useFrame(({ camera }) => {
    // Throttle DOM writes to every 3rd frame
    if (++frameCount.current % 3 !== 0) return;
    const wrapper = htmlRef.current?.parentElement;
    if (!wrapper) return;
    const dist = camera.position.distanceTo(pos);
    wrapper.style.zIndex = isHov ? 9999 : Math.max(1, Math.round(1000 - dist * 40));
  });

  return (
    <Html position={[p.x, p.height + 0.5, p.z]} center
      zIndexRange={[0, 0]} style={{ pointerEvents: 'auto' }}>
      <div ref={htmlRef} onClick={() => onSelect(p.tag)}
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
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          transition: 'background 0.15s, color 0.15s, border-color 0.15s',
          userSelect: 'none',
        }}>
        {p.isActive && <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: isHov ? '#fff' : p.color, marginRight: 6, verticalAlign: 'middle' }} />}
        {p.label.toUpperCase()}
      </div>
    </Html>
  );
}

function Labels({ projects, onSelect, hovered, setHovered }) {
  return projects.map(p => (
    <DepthLabel key={p.tag} p={p} onSelect={onSelect}
      isHov={hovered === p.tag} setHovered={setHovered} />
  ));
}

// ── Environment ──────────────────────────────────────────────────────────────
// ── Cel-shaded Sun ───────────────────────────────────────────────────────────
function CelSun({ position, visible }) {
  if (!visible) return null;
  return (
    <group position={position}>
      {/* Outer glow */}
      <mesh>
        <ringGeometry args={[1.0, 1.4, 32]} />
        <meshBasicMaterial color="#FFE080" transparent opacity={0.2} side={THREE.DoubleSide} />
      </mesh>
      {/* Core */}
      <mesh>
        <sphereGeometry args={[0.8, 8, 6]} />
        <meshToonMaterial color="#FFD060" gradientMap={toonGrad} emissive="#FFA030" emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
}

// ── Cel-shaded Moon ──────────────────────────────────────────────────────────
function CelMoon({ position, visible }) {
  if (!visible) return null;
  return (
    <group position={position}>
      {/* Subtle glow */}
      <mesh>
        <ringGeometry args={[0.4, 0.55, 32]} />
        <meshBasicMaterial color="#B0C0E0" transparent opacity={0.15} side={THREE.DoubleSide} />
      </mesh>
      {/* Moon body */}
      <mesh>
        <sphereGeometry args={[0.35, 8, 6]} />
        <meshToonMaterial color="#C8D0E0" gradientMap={toonGrad} emissive="#8090B0" emissiveIntensity={0.2} />
      </mesh>
      {/* Dark crater spots */}
      <mesh position={[0.08, 0.1, 0.3]}>
        <sphereGeometry args={[0.08, 6, 4]} />
        <meshToonMaterial color="#9098B0" gradientMap={toonGrad} />
      </mesh>
      <mesh position={[-0.12, -0.05, 0.28]}>
        <sphereGeometry args={[0.06, 6, 4]} />
        <meshToonMaterial color="#8890A8" gradientMap={toonGrad} />
      </mesh>
    </group>
  );
}

// ── Stars (night only) ───────────────────────────────────────────────────────
function Stars({ visible }) {
  const positions = useMemo(() => {
    const pts = [];
    for (let i = 0; i < 60; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.4 + 0.2; // upper hemisphere
      const r = 18 + Math.random() * 4;
      pts.push([
        Math.sin(phi) * Math.cos(theta) * r,
        Math.cos(phi) * r,
        Math.sin(phi) * Math.sin(theta) * r,
        0.03 + Math.random() * 0.05, // size
      ]);
    }
    return pts;
  }, []);

  if (!visible) return null;
  return (
    <group>
      {positions.map((s, i) => (
        <mesh key={i} position={[s[0], s[1], s[2]]}>
          <sphereGeometry args={[s[3], 4, 3]} />
          <meshBasicMaterial color="#E8E0F0" />
        </mesh>
      ))}
    </group>
  );
}

// ── Environment ──────────────────────────────────────────────────────────────
function Environment({ hour }) {
  const h = hour ?? 14;
  const { isNight, isDusk } = skyColors(h);
  const sunAngle = ((h - 6) / 12) * Math.PI;
  const sunX = Math.cos(sunAngle) * 12;
  const sunY = Math.max(2, Math.sin(sunAngle) * 8);
  const sunZ = -10;
  const moonAngle = sunAngle + Math.PI;
  const moonX = Math.cos(moonAngle) * 14;
  const moonY = Math.max(2, Math.sin(moonAngle) * 14);
  return (
    <>
      <ambientLight intensity={isNight ? 0.08 : 0.25} color={isNight ? '#3344AA' : '#B8A890'} />
      <directionalLight
        position={[sunX, sunY, sunZ]}
        intensity={isNight ? 0.08 : isDusk ? 1.0 : 1.4}
        color={isDusk ? '#FF8040' : isNight ? '#5566AA' : '#FFD8A8'}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.001}
      />
      <directionalLight position={[-5, 3, -4]} intensity={isNight ? 0.05 : 0.2} color="#6080B0" />
      <directionalLight position={[0, 2, -8]} intensity={0.12} color="#A0B0D0" />

      {/* Celestial bodies */}
      <CelSun position={[sunX, sunY, sunZ]} visible={!isNight} />
      <CelMoon position={[moonX, moonY, -4]} visible={isNight || isDusk} />
      <Stars visible={isNight} />
    </>
  );
}

// ── Scene ────────────────────────────────────────────────────────────────────
function Scene({ projects, radius, onSelect, hovered, setHovered, hour }) {
  const peakY = projects.length
    ? projects.reduce((max, p) => Math.max(max, p.height), 0) * 0.85 : 0.5;
  return (
    <>
      <Environment hour={hour} />
      <Terrain projects={projects} radius={radius} />
      <Labels projects={projects} onSelect={onSelect} hovered={hovered} setHovered={setHovered} />
      <OrbitControls
        enablePan enableZoom enableRotate
        minDistance={6} maxDistance={30}
        maxPolarAngle={Math.PI / 2.1}
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

  const sky = skyColors(hour);

  return (
    <div style={{
      height: 450, borderRadius: 12, overflow: 'hidden',
      background: `linear-gradient(180deg, ${sky.skyTop} 0%, ${sky.skyBot} 100%)`,
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
        <fog attach="fog" args={[sky.fog, 18, 40]} />
      </Canvas>
    </div>
  );
}

