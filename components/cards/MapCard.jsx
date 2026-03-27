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
import { useTheme } from "@/lib/theme";
import { fetchWeather, getCachedLocation, DEFAULT_LOCATION, getDayPhase, getWeatherGradient, weatherCodeToCondition } from "@/lib/weather";

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
function layoutProjects(tags, connections, recency, entryCounts, completedTasks, habits) {
  if (!tags.length) return [];
  const connWeight = {};
  tags.forEach(t => { connWeight[t] = 0; });
  (connections || []).forEach(({ source, target, weight }) => {
    if (connWeight[source] != null) connWeight[source] += weight;
    if (connWeight[target] != null) connWeight[target] += weight;
  });

  // Sort by recency — most recently active projects go toward center
  const now = Date.now();
  const recencyScore = (tag) => {
    if (!recency?.[tag]) return 0;
    const age = now - new Date(recency[tag]).getTime();
    const days = age / 86400000;
    if (days < 1) return 1.0;   // today
    if (days < 7) return 0.7;   // this week
    if (days < 30) return 0.4;  // this month
    return 0.1;
  };
  const sorted = [...tags].sort((a, b) => recencyScore(b) - recencyScore(a));

  const placed = new Map();
  const n = sorted.length;
  // Spread projects more — larger base radius, more spacing for more projects
  const baseRadius = n <= 3 ? 2.5 : 2.0 + n * 0.3;
  sorted.forEach((tag, i) => {
    const angle = (i / n) * Math.PI * 2 + Math.PI / 4;
    const rScore = recencyScore(tag);
    // First project at center, rest spread outward — more projects = more spacing
    const radius = i === 0 ? 0 : (baseRadius + (1 - rScore) * 3.0) + (i / n) * 2.5;
    placed.set(tag, { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
  });
  // More iterations and stronger repulsion for better separation
  for (let iter = 0; iter < 15; iter++) {
    // Weaker connection pull — prevent clumping
    (connections || []).forEach(({ source, target, weight }) => {
      const a = placed.get(source), b = placed.get(target);
      if (!a || !b) return;
      const pull = 0.008 * Math.min(weight, 3);
      const dx = b.x - a.x, dz = b.z - a.z;
      a.x += dx * pull; a.z += dz * pull;
      b.x -= dx * pull; b.z -= dz * pull;
    });
    // Stronger repulsion with larger minimum distance
    const entries = [...placed.entries()];
    for (let j = 0; j < entries.length; j++) {
      for (let k = j + 1; k < entries.length; k++) {
        const a = entries[j][1], b = entries[k][1];
        const dx = a.x - b.x, dz = a.z - b.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const minDist = 3.5;
        if (dist < minDist && dist > 0.01) {
          const push = (minDist - dist) * 0.4 / dist;
          a.x += dx * push; a.z += dz * push;
          b.x -= dx * push; b.z -= dz * push;
        }
      }
    }
  }
  const maxConn = Math.max(1, ...Object.values(connWeight));
  const maxEntries = Math.max(1, ...Object.values(entryCounts || {}));
  const result = tags.map(tag => {
    const pos = placed.get(tag) || { x: 0, z: 0 };
    const entryScore = (entryCounts?.[tag] || 0) / maxEntries;
    const connScore = (connWeight[tag] || 0) / maxConn;
    const rScore = recencyScore(tag);
    const daysSinceActive = recency?.[tag] ? (now - new Date(recency[tag]).getTime()) / 86400000 : 999;
    // Deterministic hash from project name — used for height variation + shape seed
    let hash = 0;
    for (let c = 0; c < tag.length; c++) hash = (hash * 31 + tag.charCodeAt(c)) >>> 0;
    const variation = (hash % 100) / 100; // 0–1
    // Shape variation seeds (deterministic per project)
    const widthSeed  = ((hash >>> 4) % 100) / 100;   // 0–1: peak width
    const slopeSeed  = ((hash >>> 8) % 100) / 100;   // 0–1: slope steepness
    const asymSeed   = ((hash >>> 12) % 100) / 100;  // 0–1: ridge asymmetry
    const subSeed    = ((hash >>> 16) % 100) / 100;   // 0–1: sub-peak count/style
    const leanSeed   = ((hash >>> 20) % 100) / 100;   // 0–1: peak lean direction
    const h = Math.max(entryScore, connScore, 0.15) * 2.0 + 0.8 + variation * 1.5;
    const rawEntries = entryCounts?.[tag] || 0;
    return {
      tag, x: pos.x, z: pos.z,
      height: h,
      color: projectColor(tag),
      label: tagDisplayName(tag),
      score: Math.max(entryScore, connScore, 0.3),
      // Shape variation — seeded from project name hash
      widthFactor: 0.7 + widthSeed * 0.6,     // 0.7–1.3: narrower or wider peaks
      asymmetry: asymSeed * 0.4,               // 0–0.4: ridge lean offset
      leanAngle: leanSeed * Math.PI * 2,        // lean direction
      // Multi-peak: single (0), double (1), or triple (2) jagged spikes
      peakStyle: subSeed < 0.4 ? 0 : subSeed < 0.75 ? 1 : 2,
      peakSpread: 0.25 + slopeSeed * 0.25,      // how far apart sub-peaks sit
      // Dormant: no activity in 7+ days. Active: activity in last 7 days.
      isActive: daysSinceActive < 7,
      // Volcano: consistent recent engagement — active in last 3 days with 5+ entries
      isHot: daysSinceActive < 3 && rawEntries >= 5,
      recencyScore: rScore,
      completedTasks: completedTasks?.[tag] || 0,
      habits: habits?.[tag] || [], // [{text, flagCount, topScore, streak}]
    };
  });

  // Cap volcanos to max 2 — sort by raw entries, demote the rest to active
  const hot = result.filter(p => p.isHot).sort((a, b) => b.score - a.score);
  for (let i = 2; i < hot.length; i++) hot[i].isHot = false;

  return result;
}

function islandRadius(projectCount) {
  // Bigger island — grows faster with more projects to give each one space
  return 4.5 + Math.sqrt(Math.max(1, projectCount)) * 2.8;
}

// Shared sky/fog colors based on time of day + weather condition
// Uses the same weather/solar system as the daily view WeatherBackground
function skyColors(weather = 'clear') {
  const loc = getCachedLocation() || DEFAULT_LOCATION;
  const phase = getDayPhase(new Date(), loc.lat, loc.lng);
  const [top, bot] = getWeatherGradient(weather, phase);
  const isNight = phase.light < 0.1;
  const isDusk = phase.light >= 0.1 && phase.light < 0.35;
  // Fog density from weather condition
  // Fog starts further out so the island stays visible when zoomed out
  let fogNear = 30, fogFar = 80;
  if (weather === 'rain' || weather === 'drizzle') { fogNear = 20; fogFar = 55; }
  else if (weather === 'snow') { fogNear = 16; fogFar = 45; }
  else if (weather === 'fog') { fogNear = 10; fogFar = 35; }
  else if (weather === 'overcast' || weather === 'cloudy') { fogNear = 25; fogFar = 65; }
  else if (weather === 'thunderstorm') { fogNear = 18; fogFar = 50; }
  return { isNight, isDusk, skyTop: top, skyBot: bot, fog: bot, fogNear, fogFar, light: phase.light };
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
      const wf = p.widthFactor || 1.0;
      const lean = p.asymmetry || 0;
      const la = p.leanAngle || 0;
      const baseR = (0.6 + p.score * 0.3) * wf;

      if (p.isHot) {
        // Volcano: single wide peak with caldera
        const dx = x - p.x, dz = z - p.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        const r = baseR * 1.5;
        if (d < r * 2.0) {
          const f = Math.max(0, 1 - d / (r * 2.0));
          const volcano = f < 0.7 ? f * f : 0.49 - (f - 0.7) * 0.5;
          h += p.height * 1.4 * volcano;
        }
      } else {
        // Build spike list: single, double, or triple jagged peaks
        const style = p.peakStyle || 0;
        const spread = p.peakSpread || 0.35;
        const spikes = [{ ox: 0, oz: 0, ht: 1.0, rMul: 1.0 }]; // main peak always present

        if (style >= 1) {
          // Second spike: offset along lean direction, shorter
          spikes.push({ ox: Math.cos(la) * spread, oz: Math.sin(la) * spread, ht: 0.6 + lean, rMul: 0.7 });
        }
        if (style >= 2) {
          // Third spike: offset opposite + perpendicular, even shorter
          const la2 = la + 2.2; // ~126 degrees offset
          spikes.push({ ox: Math.cos(la2) * spread * 0.8, oz: Math.sin(la2) * spread * 0.8, ht: 0.45, rMul: 0.6 });
        }

        // Lean the main peak center
        spikes[0].ox += Math.cos(la) * lean * 0.5;
        spikes[0].oz += Math.sin(la) * lean * 0.5;

        // Sum all spikes — sharp cubic falloff (f^3) for angular low-poly feel
        for (const spike of spikes) {
          const sx = x - (p.x + spike.ox), sz = z - (p.z + spike.oz);
          const d = Math.sqrt(sx * sx + sz * sz);
          const r = baseR * spike.rMul;
          if (d < r * 2.0) {
            const f = Math.max(0, 1 - d / (r * 2.0));
            h += p.height * spike.ht * f * f * f;
          }
        }
      }
    }
    return h * mask + (1 - mask) * -0.05;
  }

  // Helper: terrain color — blends between lush (high vitality) and autumn (low)
  // Snow caps on the tallest peaks
  const v = Math.max(0, Math.min(100, vitality)) / 100; // 0-1
  const maxHeight = projects.length ? Math.max(...projects.map(p => p.height)) : 1;
  const snowThreshold = maxHeight * 0.75; // only tallest peaks get snow

  // Two palettes: saturated tropical vs warm drought
  // More contrast: deep shadows at low, vivid greens at mid-low, warm earth at mid, cool rock at high
  const lush = [
    [0.06, 0.18, 0.08], // 0: deep valley shadow — very dark green
    [0.10, 0.35, 0.12], // 1: low — rich forest green
    [0.20, 0.50, 0.15], // 2: mid-low — bright jungle green
    [0.50, 0.42, 0.22], // 3: mid — warm earth/exposed soil
    [0.55, 0.50, 0.48], // 4: high — cool grey rock
    [0.88, 0.82, 0.74], // 5: peak — light stone
  ];
  const drought = [
    [0.20, 0.12, 0.08], // 0: deep — burnt umber
    [0.40, 0.25, 0.12], // 1: low — dry earth
    [0.55, 0.35, 0.18], // 2: mid-low — warm sand
    [0.65, 0.42, 0.22], // 3: mid — terracotta
    [0.52, 0.42, 0.38], // 4: high — muted rock
    [0.75, 0.65, 0.55], // 5: peak — dry stone
  ];

  function terrainColor(x, z, h) {
    const ht = Math.max(0, Math.min(1, (h + 0.3) / 2.8));
    // Larger noise variation for more texture
    const n = noise2D(x * 2.5, z * 2.5) * 0.06;
    // Fake ambient occlusion: darken low areas and concavities
    const ao = Math.max(0, Math.min(1, (h + 0.1) / 0.6)); // 0 at valleys, 1 at hills
    const aoFactor = 0.7 + ao * 0.3; // darken valleys by up to 30%
    const band = ht < 0.1 ? 0 : ht < 0.25 ? 1 : ht < 0.4 ? 2 : ht < 0.6 ? 3 : ht < 0.8 ? 4 : 5;
    let base = lush[band].map((l, i) => (l * v + drought[band][i] * (1 - v) + n) * aoFactor);

    // Project color gradient near peaks — dark rock at base, project pastel near summit
    for (const p of projects) {
      const dx = x - p.x, dz = z - p.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const peakR = (0.6 + p.score * 0.3) * (p.widthFactor || 1.0);
      if (dist < peakR * 1.8 && h > p.height * 0.35) {
        const heightBlend = Math.min(1, (h - p.height * 0.35) / (p.height * 0.65));
        const distBlend = 1 - dist / (peakR * 1.8);
        const blend = heightBlend * distBlend * 0.35; // subtle — 35% max tint
        const cr = parseInt(p.color.slice(1, 3), 16) / 255;
        const cg = parseInt(p.color.slice(3, 5), 16) / 255;
        const cb = parseInt(p.color.slice(5, 7), 16) / 255;
        base = base.map((c, i) => c + ([cr, cg, cb][i] - c) * blend);
      }
    }

    // Volcanic magma: hot projects get bright lava at crater + flow streaks down sides
    for (const p of projects) {
      if (!p.isHot) continue;
      const dx = x - p.x, dz = z - p.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const peakR = (0.6 + p.score * 0.3) * (p.widthFactor || 1.0) * 1.5; // match volcano radius

      // Crater glow — bright orange-red inside the caldera
      if (dist < peakR * 0.4 && h > p.height * 0.5) {
        const glow = (1 - dist / (peakR * 0.4)) * Math.min(1, (h - p.height * 0.5) / (p.height * 0.3));
        const magma = [0.95, 0.25, 0.05];
        return base.map((c, i) => c + (magma[i] - c) * glow * 0.85);
      }

      // Lava flow streaks down the sides — noise-driven channels
      if (dist < peakR * 1.5 && h > p.height * 0.15) {
        const angle = Math.atan2(dz, dx);
        // Create 3-4 lava channels using noise
        const channel = noise2D(Math.cos(angle) * 3 + p.x * 5, Math.sin(angle) * 3 + p.z * 5);
        if (channel > 0.3) {
          const heightFade = Math.min(1, (h - p.height * 0.15) / (p.height * 0.5));
          const distFade = 1 - dist / (peakR * 1.5);
          const intensity = (channel - 0.3) / 0.7 * heightFade * distFade;
          const lava = [0.9, 0.2 + intensity * 0.2, 0.02];
          return base.map((c, i) => c + (lava[i] - c) * intensity * 0.7);
        }
      }
    }

    // Warm ember tint for active (but not hot) projects near peaks
    for (const p of projects) {
      if (!p.isActive || p.isHot) continue;
      const dx = x - p.x, dz = z - p.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 0.5 && h > p.height * 0.6) {
        const glow = (1 - dist / 0.5) * Math.min(1, (h - p.height * 0.6) / (p.height * 0.4));
        const ember = [0.85, 0.35, 0.08];
        return base.map((c, i) => c + (ember[i] - c) * glow * 0.4);
      }
    }

    // Snow cap: only on tall INACTIVE peaks (not active or hot — those have magma)
    if (h > snowThreshold && maxHeight > 1.2) {
      // Check if this point is near any active project — skip snow if so
      let nearActive = false;
      for (const p of projects) {
        if (!p.isActive) continue;
        const dx = x - p.x, dz = z - p.z;
        if (Math.sqrt(dx * dx + dz * dz) < 1.5) { nearActive = true; break; }
      }
      if (!nearActive) {
        const snowBlend = Math.min(1, (h - snowThreshold) / 0.4);
        return base.map(c => c + (0.92 - c) * snowBlend + noise2D(x * 4, z * 4) * 0.02);
      }
    }

    // Tropical foliage: lush jungle patches around mountain bases
    // Dappled canopy effect with varied greens, yellows, deep shadows
    let foliageBlend = 0;
    for (const p of projects) {
      if (!p.completedTasks) continue;
      const dx = x - p.x, dz = z - p.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const foliageR = 0.5 + Math.min(20, p.completedTasks) / 20 * 1.2;
      if (dist < foliageR) {
        const patchNoise = noise2D(x * 3 + p.x * 7, z * 3 + p.z * 7) * 0.5 + 0.5;
        const falloff = 1 - (dist / foliageR);
        foliageBlend = Math.max(foliageBlend, falloff * falloff * patchNoise * Math.min(1, p.completedTasks / 6));
      }
    }
    if (foliageBlend > 0.05 && ht < 0.5) {
      // Tropical canopy: mix of deep green, yellow-green, and dark shadow
      const canopyType = noise2D(x * 6, z * 6); // -1 to 1
      const deep   = [0.08, 0.28, 0.10]; // deep jungle shadow
      const bright  = [0.22, 0.48, 0.15]; // sunlit canopy
      const golden  = [0.35, 0.45, 0.12]; // yellow-green highlight
      const canopy = canopyType < -0.3 ? deep : canopyType > 0.3 ? golden : bright;
      return base.map((c, i) => c + (canopy[i] - c) * foliageBlend * 0.75);
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

// ── Water — flat surface + waterfall strips off the edge ──────────────────────
function Water({ radius, vitality = 50 }) {
  const vt = Math.max(0, Math.min(1, vitality / 100));
  const waterY = 0.0 + vt * 0.12; // visible above low terrain
  const R = radius * 0.88;

  // Richer, more saturated water color
  const waterColor = useMemo(() => new THREE.Color().setRGB(
    0.08 + (1 - vt) * 0.12, 0.28 + vt * 0.15, 0.48 + vt * 0.22
  ), [vt]);

  // Waterfall geometry: build a custom mesh with strips hanging off the edge
  const fallGeo = useMemo(() => {
    const noise = createNoise2D();
    const fallCount = 3 + Math.floor(vt * 5); // 3-8 waterfalls
    const verts = [];
    const indices = [];
    const uvs = [];
    let vi = 0;

    for (let f = 0; f < fallCount; f++) {
      const angle = (f / fallCount) * Math.PI * 2 + noise(f * 7, 0) * 0.4;
      const width = 0.12 + noise(f * 3, 1) * 0.08; // 0.04 to 0.20
      const fallLen = radius * 0.5 + noise(f * 5, 2) * radius * 0.2;

      // Two edges of the waterfall strip at the island rim
      const halfW = width / 2;
      const perpX = -Math.sin(angle), perpZ = Math.cos(angle);
      const edgeX = Math.cos(angle) * R, edgeZ = Math.sin(angle) * R;

      // Top-left, top-right (at water surface level)
      verts.push(edgeX + perpX * halfW, waterY, edgeZ + perpZ * halfW);
      verts.push(edgeX - perpX * halfW, waterY, edgeZ - perpZ * halfW);
      uvs.push(0, 0, 1, 0);

      // Bottom-left, bottom-right (hanging down)
      verts.push(edgeX + perpX * halfW * 0.3, waterY - fallLen, edgeZ + perpZ * halfW * 0.3);
      verts.push(edgeX - perpX * halfW * 0.3, waterY - fallLen, edgeZ - perpZ * halfW * 0.3);
      uvs.push(0, 1, 1, 1);

      // Two triangles for this strip
      indices.push(vi, vi + 2, vi + 1, vi + 1, vi + 2, vi + 3);
      vi += 4;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [radius, vt, waterY]);

  return (
    <group>
      {/* Water surface — more opaque, visible */}
      <mesh position={[0, waterY, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[R, 48]} />
        <meshToonMaterial color={waterColor} gradientMap={toonGrad}
          transparent opacity={0.75} />
      </mesh>

      {/* Waterfall strips — taper from wide at rim to narrow below */}
      <mesh geometry={fallGeo}>
        <meshBasicMaterial color={waterColor}
          transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// ── Labels ───────────────────────────────────────────────────────────────────
function DepthLabel({ p, onSelect, isHov, setHovered, isDark, isSelected, hasSelection }) {
  const labelY = p.height + 0.35;
  // When a project is selected: selected label is bright, others fade
  const dimmed = hasSelection && !isSelected && !isHov;

  return (
    <Html position={[p.x, labelY, p.z]} center
      zIndexRange={isSelected ? [9998, 9998] : isHov ? [9999, 9999] : [16, 0]}
      style={{ pointerEvents: 'auto' }}>
      <div data-map-label onClick={() => onSelect(p.tag)}
        onMouseEnter={() => setHovered(p.tag)}
        onMouseLeave={() => setHovered(null)}
        style={{
          background: isSelected ? (isDark ? `${p.color}28` : 'var(--dl-card)') : isHov ? `${p.color}28` : 'var(--dl-glass)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          border: `1px solid ${(isSelected || isHov) ? p.color : 'var(--dl-glass-border)'}`,
          borderRadius: 999, padding: '3px 12px',
          fontFamily: mono, fontSize: 11, fontWeight: isSelected ? 600 : 400,
          letterSpacing: '0.08em',
          textTransform: 'uppercase', whiteSpace: 'nowrap',
          color: (isSelected || isHov) ? p.color : 'var(--dl-highlight)',
          cursor: 'pointer',
          opacity: dimmed ? 0.4 : 1,
          boxShadow: isSelected ? `0 0 10px ${p.color}44` : 'none',
          transition: 'all 0.15s ease-out',
          userSelect: 'none',
        }}>
        {p.label.toUpperCase()}
      </div>
    </Html>
  );
}

// ── Low-poly tree ────────────────────────────────────────────────────────────
function Tree({ position, scale = 1 }) {
  return (
    <group position={position} scale={[scale, scale, scale]}>
      {/* Trunk */}
      <mesh position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.03, 0.05, 0.3, 5]} />
        <meshToonMaterial color="#6B4226" gradientMap={toonGrad} />
      </mesh>
      {/* Canopy — stacked cones */}
      <mesh position={[0, 0.45, 0]}>
        <coneGeometry args={[0.18, 0.3, 5]} />
        <meshToonMaterial color="#2D5A1E" gradientMap={toonGrad} />
      </mesh>
      <mesh position={[0, 0.6, 0]}>
        <coneGeometry args={[0.14, 0.25, 5]} />
        <meshToonMaterial color="#3A6E28" gradientMap={toonGrad} />
      </mesh>
    </group>
  );
}

// ── Round tree (deciduous) ───────────────────────────────────────────────────
function RoundTree({ position, scale = 1 }) {
  return (
    <group position={position} scale={[scale, scale, scale]}>
      <mesh position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.03, 0.04, 0.3, 5]} />
        <meshToonMaterial color="#5A3A1A" gradientMap={toonGrad} />
      </mesh>
      <mesh position={[0, 0.45, 0]}>
        <dodecahedronGeometry args={[0.18, 1]} />
        <meshToonMaterial color="#3A7030" gradientMap={toonGrad} />
      </mesh>
    </group>
  );
}

// ── Grass tuft ──────────────────────────────────────────────────────────────
function Grass({ position, scale = 1 }) {
  return (
    <group position={position} scale={[scale, scale * 1.2, scale]}>
      <mesh position={[0, 0.04, 0]}>
        <coneGeometry args={[0.06, 0.12, 4]} />
        <meshToonMaterial color="#4A7828" gradientMap={toonGrad} />
      </mesh>
      <mesh position={[0.04, 0.03, 0.02]} rotation={[0, 0.8, 0.15]}>
        <coneGeometry args={[0.04, 0.09, 3]} />
        <meshToonMaterial color="#3A6820" gradientMap={toonGrad} />
      </mesh>
    </group>
  );
}

// ── Rock ─────────────────────────────────────────────────────────────────────
function Rock({ position, scale = 1 }) {
  return (
    <mesh position={position} scale={[scale, scale * 0.6, scale]}>
      <dodecahedronGeometry args={[0.1, 0]} />
      <meshToonMaterial color="#6A6A5A" gradientMap={toonGrad} />
    </mesh>
  );
}

// ── Foliage around mountain bases (trees + rocks from completed tasks) ───────
function Foliage({ projects }) {
  const items = useMemo(() => {
    const result = [];
    const types = ['tree', 'roundTree', 'grass', 'rock'];
    for (const p of projects) {
      if (!p.completedTasks) continue;
      const count = Math.min(p.completedTasks, 40);
      for (let i = 0; i < count; i++) {
        // Deterministic pseudo-random from index + project position
        const seed = Math.sin(i * 127.1 + p.x * 311.7 + p.z * 269.5) * 43758.5453;
        const rnd = seed - Math.floor(seed); // 0–1
        const type = types[Math.floor(rnd * types.length)];
        const angle = (i / count) * Math.PI * 2 + p.x * 3 + rnd * 0.5;
        const dist = 0.4 + (rnd * 0.6) + (i % 3) * 0.2;
        const scale = 0.4 + rnd * 0.5;
        result.push({
          type, key: `fo-${p.tag}-${i}`,
          pos: [p.x + Math.cos(angle) * dist, 0, p.z + Math.sin(angle) * dist],
          scale,
        });
      }
    }
    return result;
  }, [projects]);

  return (
    <>
      {items.map(item => {
        const props = { position: item.pos, scale: item.scale };
        if (item.type === 'tree') return <Tree key={item.key} {...props} />;
        if (item.type === 'roundTree') return <RoundTree key={item.key} {...props} />;
        if (item.type === 'grass') return <Grass key={item.key} {...props} />;
        return <Rock key={item.key} {...props} />;
      })}
    </>
  );
}

// ── Habit flags on mountainside ───────────────────────────────────────────────
// Each repeating task with 10+ repeats gets a flag.
// Flag height = streak / topScore (100% = summit, lower = partway up).
// Color cycles through a palette per habit.
const FLAG_COLORS = ['#4A9E6E', '#6B8EB8', '#C17B4A', '#A07AB0', '#B06878'];

function Flags({ projects }) {
  const flags = useMemo(() => {
    const result = [];
    for (const p of projects) {
      if (!p.habits?.length) continue;
      p.habits.forEach((habit, i) => {
        // Height: streak as % of topScore (flagCount is the all-time max)
        const pct = habit.topScore > 0 ? Math.min(1, habit.streak / habit.topScore) : 0;
        const heightFrac = 0.15 + pct * 0.85; // min 15% up the mountain, 100% = summit
        const angle = i * 2.4 + p.x * 3; // spread flags around the mountain
        const dist = 0.25 + (i % 3) * 0.1;
        const y = p.height * heightFrac;
        result.push({
          key: `f-${p.tag}-${i}`,
          pos: [p.x + Math.cos(angle) * dist, y, p.z + Math.sin(angle) * dist],
          color: FLAG_COLORS[i % FLAG_COLORS.length],
          atSummit: pct >= 0.99,
        });
      });
    }
    return result;
  }, [projects]);

  return (
    <>
      {flags.map(f => (
        <group key={f.key} position={f.pos}>
          {/* Pole */}
          <mesh position={[0, 0.15, 0]}>
            <cylinderGeometry args={[0.01, 0.01, 0.3, 4]} />
            <meshToonMaterial color="#888" gradientMap={toonGrad} />
          </mesh>
          {/* Flag */}
          <mesh position={[0.06, 0.25, 0]}>
            <planeGeometry args={[0.12, 0.07]} />
            <meshToonMaterial color={f.color} gradientMap={toonGrad} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </>
  );
}

// ── Volcanic glow for very active projects ───────────────────────────────────
function VolcanicGlow({ projects }) {
  return (
    <>
      {projects.filter(p => p.isHot).map(p => (
        <group key={`v-${p.tag}`} position={[p.x, p.height * 0.75, p.z]}>
          {/* Diffuse lava light from inside crater — no visible mesh */}
          <pointLight color="#FF4400" intensity={4} distance={3} decay={2} />
        </group>
      ))}
    </>
  );
}

// ── Birds circling peaks (for active projects with streaks) ──────────────────
function Birds({ projects }) {
  const birdData = useMemo(() => {
    // Birds appear on projects active this week with at least 5 completed tasks
    return projects
      .filter(p => p.isActive && p.completedTasks >= 5)
      .flatMap((p, pi) => {
        const count = Math.min(3, Math.floor(p.completedTasks / 10) + 1);
        return Array.from({ length: count }, (_, i) => ({
          key: `b-${p.tag}-${i}`,
          center: [p.x, p.height + 0.6 + i * 0.15, p.z],
          radius: 0.4 + i * 0.15,
          speed: 0.8 + i * 0.3,
          offset: (pi * 2.1 + i * 2.0),
        }));
      });
  }, [projects]);

  return birdData.map(b => <Bird key={b.key} {...b} />);
}

// Tapered wing shape — wide at body, pointed at tip
const wingGeo = (() => {
  const g = new THREE.BufferGeometry();
  // Triangle: body edge (wide) tapering to wingtip (point)
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, -0.008,    // body trailing edge
    0, 0, 0.008,     // body leading edge
    0.065, 0, 0.001, // wingtip (slightly forward)
  ], 3));
  g.computeVertexNormals();
  return g;
})();

function Bird({ center, radius, speed, offset }) {
  const ref = useRef();
  const leftRef = useRef();
  const rightRef = useRef();

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime * speed * 0.5 + offset; // slower flight

    // Circular path with gentle bobbing
    ref.current.position.x = center[0] + Math.cos(t) * radius;
    ref.current.position.y = center[1] + Math.sin(t * 0.5) * 0.08;
    ref.current.position.z = center[2] + Math.sin(t) * radius;

    // Face direction of travel
    const dx = -Math.sin(t) * radius;
    const dz = Math.cos(t) * radius;
    ref.current.rotation.y = Math.atan2(dx, dz);

    // Slow, lazy wing flap
    const flapT = clock.elapsedTime * 2.8 + offset * 3;
    const raw = Math.sin(flapT);
    const flap = raw > 0 ? raw * 0.6 : raw * 0.4;
    if (leftRef.current) leftRef.current.rotation.z = flap;
    if (rightRef.current) rightRef.current.rotation.z = -flap;
  });

  const mat = <meshBasicMaterial color="#f5f0e8" side={THREE.DoubleSide} transparent opacity={0.9} />;

  return (
    <group ref={ref}>
      {/* Left wing — tapered triangle, pivots at body */}
      <group ref={leftRef}>
        <mesh geometry={wingGeo}>
          {mat}
        </mesh>
      </group>
      {/* Right wing — mirrored */}
      <group ref={rightRef} scale={[-1, 1, 1]}>
        <mesh geometry={wingGeo}>
          {mat}
        </mesh>
      </group>
    </group>
  );
}

function Labels({ projects, onSelect, hovered, setHovered, selectedProject, isDark }) {
  return projects.map(p => (
    <DepthLabel key={p.tag} p={p} onSelect={onSelect}
      isHov={hovered === p.tag} setHovered={setHovered} isDark={isDark}
      isSelected={selectedProject === p.tag}
      hasSelection={!!selectedProject} />
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
      {/* Soft 3D glow sphere — cool, dim */}
      <mesh>
        <sphereGeometry args={[0.8, 16, 12]} />
        <meshBasicMaterial color="#A0B0D0" transparent opacity={0.08} depthWrite={false} />
      </mesh>
      {/* Moon body */}
      <mesh>
        <sphereGeometry args={[0.35, 16, 12]} />
        <meshBasicMaterial color="#D0D8E8" />
      </mesh>
      {/* Dark crater spots */}
      <mesh position={[0.08, 0.1, 0.3]}>
        <sphereGeometry args={[0.07, 6, 4]} />
        <meshBasicMaterial color="#A0A8C0" />
      </mesh>
      <mesh position={[-0.1, -0.05, 0.28]}>
        <sphereGeometry args={[0.05, 6, 4]} />
        <meshBasicMaterial color="#9098B0" />
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
  const { isNight, isDusk } = skyColors();
  const sunAngle = ((h - 6) / 12) * Math.PI;
  const sunX = Math.cos(sunAngle) * 12;
  const sunY = Math.max(2, Math.sin(sunAngle) * 8);
  const sunZ = -10;
  const moonAngle = sunAngle + Math.PI;
  const moonX = Math.cos(moonAngle) * 14;
  const moonY = Math.max(2, Math.sin(moonAngle) * 14);
  return (
    <>
      {/* Ambient — lower for more contrast between lit and shadow */}
      <ambientLight intensity={isNight ? 0.06 : 0.15} color={isNight ? '#3344AA' : '#C8B8A0'} />
      {/* Main sun — stronger for pronounced toon bands */}
      <directionalLight
        position={[sunX, sunY, sunZ]}
        intensity={isNight ? 0.08 : isDusk ? 1.2 : 1.8}
        color={isDusk ? '#FF8040' : isNight ? '#5566AA' : '#FFE0B0'}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.001}
      />
      {/* Fill — cool blue from opposite side */}
      <directionalLight position={[-5, 3, -4]} intensity={isNight ? 0.04 : 0.15} color="#5070A0" />
      {/* Rim/back light — creates glowing edge silhouette on peaks */}
      <directionalLight position={[-sunX, sunY * 0.5, -sunZ]} intensity={isNight ? 0.03 : 0.4} color="#FFE8C8" />

      {/* Celestial bodies */}
      <CelSun position={[sunX, sunY, sunZ]} visible={!isNight} />
      <CelMoon position={[moonX, moonY, -4]} visible={isNight || isDusk} />
      <Stars visible={isNight} />
    </>
  );
}

// ── Scene ────────────────────────────────────────────────────────────────────
// ── Selection beacon — soft light pillar from selected mountain ───────────────
function SelectionBeacon({ projects, selectedProject }) {
  const selected = selectedProject ? projects.find(p => p.tag === selectedProject) : null;
  if (!selected) return null;
  return (
    <group position={[selected.x, 0, selected.z]}>
      {/* Vertical light pillar — from ground through peak and above */}
      <mesh position={[0, selected.height * 0.5 + 0.5, 0]}>
        <cylinderGeometry args={[0.01, 0.06, selected.height + 1, 8]} />
        <meshBasicMaterial color={selected.color} transparent opacity={0.25} depthWrite={false} />
      </mesh>
      {/* Glow at peak */}
      <pointLight position={[0, selected.height, 0]} color={selected.color} intensity={2} distance={2} decay={2} />
    </group>
  );
}

function Scene({ projects, radius, vitality, onSelect, hovered, setHovered, selectedProject, hour, isDark }) {
  const peakY = projects.length
    ? projects.reduce((max, p) => Math.max(max, p.height), 0) * 0.85 : 0.5;
  return (
    <>
      <Environment hour={hour} />
      <Terrain projects={projects} radius={radius} vitality={vitality} />
      <Water radius={radius} vitality={vitality} />
      <Foliage projects={projects} />
      <Flags projects={projects} />
      <VolcanicGlow projects={projects} />
      <Birds projects={projects} />
      <SelectionBeacon projects={projects} selectedProject={selectedProject} />
      <Labels projects={projects} onSelect={onSelect} hovered={hovered} setHovered={setHovered} selectedProject={selectedProject} isDark={isDark} />
      <OrbitControls
        enablePan enableZoom enableRotate
        minDistance={6} maxDistance={30}
        maxPolarAngle={Math.PI / 2.1}
        minPolarAngle={Math.PI / 8}
        target={[0, peakY, 0]}
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
export function MapCard({ allTags, connections, recency, entryCounts, completedTasks, habits, healthDots, selectedProject, onSelectProject, date, token }) {
  const { theme } = useTheme();
  const appDark = theme === 'dark';
  const [hovered, setHovered] = useState(null);
  const projects = useMemo(
    () => layoutProjects(allTags || [], connections, recency, entryCounts, completedTasks, habits),
    [allTags, connections, recency, entryCounts, completedTasks, habits]
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

  // Weather condition for island atmosphere + temperature
  const [weather, setWeather] = useState('clear');
  const [temperature, setTemperature] = useState(null);
  const [cityName, setCityName] = useState(null);
  const [useCelsius, setUseCelsius] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('daylab:temp-unit') === 'C';
  });
  useEffect(() => {
    const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
    const dateStr = date || todayStr;
    const isToday = dateStr === todayStr;

    // For past dates with a token, fetch saved location from DB
    if (!isToday && token) {
      fetch(`/api/location?date=${dateStr}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          const loc = d?.location;
          if (loc?.lat != null && loc?.lng != null) {
            setCityName(loc.city || null);
            return fetchWeather(dateStr, loc.lat, loc.lng);
          }
          // No saved location — fall back to cached browser location
          setCityName(null);
          const fallback = getCachedLocation() || DEFAULT_LOCATION;
          return fetchWeather(dateStr, fallback.lat, fallback.lng);
        })
        .then(w => {
          if (w?.condition) setWeather(w.condition);
          if (w?.temperature != null) setTemperature(w.temperature);
        })
        .catch(() => {});
    } else {
      // Today or no token: use browser location
      const loc = getCachedLocation() || DEFAULT_LOCATION;
      setCityName(null);
      fetchWeather(dateStr, loc.lat, loc.lng).then(w => {
        if (w?.condition) setWeather(w.condition);
        if (w?.temperature != null) setTemperature(w.temperature);
      });
      // Also try to load city name for today from saved location
      if (isToday && token) {
        fetch(`/api/location?date=${dateStr}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d?.location?.city) setCityName(d.location.city); })
          .catch(() => {});
      }
    }
  }, [date, token]);

  const hour = new Date().getHours() + new Date().getMinutes() / 60;
  const radius = useMemo(() => islandRadius(projects.length), [projects.length]);

  // Restore last zoom level from localStorage, default to 25
  const camDist = useMemo(() => {
    if (typeof window === 'undefined') return 25;
    const saved = localStorage.getItem('daylab:map-zoom');
    return saved ? Math.max(6, Math.min(30, parseFloat(saved))) : 25;
  }, []);

  const sky = skyColors(weather);

  // Track pointer-down position so we can distinguish drag from click
  const pointerDownPos = useRef(null);

  const handlePointerDown = (e) => {
    pointerDownPos.current = { x: e.clientX, y: e.clientY };
  };
  const handleClick = (e) => {
    if (!selectedProject) return;
    const down = pointerDownPos.current;
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (Math.sqrt(dx*dx + dy*dy) > 5) return; // was a drag, not a click
    // Only deselect if the click target is the canvas itself, not a label pill
    if (e.target.closest && e.target.closest('[data-map-label]')) return;
    onSelectProject(null);
  };

  return (
    <div
      style={{
        height: 450, borderRadius: 12, overflow: 'hidden', position: 'relative',
        background: `linear-gradient(180deg, ${sky.skyTop} 0%, ${sky.skyBot} 100%)`,
      }}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
    >
      {temperature != null && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            setUseCelsius(prev => {
              const next = !prev;
              localStorage.setItem('daylab:temp-unit', next ? 'C' : 'F');
              return next;
            });
          }}
          style={{
            position: 'absolute', top: 16, right: 18, zIndex: 10,
            fontFamily: mono, fontSize: 13,
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '0.04em',
            color: 'rgba(255,255,255,0.35)',
            cursor: 'pointer',
            userSelect: 'none',
          }}>
          {useCelsius ? `${Math.round((temperature - 32) * 5 / 9)}°C` : `${Math.round(temperature)}°F`}
        </div>
      )}
      {cityName && (
        <div style={{
          position: 'absolute', bottom: 16, left: 18, zIndex: 10,
          fontFamily: mono, fontSize: 12,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.35)',
          userSelect: 'none',
          pointerEvents: 'none',
        }}>
          {cityName}
        </div>
      )}
      {projects.length === 0 && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 10, pointerEvents: 'none',
        }}>
          <span style={{
            fontFamily: mono, fontSize: 13, letterSpacing: '0.06em',
            color: 'rgba(255,255,255,0.6)', textAlign: 'center',
            textTransform: 'lowercase', lineHeight: 1.6,
          }}>
            mountains grow as you tag tasks and<br/>journal entries with /p or #
          </span>
        </div>
      )}
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        dpr={[1, 1.5]}
        camera={{ position: [camDist * 0.66, camDist * 0.30, camDist * 0.66], fov: 30, near: 0.1, far: 100 }}
        style={{ width: '100%', height: '100%' }}
      >
        <Suspense fallback={null}>
          <Scene projects={projects} radius={radius} vitality={vitality} onSelect={onSelectProject}
            hovered={hovered} setHovered={setHovered} selectedProject={selectedProject} hour={hour}
            isDark={appDark || sky.isNight || sky.isDusk} />
        </Suspense>
        <fog attach="fog" args={[sky.fog, sky.fogNear, sky.fogFar]} />
      </Canvas>
    </div>
  );
}

