"use client";
import { useState, useEffect, useRef, useMemo, useCallback, Suspense } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import { createNoise2D } from "simplex-noise";
import * as THREE from "three";
import { mono, F, projectColor } from "@/lib/tokens";
import { tagDisplayName } from "@/lib/tags";

// ── Project layout — same clustering logic ───────────────────────────────────
function layoutProjects(tags, connections, recency) {
  if (!tags.length) return [];
  const connWeight = {};
  tags.forEach(t => { connWeight[t] = 0; });
  (connections || []).forEach(({ source, target, weight }) => {
    if (connWeight[source] != null) connWeight[source] += weight;
    if (connWeight[target] != null) connWeight[target] += weight;
  });

  // Place on a 2D grid: most connected at center, spread outward
  const sorted = [...tags].sort((a, b) => (connWeight[b] || 0) - (connWeight[a] || 0));
  const placed = new Map();
  sorted.forEach((tag, i) => {
    const angle = (i / sorted.length) * Math.PI * 2 + Math.PI / 4;
    const radius = i === 0 ? 0 : 1.5 + (i / sorted.length) * 3;
    placed.set(tag, { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
  });

  // Pull connected tags closer
  for (let iter = 0; iter < 8; iter++) {
    (connections || []).forEach(({ source, target, weight }) => {
      const a = placed.get(source);
      const b = placed.get(target);
      if (!a || !b) return;
      const dx = b.x - a.x, dz = b.z - a.z;
      const pull = 0.03 * Math.min(weight, 5);
      a.x += dx * pull; a.z += dz * pull;
      b.x -= dx * pull; b.z -= dz * pull;
    });
  }

  const maxConn = Math.max(1, ...Object.values(connWeight));
  return tags.map(tag => {
    const pos = placed.get(tag) || { x: 0, z: 0 };
    const score = (connWeight[tag] || 0) / maxConn;
    const height = 0.8 + score * 2.5; // peak height
    const color = projectColor(tag);
    const label = tagDisplayName(tag);
    const recent = recency?.[tag];
    const isActive = recent && (Date.now() - new Date(recent).getTime()) < 7 * 86400000;
    return { tag, x: pos.x, z: pos.z, height, color, label, isActive, score };
  });
}

// ── Terrain Mesh — low poly cross-section diorama ────────────────────────────
function TerrainMesh({ projects }) {
  const meshRef = useRef();
  const geo = useMemo(() => {
    const SIZE = 10;
    const SEG = 64;
    const noise2D = createNoise2D();
    const geometry = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geometry.rotateX(-Math.PI / 2);

    const pos = geometry.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);

      // Base terrain noise
      let h = noise2D(x * 0.3, z * 0.3) * 0.4
            + noise2D(x * 0.7, z * 0.7) * 0.2
            + noise2D(x * 1.5, z * 1.5) * 0.08;

      // Add peaks for each project
      for (const p of projects) {
        const dx = x - p.x, dz = z - p.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const radius = 0.8 + p.score * 0.6;
        if (dist < radius * 2) {
          const falloff = Math.max(0, 1 - dist / (radius * 2));
          h += p.height * falloff * falloff; // quadratic falloff
        }
      }

      pos.setY(i, h);

      // Altitude-based vertex colors (Cairn earth tones)
      const t = Math.max(0, Math.min(1, (h + 0.5) / 3));
      let r, g, b;
      if (t < 0.2) {
        // Valley: dark green-brown
        r = 0.28 + t * 0.5; g = 0.32 + t * 0.3; b = 0.2 + t * 0.15;
      } else if (t < 0.5) {
        // Mid: warm brown
        r = 0.45 + t * 0.4; g = 0.35 + t * 0.25; b = 0.22 + t * 0.1;
      } else if (t < 0.8) {
        // High: rocky grey-brown
        r = 0.55 + t * 0.2; g = 0.48 + t * 0.15; b = 0.38 + t * 0.1;
      } else {
        // Peak: snow white tint
        r = 0.7 + t * 0.3; g = 0.68 + t * 0.3; b = 0.65 + t * 0.3;
      }
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return geometry;
  }, [projects]);

  return (
    <mesh ref={meshRef} geometry={geo} receiveShadow castShadow>
      <meshStandardMaterial
        vertexColors
        flatShading
        roughness={0.9}
        metalness={0.05}
      />
    </mesh>
  );
}

// ── Cross-section sides (earth layers) ───────────────────────────────────────
function TerrainSides() {
  const depth = 1.5;
  const size = 10;
  return (
    <group>
      {/* Bottom */}
      <mesh position={[0, -depth, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[size, size]} />
        <meshStandardMaterial color="#3D2B1F" roughness={1} />
      </mesh>
      {/* Front side */}
      <mesh position={[0, -depth / 2, size / 2]}>
        <planeGeometry args={[size, depth]} />
        <meshStandardMaterial color="#5C3D2E" roughness={1} />
      </mesh>
      {/* Right side */}
      <mesh position={[size / 2, -depth / 2, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[size, depth]} />
        <meshStandardMaterial color="#4A3328" roughness={1} />
      </mesh>
      {/* Back side */}
      <mesh position={[0, -depth / 2, -size / 2]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[size, depth]} />
        <meshStandardMaterial color="#5C3D2E" roughness={1} />
      </mesh>
      {/* Left side */}
      <mesh position={[-size / 2, -depth / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[size, depth]} />
        <meshStandardMaterial color="#4A3328" roughness={1} />
      </mesh>
    </group>
  );
}

// ── Project Labels (HTML overlays) ───────────────────────────────────────────
function ProjectLabels({ projects, onSelect, hovered, setHovered }) {
  return (
    <>
      {projects.map(p => (
        <Html key={p.tag}
          position={[p.x, p.height + 0.6, p.z]}
          center
          style={{ pointerEvents: 'auto' }}
        >
          <div
            onClick={() => onSelect(p.tag)}
            onMouseEnter={() => setHovered(p.tag)}
            onMouseLeave={() => setHovered(null)}
            style={{
              background: hovered === p.tag ? p.color : 'var(--dl-card, #1a1a1a)',
              border: `1px solid ${p.color}${hovered === p.tag ? '' : '55'}`,
              borderRadius: 100, padding: '3px 12px',
              fontFamily: mono, fontSize: 11, letterSpacing: '0.06em',
              textTransform: 'uppercase', whiteSpace: 'nowrap',
              color: hovered === p.tag ? '#fff' : p.color,
              cursor: 'pointer',
              fontWeight: hovered === p.tag ? 600 : 400,
              boxShadow: hovered === p.tag ? `0 2px 12px ${p.color}44` : 'none',
              transition: 'all 0.15s',
              userSelect: 'none',
            }}
          >
            {p.isActive && (
              <span style={{
                display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
                background: p.color, marginRight: 6, verticalAlign: 'middle',
                opacity: hovered === p.tag ? 1 : 0.6,
              }} />
            )}
            {p.label.toUpperCase()}
          </div>
        </Html>
      ))}
    </>
  );
}

// ── Scene content ────────────────────────────────────────────────────────────
function Scene({ projects, onSelect, hovered, setHovered }) {
  return (
    <>
      {/* Lighting — warm directional + ambient */}
      <ambientLight intensity={0.4} color="#D4C0A0" />
      <directionalLight
        position={[6, 8, 4]}
        intensity={1.2}
        color="#FFE4C0"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[-4, 3, -2]} intensity={0.3} color="#8090B0" />

      {/* Terrain */}
      <TerrainMesh projects={projects} />
      <TerrainSides />

      {/* Labels */}
      <ProjectLabels projects={projects} onSelect={onSelect} hovered={hovered} setHovered={setHovered} />

      {/* Controls */}
      <OrbitControls
        enablePan
        enableZoom
        enableRotate
        minDistance={4}
        maxDistance={18}
        maxPolarAngle={Math.PI / 2.2}
        minPolarAngle={Math.PI / 6}
        target={[0, 0, 0]}
      />
    </>
  );
}

// ── MapCard export ───────────────────────────────────────────────────────────
export function MapCard({ allTags, connections, recency, onSelectProject }) {
  const [hovered, setHovered] = useState(null);

  const projects = useMemo(
    () => layoutProjects(allTags || [], connections, recency),
    [allTags, connections, recency]
  );

  if (!projects.length) {
    return (
      <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: mono, fontSize: F.sm, color: "var(--dl-middle)" }}>
        No projects yet
      </div>
    );
  }

  return (
    <div style={{
      height: 400, borderRadius: 12, overflow: 'hidden',
      background: 'linear-gradient(180deg, #C4B8A4 0%, #A89880 100%)',
    }}>
      <Canvas
        shadows
        camera={{
          position: [8, 7, 8],
          fov: 35,
          near: 0.1,
          far: 100,
        }}
        style={{ width: '100%', height: '100%' }}
      >
        <Suspense fallback={null}>
          <Scene
            projects={projects}
            onSelect={onSelectProject}
            hovered={hovered}
            setHovered={setHovered}
          />
        </Suspense>
        <fog attach="fog" args={['#C4B8A4', 12, 25]} />
      </Canvas>
    </div>
  );
}

// ── MountainBackground (kept for backward compat, now renders nothing) ───────
export function MountainBackground() {
  return null;
}
