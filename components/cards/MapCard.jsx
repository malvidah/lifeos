"use client";
import { useState, useMemo, useRef, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import { EffectComposer, N8AO, ToneMapping } from "@react-three/postprocessing";
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

function islandRadius(projectCount) {
  return 3.5 + Math.sqrt(Math.max(1, projectCount)) * 1.8;
}

// ── Build the entire island as ONE CylinderGeometry that we deform ───────────
// This avoids all the topology/seam issues of separate top + cliff + skirt.
// A cylinder with radialSegments around, heightSegments vertically.
// Top cap = terrain surface. Side rings = cliff that tapers. Bottom cap = tip.

function buildIslandGeo(projects, radius) {
  const noise2D = createNoise2D();
  const DEPTH = radius * 0.9;
  const RADIAL = 64;     // segments around the perimeter
  const HEIGHT = 20;     // vertical segments for the cliff sides

  // ── Irregular edge radius ─────────────────────────────────────────────
  function edgeR(angle) {
    return radius * (0.82
      + noise2D(Math.cos(angle) * 2.2, Math.sin(angle) * 2.2) * 0.18
      + noise2D(Math.cos(angle * 2.7) * 1.8, Math.sin(angle * 2.7) * 1.8) * 0.1
      + noise2D(Math.cos(angle * 5) * 1.2, Math.sin(angle * 5) * 1.2) * 0.05
    );
  }

  // ── Use CylinderGeometry as base, then deform every vertex ────────────
  // open-ended so we control top/bottom separately
  const geo = new THREE.CylinderGeometry(
    radius,      // radiusTop (will be deformed)
    radius * 0.05, // radiusBottom — narrow tip
    DEPTH,       // height
    RADIAL,      // radialSegments
    HEIGHT,      // heightSegments
    false        // openEnded = false (includes caps)
  );

  const pos = geo.attributes.position;
  const normals = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);

  // Cylinder is centered at origin, extends from -DEPTH/2 to +DEPTH/2.
  // We want: top at y=0, bottom at y=-DEPTH.
  // So shift everything down by DEPTH/2.

  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);

    // Shift so top is at y=0, bottom at y=-DEPTH
    y -= DEPTH / 2;

    const angle = Math.atan2(z, x);
    const currentR = Math.sqrt(x * x + z * z);

    // t: 0 = top surface, 1 = bottom tip
    const t = Math.max(0, Math.min(1, -y / DEPTH));

    // Target radius at this height: edge radius * taper
    const taper = Math.max(0.03, (1 - t) ** 1.5);
    const targetR = edgeR(angle) * taper;

    // Rocky displacement on cliff faces (not on top cap or bottom cap)
    const isTopCap = (t < 0.01 && currentR < radius * 0.5);
    const isBotCap = (t > 0.99 && currentR < radius * 0.1);
    const isSide = !isTopCap && !isBotCap;

    let rockDisp = 0;
    if (isSide && t > 0.02) {
      rockDisp = noise2D(angle * 5 + t * 8, t * 6) * 0.1
               + noise2D(angle * 11 + t * 13, t * 11) * 0.05;
    }

    // Scale radius to target
    if (currentR > 0.001) {
      const scale = (targetR * (1 + rockDisp)) / currentR;
      x *= scale;
      z *= scale;
    }

    // Top surface: add terrain features (mountains, noise)
    if (t < 0.05) {
      const mask = 1 - t / 0.05; // blend from full terrain at t=0 to nothing at t=0.05
      let terrain = noise2D(x * 0.3, z * 0.3) * 0.4
                  + noise2D(x * 0.7, z * 0.7) * 0.2
                  + noise2D(x * 1.5, z * 1.5) * 0.08;

      // Island shape falloff at edges
      const dist = Math.sqrt(x * x + z * z);
      const eR = edgeR(angle);
      const edgeFade = dist < eR * 0.7 ? 1 : Math.max(0, 1 - ((dist - eR * 0.7) / (eR * 0.3)));

      for (const p of projects) {
        const dx = x - p.x, dz = z - p.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        const r = 0.6 + p.score * 0.3;
        if (d < r * 2.0) {
          const f = Math.max(0, 1 - d / (r * 2.0));
          terrain += p.height * f * f * f;
        }
      }

      y += terrain * edgeFade * mask;
    }

    // Vertical noise on cliff faces
    if (isSide && t > 0.05) {
      const yNoise = noise2D(angle * 5 + 20, t * 4 + 20) * 0.3
                   + noise2D(angle * 11 + 40, t * 8) * 0.15;
      y += yNoise * t * 0.5;
    }

    pos.setX(i, x);
    pos.setY(i, y);
    pos.setZ(i, z);

    // ── Vertex colors ───────────────────────────────────────────────────
    const n = noise2D(x * 2.5 + 10, z * 2.5 + 10) * 0.04;
    if (t < 0.05) {
      // Top surface — terrain colors
      const h = y;
      const ht = Math.max(0, Math.min(1, (h + 0.3) / 2.8));
      if (ht < 0.1) { colors[i*3]=0.18+n; colors[i*3+1]=0.25+n; colors[i*3+2]=0.22+n; }
      else if (ht < 0.25) { colors[i*3]=0.28+n; colors[i*3+1]=0.38+n; colors[i*3+2]=0.25+n; }
      else if (ht < 0.4) { colors[i*3]=0.48+n; colors[i*3+1]=0.42+n; colors[i*3+2]=0.25+n; }
      else if (ht < 0.6) { colors[i*3]=0.65+n; colors[i*3+1]=0.45+n; colors[i*3+2]=0.28+n; }
      else if (ht < 0.8) { colors[i*3]=0.48+n; colors[i*3+1]=0.45+n; colors[i*3+2]=0.48+n; }
      else { colors[i*3]=0.85+n; colors[i*3+1]=0.78+n; colors[i*3+2]=0.7+n; }
    } else {
      // Cliff / underside — warm brown fading to dark charcoal
      const warmth = 1 - t;
      colors[i*3]   = 0.10 + warmth * 0.30 + n;
      colors[i*3+1] = 0.08 + warmth * 0.18 + n * 0.4;
      colors[i*3+2] = 0.07 + warmth * 0.10 + n * 0.2;
    }
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  return geo;
}

