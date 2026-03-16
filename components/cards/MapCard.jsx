"use client";
import { useState, useMemo, useRef, Suspense, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import { EffectComposer } from "@react-three/postprocessing";
import { Effect } from "postprocessing";
import { createNoise2D } from "simplex-noise";
import * as THREE from "three";
import { mono, F, projectColor } from "@/lib/tokens";
import { tagDisplayName } from "@/lib/tags";
import { fetchWeather, getCachedLocation, DEFAULT_LOCATION } from "@/lib/weather";

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

// ── Edge detection effect (Sobel on depth + normals) ─────────────────────────
// Custom postprocessing Effect that detects edges from the depth buffer and
// a separately-rendered normals buffer, then draws dark outlines.

// ── Edge detection on color buffer (no separate normals pass) ────────────────
// Sobel on the rendered color image. Toon shading creates sharp color bands,
// so Sobel on color catches all the outlines without a second render pass.

const edgeFragment = /* glsl */`
uniform vec2 resolution;
uniform float edgeStrength;
uniform float threshold;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 texel = 1.0 / resolution;

  float tl = luma(texture2D(inputBuffer, uv + vec2(-texel.x, texel.y)).rgb);
  float t  = luma(texture2D(inputBuffer, uv + vec2(0.0, texel.y)).rgb);
  float tr = luma(texture2D(inputBuffer, uv + vec2(texel.x, texel.y)).rgb);
  float l  = luma(texture2D(inputBuffer, uv + vec2(-texel.x, 0.0)).rgb);
  float r  = luma(texture2D(inputBuffer, uv + vec2(texel.x, 0.0)).rgb);
  float bl = luma(texture2D(inputBuffer, uv + vec2(-texel.x, -texel.y)).rgb);
  float b  = luma(texture2D(inputBuffer, uv + vec2(0.0, -texel.y)).rgb);
  float br = luma(texture2D(inputBuffer, uv + vec2(texel.x, -texel.y)).rgb);

  float gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
  float gy = -tl - 2.0*t - tr + bl + 2.0*b + br;
  float edge = sqrt(gx*gx + gy*gy);

  edge = smoothstep(threshold, threshold * 3.0, edge) * edgeStrength;

  vec3 lineColor = vec3(0.06, 0.04, 0.02);
  outputColor = vec4(mix(inputColor.rgb, lineColor, edge), inputColor.a);
}
`;

class SobelEdgeEffect extends Effect {
  constructor({ resolution, edgeStrength = 0.6, threshold = 0.08 }) {
    super("SobelEdgeEffect", edgeFragment, {
      uniforms: new Map([
        ["resolution", new THREE.Uniform(resolution)],
        ["edgeStrength", new THREE.Uniform(edgeStrength)],
        ["threshold", new THREE.Uniform(threshold)],
      ]),
    });
  }
}

function EdgeDetection() {
  const { size } = useThree();

  const effect = useMemo(
    () => new SobelEdgeEffect({
      resolution: new THREE.Vector2(size.width, size.height),
      edgeStrength: 0.45,
      threshold: 0.1,
    }),
    [] // eslint-disable-line
  );

  useEffect(() => {
    effect.uniforms.get("resolution").value.set(size.width, size.height);
  }, [size, effect]);

  return (
    <EffectComposer>
      <primitive object={effect} />
    </EffectComposer>
  );
}

// ── Layout ───────────────────────────────────────────────────────────────────
function layoutProjects(tags, connections, recency, entryCounts, completedTasks) {
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
  // Use entry counts for height — projects with more real entries get taller mountains
  const maxEntries = Math.max(1, ...Object.values(entryCounts || {}));
  return tags.map(tag => {
    const pos = placed.get(tag) || { x: 0, z: 0 };
    const score = (connWeight[tag] || 0) / maxConn;
    const entryScore = (entryCounts?.[tag] || 0) / maxEntries;
    return {
      tag, x: pos.x, z: pos.z,
      height: 0.6 + entryScore * 1.8, // real effort drives height
      color: projectColor(tag),
      label: tagDisplayName(tag),
      isActive: recency?.[tag] && (Date.now() - new Date(recency[tag]).getTime()) < 7 * 86400000,
      score,
      completedTasks: completedTasks?.[tag] || 0,
    };
  });
}

function islandRadius(projectCount) {
  return 3.5 + Math.sqrt(Math.max(1, projectCount)) * 1.8;
}

// Shared sky/fog colors based on time of day + weather condition
function skyColors(hour, weather = 'clear') {
  const isNight = hour < 6 || hour > 20;
  const isDusk = (hour >= 17 && hour <= 20) || (hour >= 5 && hour < 7);

  // Base colors by time of day
  let skyTop = isNight ? '#0A0A1A' : isDusk ? '#2A1520' : '#8AAAC8';
  let skyBot = isNight ? '#1A1A30' : isDusk ? '#C07040' : '#C4B8A4';
  let fog    = isNight ? '#0A0A1A' : isDusk ? '#C07040' : '#C4B8A4';
  let fogNear = 18, fogFar = 40;

  // Weather modifiers — shift colors and fog density
  if (weather === 'overcast' || weather === 'cloudy') {
    if (!isNight) { skyTop = '#6A7888'; skyBot = '#9A9490'; fog = '#9A9490'; }
    fogNear = 14; fogFar = 32;
  } else if (weather === 'rain' || weather === 'drizzle') {
    if (!isNight) { skyTop = '#506068'; skyBot = '#808888'; fog = '#707878'; }
    fogNear = 10; fogFar = 25;
  } else if (weather === 'snow') {
    if (!isNight) { skyTop = '#8898A8'; skyBot = '#B0B8C0'; fog = '#A8B0B8'; }
    fogNear = 8; fogFar = 22;
  } else if (weather === 'fog') {
    if (!isNight) { skyTop = '#888888'; skyBot = '#A0A098'; fog = '#A0A098'; }
    fogNear = 5; fogFar = 18;
  } else if (weather === 'thunderstorm') {
    if (!isNight) { skyTop = '#3A4050'; skyBot = '#585860'; fog = '#505058'; }
    fogNear = 10; fogFar = 24;
  }

  return { isNight, isDusk, skyTop, skyBot, fog, fogNear, fogFar };
}

// ── Unified island mesh — single polar-grid geometry, no seams ───────────────
// Uses concentric rings for the top surface that seamlessly continue into
// tapering underside rings. One mesh, shared vertices at the boundary.
//
// Structure (cross-section):
//   center ──ring1──ring2──...──edgeRing──cliff1──cliff2──...──tipRing
//   (top surface, terrain detail)         (underside, tapering down)

function buildIslandGeo(projects, radius, noise2D, edgeR, vitality = 50) {
  const ANG = 64;           // angular segments
  const TOP_RINGS = 28;     // concentric rings for top surface (center→edge)
  const UNDER_RINGS = 20;   // rings for underside (edge→bottom tip)
  const DEPTH = radius * 0.9;

  const verts = [];
  const cols = [];
  const indices = [];

  // Helper: terrain height at (x, z)
  function terrainAt(x, z) {
    const dist = Math.sqrt(x * x + z * z);
    const angle = Math.atan2(z, x);
    const eR = edgeR(angle);
    const t = dist / eR;
    const mask = t > 0.75 ? Math.max(0, 1 - ((t - 0.75) / 0.25) ** 2) : 1;

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
    return h * mask + (1 - mask) * -0.05;
  }

  // Helper: terrain color — blends between lush (high vitality) and autumn (low)
  // Snow caps on the tallest peaks
  const v = Math.max(0, Math.min(100, vitality)) / 100; // 0-1
  const maxHeight = projects.length ? Math.max(...projects.map(p => p.height)) : 1;
  const snowThreshold = maxHeight * 0.75; // only tallest peaks get snow

  // Two palettes: lush green vs warm autumn
  const lush   = [[0.18,0.28,0.22],[0.22,0.42,0.20],[0.35,0.50,0.22],[0.48,0.45,0.25],[0.48,0.45,0.48],[0.85,0.78,0.70]];
  const autumn  = [[0.25,0.18,0.15],[0.45,0.28,0.18],[0.60,0.35,0.20],[0.70,0.40,0.22],[0.55,0.40,0.38],[0.80,0.70,0.60]];

  function terrainColor(x, z, h) {
    const ht = Math.max(0, Math.min(1, (h + 0.3) / 2.8));
    const n = noise2D(x * 2.5, z * 2.5) * 0.04;
    const band = ht < 0.1 ? 0 : ht < 0.25 ? 1 : ht < 0.4 ? 2 : ht < 0.6 ? 3 : ht < 0.8 ? 4 : 5;
    const base = lush[band].map((l, i) => l * v + autumn[band][i] * (1 - v) + n);

    // Snow cap: blend to white above threshold
    if (h > snowThreshold && maxHeight > 1.2) {
      const snowBlend = Math.min(1, (h - snowThreshold) / 0.4);
      return base.map(c => c + (0.92 - c) * snowBlend + noise2D(x * 4, z * 4) * 0.02);
    }
    return base;
  }

  // ── Vertex 0: center point ─────────────────────────────────────────────
  const centerH = terrainAt(0, 0);
  verts.push(0, centerH, 0);
  const cc = terrainColor(0, 0, centerH);
  cols.push(...cc);

  // ── Top surface rings (1 to TOP_RINGS) ─────────────────────────────────
  for (let ring = 1; ring <= TOP_RINGS; ring++) {
    const ringFrac = ring / TOP_RINGS; // 0→1 from center to edge
    for (let seg = 0; seg <= ANG; seg++) {
      const angle = (seg / ANG) * Math.PI * 2;
      const eR = edgeR(angle);
      const r = eR * ringFrac;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const h = terrainAt(x, z);
      verts.push(x, h, z);
      const c = terrainColor(x, z, h);
      cols.push(...c);
    }
  }

  // ── Underside rings (TOP_RINGS+1 to TOP_RINGS+UNDER_RINGS) ────────────
  for (let ring = 1; ring <= UNDER_RINGS; ring++) {
    const t = ring / UNDER_RINGS; // 0→1 from edge down to tip
    const y = -t * DEPTH;
    const taper = Math.max(0.03, (1 - t) ** 1.5);

    for (let seg = 0; seg <= ANG; seg++) {
      const angle = (seg / ANG) * Math.PI * 2;
      const eR = edgeR(angle);
      const r = eR * taper;

      // Rock displacement
      const rock = noise2D(angle * 5 + t * 8, t * 6) * 0.08
                 + noise2D(angle * 11 + t * 13, t * 11) * 0.04;
      const finalR = r * (1 + rock);

      // Vertical noise for jagged cliffs
      const yN = noise2D(angle * 5 + 20, t * 4 + 20) * 0.25
               + noise2D(angle * 11 + 40, t * 8) * 0.12;

      const x = Math.cos(angle) * finalR;
      const z = Math.sin(angle) * finalR;
      verts.push(x, y + yN * t * 0.5, z);

      // Cliff color: warm brown → dark charcoal
      const warmth = 1 - t;
      const n = noise2D(x * 2 + 30, z * 2 + 30) * 0.04;
      cols.push(0.10 + warmth * 0.30 + n, 0.08 + warmth * 0.18 + n * 0.4, 0.07 + warmth * 0.10 + n * 0.2);
    }
  }

  // ── Triangles: center fan (vertex 0 → ring 1) ─────────────────────────
  for (let seg = 0; seg < ANG; seg++) {
    const a = 0;                    // center
    const b = 1 + seg;              // ring 1 current
    const c = 1 + seg + 1;          // ring 1 next
    indices.push(a, b, c);
  }

  // ── Triangles: top surface ring-to-ring ────────────────────────────────
  const stride = ANG + 1; // vertices per ring
  for (let ring = 1; ring < TOP_RINGS; ring++) {
    const ringStart = 1 + (ring - 1) * stride;
    const nextStart = ringStart + stride;
    for (let seg = 0; seg < ANG; seg++) {
      const a = ringStart + seg;
      const b = ringStart + seg + 1;
      const c = nextStart + seg;
      const d = nextStart + seg + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  // ── Triangles: edge ring → first underside ring (seamless transition) ──
  const edgeStart = 1 + (TOP_RINGS - 1) * stride;
  const firstUnderStart = 1 + TOP_RINGS * stride;
  for (let seg = 0; seg < ANG; seg++) {
    const a = edgeStart + seg;
    const b = edgeStart + seg + 1;
    const c = firstUnderStart + seg;
    const d = firstUnderStart + seg + 1;
    indices.push(a, c, b, b, c, d);
  }

  // ── Triangles: underside ring-to-ring ──────────────────────────────────
  for (let ring = 1; ring < UNDER_RINGS; ring++) {
    const ringStart = 1 + (TOP_RINGS + ring - 1) * stride;
    const nextStart = ringStart + stride;
    for (let seg = 0; seg < ANG; seg++) {
      const a = ringStart + seg;
      const b = ringStart + seg + 1;
      const c = nextStart + seg;
      const d = nextStart + seg + 1;
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

function Terrain({ projects, radius, vitality }) {
  const geo = useMemo(() => {
    const noise2D = createNoise2D();
    function edgeR(angle) {
      return radius * (0.90
        + noise2D(Math.cos(angle) * 1.5, Math.sin(angle) * 1.5) * 0.07
        + noise2D(Math.cos(angle * 2) * 1.2, Math.sin(angle * 2) * 1.2) * 0.04
      );
    }
    return buildIslandGeo(projects, radius, noise2D, edgeR, vitality);
  }, [projects, radius, vitality]);

  return (
    <mesh geometry={geo} receiveShadow castShadow>
      <meshToonMaterial vertexColors gradientMap={toonGrad} side={THREE.DoubleSide} />
    </mesh>
  );
}

// ── Trees — procedural low-poly, instanced per project ───────────────────────
// Three tree variants (different height/width ratios). Count scales with
// completed tasks tagged to each project. Uses InstancedMesh for performance.
function Trees({ projects, radius }) {
  const { foliageGeo, trunkGeo } = useMemo(() => ({
    foliageGeo: new THREE.ConeGeometry(0.18, 0.4, 5),  // low-poly cone
    trunkGeo:   new THREE.CylinderGeometry(0.03, 0.04, 0.15, 4),
  }), []);

  const { foliageData, trunkData } = useMemo(() => {
    const noise = createNoise2D();
    const foliage = [];
    const trunks = [];
    const dummy = new THREE.Object3D();

    for (const p of projects) {
      const count = Math.min(15, Math.floor((p.completedTasks || 0) / 2));
      if (count === 0) continue;

      for (let i = 0; i < count; i++) {
        // Place trees in a ring around the mountain base
        const angle = (i / count) * Math.PI * 2 + noise(p.x + i * 0.5, p.z) * 0.8;
        const dist = 0.7 + noise(i * 0.3, p.x) * 0.3 + 0.4;
        const tx = p.x + Math.cos(angle) * dist;
        const tz = p.z + Math.sin(angle) * dist;
        // Skip if outside island
        if (Math.sqrt(tx * tx + tz * tz) > radius * 0.85) continue;

        const scale = 0.7 + noise(tx, tz) * 0.6; // size variation
        const ty = noise(tx * 0.3, tz * 0.3) * 0.3 + 0.05; // approximate terrain height at base

        // Foliage (cone) — sits on top of trunk
        dummy.position.set(tx, ty + 0.2 * scale, tz);
        dummy.scale.set(scale, scale, scale);
        dummy.rotation.y = noise(tx * 2, tz * 2) * Math.PI;
        dummy.updateMatrix();
        foliage.push(dummy.matrix.clone());

        // Trunk (cylinder) — below foliage
        dummy.position.set(tx, ty + 0.02 * scale, tz);
        dummy.scale.set(scale, scale * 0.8, scale);
        dummy.updateMatrix();
        trunks.push(dummy.matrix.clone());
      }
    }
    return { foliageData: foliage, trunkData: trunks };
  }, [projects, radius]);

  if (foliageData.length === 0) return null;

  return (
    <group>
      <instancedMesh args={[foliageGeo, undefined, foliageData.length]} castShadow ref={ref => {
        if (!ref) return;
        foliageData.forEach((m, i) => ref.setMatrixAt(i, m));
        ref.instanceMatrix.needsUpdate = true;
      }}>
        <meshToonMaterial color="#3A6830" gradientMap={toonGrad} />
      </instancedMesh>
      <instancedMesh args={[trunkGeo, undefined, trunkData.length]} ref={ref => {
        if (!ref) return;
        trunkData.forEach((m, i) => ref.setMatrixAt(i, m));
        ref.instanceMatrix.needsUpdate = true;
      }}>
        <meshToonMaterial color="#5A4030" gradientMap={toonGrad} />
      </instancedMesh>
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
          background: isHov ? p.color + 'CC' : p.color + '18',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: `1px solid ${p.color}${isHov ? '88' : '33'}`,
          borderRadius: 999, padding: '3px 12px',
          fontFamily: mono, fontSize: 11, letterSpacing: '0.08em',
          textTransform: 'uppercase', whiteSpace: 'nowrap',
          color: isHov ? '#fff' : p.color,
          cursor: 'pointer',
          boxShadow: isHov
            ? `0 4px 16px ${p.color}55, inset 0 1px 0 rgba(255,255,255,0.2)`
            : `0 2px 8px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.1)`,
          transition: 'all 0.15s',
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
      {/* Soft glow sphere (larger, transparent) */}
      <mesh>
        <sphereGeometry args={[1.6, 16, 12]} />
        <meshBasicMaterial color="#FFE8A0" transparent opacity={0.15} depthWrite={false} />
      </mesh>
      {/* Core — meshBasicMaterial so edge detection doesn't outline it */}
      <mesh>
        <sphereGeometry args={[0.7, 16, 12]} />
        <meshBasicMaterial color="#FFD860" />
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

// ── Stars (night only) — single Points geometry instead of 60 meshes ─────────
function Stars({ visible }) {
  const geo = useMemo(() => {
    const positions = new Float32Array(60 * 3);
    for (let i = 0; i < 60; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.4 + 0.2;
      const r = 18 + Math.random() * 4;
      positions[i * 3]     = Math.sin(phi) * Math.cos(theta) * r;
      positions[i * 3 + 1] = Math.cos(phi) * r;
      positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, []);

  if (!visible) return null;
  return (
    <points geometry={geo}>
      <pointsMaterial color="#E8E0F0" size={0.15} sizeAttenuation />
    </points>
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
function Scene({ projects, radius, vitality, onSelect, hovered, setHovered, hour }) {
  const peakY = projects.length
    ? projects.reduce((max, p) => Math.max(max, p.height), 0) * 0.85 : 0.5;
  return (
    <>
      <Environment hour={hour} />
      <Terrain projects={projects} radius={radius} vitality={vitality} />
      <Trees projects={projects} radius={radius} />
      <Labels projects={projects} onSelect={onSelect} hovered={hovered} setHovered={setHovered} />
      <OrbitControls
        enablePan enableZoom enableRotate
        minDistance={6} maxDistance={30}
        maxPolarAngle={Math.PI / 2.1}
        minPolarAngle={Math.PI / 8}
        target={[0, peakY, 0]}
        autoRotate autoRotateSpeed={0.3}
        onChange={e => {
          const dist = e?.target?.object?.position?.length();
          if (dist) localStorage.setItem('daylab:map-zoom', dist.toFixed(1));
        }}
      />
      <EdgeDetection />
    </>
  );
}

// ── Exports ──────────────────────────────────────────────────────────────────
export function MapCard({ allTags, connections, recency, entryCounts, completedTasks, healthDots, onSelectProject }) {
  const [hovered, setHovered] = useState(null);
  const projects = useMemo(
    () => layoutProjects(allTags || [], connections, recency, entryCounts, completedTasks),
    [allTags, connections, recency, entryCounts, completedTasks]
  );

  // Vitality: average of all 4 health scores over last 30 days (0-100)
  const vitality = useMemo(() => {
    if (!healthDots || !Object.keys(healthDots).length) return 50;
    const now = new Date();
    const cutoff = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const thirtyAgo = new Date(now); thirtyAgo.setDate(thirtyAgo.getDate() - 30);
    const cutoffStart = `${thirtyAgo.getFullYear()}-${String(thirtyAgo.getMonth()+1).padStart(2,'0')}-${String(thirtyAgo.getDate()).padStart(2,'0')}`;
    const scores = Object.entries(healthDots)
      .filter(([d]) => d >= cutoffStart && d <= cutoff)
      .map(([, v]) => ((v.sleep||0) + (v.readiness||0) + (v.activity||0) + (v.recovery||0)) / 4);
    return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 50;
  }, [healthDots]);

  // Weather condition for island atmosphere
  const [weather, setWeather] = useState('clear');
  useEffect(() => {
    const loc = getCachedLocation() || DEFAULT_LOCATION;
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    fetchWeather(dateStr, loc.lat, loc.lng).then(w => {
      if (w?.condition) setWeather(w.condition);
    });
  }, []);

  const hour = new Date().getHours() + new Date().getMinutes() / 60;
  const radius = useMemo(() => islandRadius(projects.length), [projects.length]);

  // Restore last zoom level from localStorage, default to 25
  const camDist = useMemo(() => {
    if (typeof window === 'undefined') return 25;
    const saved = localStorage.getItem('daylab:map-zoom');
    return saved ? Math.max(6, Math.min(30, parseFloat(saved))) : 25;
  }, []);

  if (!projects.length) {
    return (
      <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: mono, fontSize: F.sm, color: "var(--dl-middle)", background: 'var(--dl-well)', borderRadius: 12 }}>
        No projects yet
      </div>
    );
  }

  const sky = skyColors(hour, weather);

  return (
    <div style={{
      height: 450, borderRadius: 12, overflow: 'hidden',
      background: `linear-gradient(180deg, ${sky.skyTop} 0%, ${sky.skyBot} 100%)`,
    }}>
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        dpr={[1, 1.5]}
        camera={{ position: [camDist * 0.66, camDist * 0.30, camDist * 0.66], fov: 30, near: 0.1, far: 100 }}
        style={{ width: '100%', height: '100%' }}
      >
        <Suspense fallback={null}>
          <Scene projects={projects} radius={radius} vitality={vitality} onSelect={onSelectProject}
            hovered={hovered} setHovered={setHovered} hour={hour} />
        </Suspense>
        <fog attach="fog" args={[sky.fog, sky.fogNear, sky.fogFar]} />
      </Canvas>
    </div>
  );
}

