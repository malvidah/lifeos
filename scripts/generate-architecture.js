#!/usr/bin/env node
/**
 * generate-architecture.js
 *
 * Scans the codebase to produce public/architecture.json
 * Run automatically via `npm run prebuild`, or manually: node scripts/generate-architecture.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const API_DIR = path.join(ROOT, 'app', 'api');
const COMPONENTS_DIR = path.join(ROOT, 'components');
const PKG_PATH = path.join(ROOT, 'package.json');
const OUT_PATH = path.join(ROOT, 'public', 'architecture.json');

// ── Helpers ─────────────────────────────────────────────────────────────────
function globRoutes(dir, base = '') {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip _lib and other underscore-prefixed dirs
      if (entry.name.startsWith('_')) continue;
      results.push(...globRoutes(full, base + '/' + entry.name));
    } else if (entry.name === 'route.js' || entry.name === 'route.ts') {
      results.push({ routePath: '/api' + base, filePath: full });
    }
  }
  return results;
}

function readFile(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

function globFiles(dir, ext, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      globFiles(full, ext, results);
    } else if (ext.some(e => entry.name.endsWith(e))) {
      results.push(full);
    }
  }
  return results;
}

// ── 1. Scan API routes ──────────────────────────────────────────────────────
const routes = globRoutes(API_DIR);
const apiRoutes = routes.map(({ routePath, filePath }) => {
  const src = readFile(filePath);

  // Extract HTTP methods
  const methodRe = /export\s+const\s+(GET|POST|PATCH|PUT|DELETE)\b/g;
  const methods = [];
  let m;
  while ((m = methodRe.exec(src)) !== null) methods.push(m[1]);

  // Detect external services used
  const services = [];
  if (/supabase|\.from\(/.test(src)) services.push('supabase');
  if (/anthropic|ANTHROPIC/i.test(src)) services.push('anthropic');
  if (/groq|GROQ/i.test(src)) services.push('groq');
  if (/openai|OPENAI/i.test(src) && !/admin\/status/.test(filePath)) services.push('openai');
  if (/googleapis\.com\/calendar|google.*calendar/i.test(src)) services.push('google');

  // Extract Supabase table names
  const tableRe = /\.from\(\s*['"]([a-z_]+)['"]\s*\)/g;
  const tables = new Set();
  let tm;
  while ((tm = tableRe.exec(src)) !== null) tables.add(tm[1]);

  return {
    path: routePath,
    methods,
    services: [...new Set(services)],
    tables: [...tables].sort(),
  };
}).sort((a, b) => a.path.localeCompare(b.path));

// ── 2. Aggregate service usage ──────────────────────────────────────────────
const serviceMap = {};
for (const route of apiRoutes) {
  for (const svc of route.services) {
    if (!serviceMap[svc]) serviceMap[svc] = { usedBy: [], tables: new Set() };
    serviceMap[svc].usedBy.push(route.path);
    if (svc === 'supabase') {
      for (const t of route.tables) serviceMap[svc].tables.add(t);
    }
  }
}

// Build services object
const services = {};
if (serviceMap.supabase) {
  services.supabase = {
    tables: [...serviceMap.supabase.tables].sort(),
    features: ['auth', 'rls', 'realtime'],
    usedBy: serviceMap.supabase.usedBy,
  };
}
if (serviceMap.anthropic) {
  services.anthropic = {
    model: 'claude-haiku-4-5',
    usedBy: serviceMap.anthropic.usedBy,
  };
}
if (serviceMap.groq) {
  services.groq = {
    model: 'whisper-large-v3',
    usedBy: serviceMap.groq.usedBy,
  };
}
if (serviceMap.openai) {
  services.openai = {
    model: 'tts-1',
    usedBy: serviceMap.openai.usedBy,
  };
}
if (serviceMap.google) {
  services.google = {
    usedBy: serviceMap.google.usedBy,
  };
}

// ── 3. Scan package.json dependencies ───────────────────────────────────────
const pkg = JSON.parse(readFile(PKG_PATH));
const deps = Object.keys(pkg.dependencies || {});

const categories = {
  editor: deps.filter(d => d.startsWith('@tiptap/')),
  '3d': deps.filter(d => d === 'three' || d.startsWith('@react-three/') || d === 'postprocessing'),
  'auth_db': deps.filter(d => d.startsWith('@supabase/')),
  ui: deps.filter(d => ['react', 'react-dom', 'next'].includes(d)),
  maps: deps.filter(d => ['leaflet', 'react-leaflet', 'topojson-client'].includes(d)),
  state: deps.filter(d => ['zustand', 'immer'].includes(d)),
  dnd: deps.filter(d => d.startsWith('@dnd-kit/')),
  payments: deps.filter(d => d.includes('stripe')),
};

// ── 4. Scan client features ─────────────────────────────────────────────────
const clientFiles = globFiles(COMPONENTS_DIR, ['.jsx', '.js', '.tsx', '.ts']);
const clientFeatures = new Set();
for (const f of clientFiles) {
  const src = readFile(f);
  if (/SpeechRecognition|webkitSpeechRecognition/.test(src)) clientFeatures.add('Web Speech API');
  if (/MediaRecorder/.test(src)) clientFeatures.add('MediaRecorder');
  if (/supabase.*realtime|\.channel\(|\.on\(\s*['"]postgres_changes/.test(src)) clientFeatures.add('Supabase Realtime');
  if (/useEditor|@tiptap/.test(src)) clientFeatures.add('Tiptap Editor');
  if (/three|@react-three/.test(src)) clientFeatures.add('Three.js / R3F');
  if (/leaflet|react-leaflet/.test(src)) clientFeatures.add('Leaflet Maps');
}

// Determine Next.js version
const nextVersion = pkg.dependencies?.next || 'unknown';

// ── 5. Collect data types ───────────────────────────────────────────────────
const allTables = services.supabase?.tables || [];
const dataCollected = [];
if (allTables.includes('journal_blocks') || allTables.includes('entries')) dataCollected.push('journal entries');
if (allTables.includes('tasks')) dataCollected.push('tasks');
if (allTables.includes('meal_items') || allTables.includes('meals')) dataCollected.push('meals');
if (allTables.includes('workouts')) dataCollected.push('workouts');
if (allTables.includes('health_metrics') || allTables.includes('health_scores')) dataCollected.push('health metrics');
if (allTables.includes('goals')) dataCollected.push('goals');
if (allTables.includes('habits')) dataCollected.push('habits');
if (allTables.includes('notes')) dataCollected.push('notes');
if (allTables.includes('places') || allTables.includes('location_history')) dataCollected.push('location');
if (clientFeatures.has('MediaRecorder') || clientFeatures.has('Web Speech API')) dataCollected.push('voice audio');

// ── Output ──────────────────────────────────────────────────────────────────
const manifest = {
  generatedAt: new Date().toISOString(),
  client: {
    framework: `Next.js ${nextVersion.replace('^', '')} (App Router)`,
    libraries: deps.filter(d => !d.startsWith('@types/')).sort(),
    libraryCategories: categories,
    features: [...clientFeatures].sort(),
  },
  apiRoutes,
  services,
  dataCollected,
};

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(manifest, null, 2));

const routeCount = apiRoutes.length;
const tableCount = services.supabase?.tables?.length || 0;
const svcCount = Object.keys(services).length;
console.log(`[architecture] Generated: ${routeCount} routes, ${tableCount} tables, ${svcCount} services → public/architecture.json`);