function Terrain({ projects, radius }) {
  const geo = useMemo(() => buildIslandGeo(projects, radius), [projects, radius]);
  return (
    <mesh geometry={geo} receiveShadow castShadow>
      <meshToonMaterial vertexColors gradientMap={toonGrad} side={THREE.DoubleSide} />
    </mesh>
  );
}

// ── Labels ───────────────────────────────────────────────────────────────────
function DepthLabel({ p, onSelect, isHov, setHovered }) {
  const htmlRef = useRef();
  const pos = useMemo(() => new THREE.Vector3(p.x, p.height + 0.5, p.z), [p.x, p.height, p.z]);

  useFrame(({ camera }) => {
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
function Environment({ hour }) {
  const h = hour ?? 14;
  const sunAngle = ((h - 6) / 12) * Math.PI;
  const sunX = Math.cos(sunAngle) * 10;
  const sunY = Math.sin(sunAngle) * 10;
  const isNight = h < 6 || h > 20;
  const isDusk = (h >= 17 && h <= 20) || (h >= 5 && h < 7);
  return (
    <>
      <ambientLight intensity={isNight ? 0.08 : 0.25} color={isNight ? '#3344AA' : '#B8A890'} />
      <directionalLight
        position={[sunX, sunY, 4]}
        intensity={isNight ? 0.08 : isDusk ? 1.0 : 1.4}
        color={isDusk ? '#FF8040' : isNight ? '#5566AA' : '#FFD8A8'}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.001}
      />
      <directionalLight position={[-5, 3, -4]} intensity={isNight ? 0.05 : 0.2} color="#6080B0" />
      <directionalLight position={[0, 2, -8]} intensity={0.12} color="#A0B0D0" />
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
        <EffectComposer>
          <N8AO aoRadius={0.6} intensity={2.0} distanceFalloff={0.4} />
          <ToneMapping />
        </EffectComposer>
      </Canvas>
    </div>
  );
}

export function MountainBackground() { return null; }
