#!/usr/bin/env node
// diagnose-dots.js — run with: node scripts/diagnose-dots.js
// Audits your Supabase health data and scores to explain why dots look wrong.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_JWT=... node scripts/diagnose-dots.js
//
// SUPABASE_JWT = your user's JWT token (copy from browser DevTools → Network tab,
//   look at any /api/... request headers for "Authorization: Bearer <token>")

import { createClient } from '@supabase/supabase-js';
import { batchComputeScores } from '../lib/scoreCalc.js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const JWT         = process.env.SUPABASE_JWT;
const DAYS        = parseInt(process.env.DAYS || '30');

if (!SUPABASE_URL || !SUPABASE_KEY || !JWT) {
  console.error('Missing env vars. Set SUPABASE_URL, SUPABASE_ANON_KEY (or NEXT_PUBLIC_ versions), and SUPABASE_JWT');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  global: { headers: { Authorization: `Bearer ${JWT}` } }
});

const { data: { user } } = await supabase.auth.getUser();
if (!user) { console.error('Auth failed — check JWT'); process.exit(1); }
console.log(`\n✓ Authenticated as ${user.email} (${user.id.slice(0,8)}...)\n`);

const since = new Date();
since.setDate(since.getDate() - DAYS);
const sinceStr = since.toISOString().split('T')[0];

// ── 1. Load health entries ────────────────────────────────────────────────────
const { data: health } = await supabase.from('entries').select('date,data')
  .eq('user_id', user.id).eq('type', 'health').gte('date', sinceStr)
  .order('date', { ascending: true });

const { data: scores } = await supabase.from('entries').select('date,data')
  .eq('user_id', user.id).eq('type', 'scores').gte('date', sinceStr)
  .order('date', { ascending: true });

console.log(`Health entries (last ${DAYS}d): ${health?.length ?? 0}`);
console.log(`Score entries  (last ${DAYS}d): ${scores?.length ?? 0}\n`);

// ── 2. Fields present in health entries ──────────────────────────────────────
const fieldCounts = {};
for (const row of health ?? []) {
  for (const k of Object.keys(row.data ?? {})) {
    fieldCounts[k] = (fieldCounts[k] || 0) + 1;
  }
}
console.log('Health entry fields (count of days each field appears):');
for (const [k, v] of Object.entries(fieldCounts).sort((a,b)=>b[1]-a[1])) {
  const pct = Math.round(v / (health?.length || 1) * 100);
  console.log(`  ${k.padEnd(20)} ${v} days (${pct}%)`);
}
console.log();

// ── 3. Check for Oura score fields that should NOT be stored ─────────────────
const ouraScoreFields = ['sleepScore','readinessScore','activityScore'];
const contaminated = (health ?? []).filter(r =>
  ouraScoreFields.some(f => r.data?.[f] != null && r.data?.[f] !== '')
);
if (contaminated.length > 0) {
  console.log(`⚠️  ${contaminated.length} health entries still have Oura score fields (sleepScore/readinessScore/activityScore).`);
  console.log('   These are from before the fix and should be cleaned up.');
  console.log('   Run: node scripts/clean-oura-scores.js\n');
} else {
  console.log('✓  No Oura score fields in health entries.\n');
}

// ── 4. Compare stored scores vs freshly computed ──────────────────────────────
const byDate = {};
for (const row of health ?? []) {
  if (row.date && row.data) byDate[row.date] = row.data;
}

const fresh = batchComputeScores(byDate, health?.length ?? 0);
const freshMap = {};
for (const s of fresh) freshMap[s.date] = s;

const storedMap = {};
for (const row of scores ?? []) storedMap[row.date] = row.data;

let staleCount = 0, missingCount = 0, matchCount = 0;
const staleExamples = [];

for (const s of fresh) {
  const stored = storedMap[s.date];
  if (!stored) {
    missingCount++;
    continue;
  }
  const diff = [
    ['sleep',    s.sleepScore,     stored.sleepScore],
    ['readiness',s.readinessScore, stored.readinessScore],
    ['activity', s.activityScore,  stored.activityScore],
    ['recovery', s.recoveryScore,  stored.recoveryScore],
  ].filter(([,fresh,stored]) => fresh != null && stored != null && Math.abs(fresh - (stored ?? 0)) > 2);

  if (diff.length > 0) {
    staleCount++;
    if (staleExamples.length < 5) {
      staleExamples.push({ date: s.date, diffs: diff.map(([name,f,s])=>`${name}: stored=${s} fresh=${f}`) });
    }
  } else {
    matchCount++;
  }
}

console.log(`Score comparison (fresh recompute vs stored):`);
console.log(`  ✓ Match:   ${matchCount} dates`);
console.log(`  ⚠ Stale:  ${staleCount} dates (stored scores differ from freshly computed by >2pts)`);
console.log(`  ✗ Missing: ${missingCount} dates have health data but no stored scores\n`);

if (staleExamples.length > 0) {
  console.log('Sample stale dates:');
  for (const ex of staleExamples) {
    console.log(`  ${ex.date}: ${ex.diffs.join(', ')}`);
  }
  console.log();
}

// ── 5. Dot prediction (what calendar currently shows vs what it should) ───────
console.log('Calendar dot audit (last 14 days):');
console.log('  Date       | Stored dots    | Fresh dots     | Match?');
console.log('  -----------|----------------|----------------|-------');
const today = new Date().toISOString().split('T')[0];
for (let i = 13; i >= 0; i--) {
  const d = new Date(); d.setDate(d.getDate() - i);
  const dk = d.toISOString().split('T')[0];
  const stored = storedMap[dk];
  const fr = freshMap[dk];
  const storedDots = stored ? [
    stored.sleepScore    >= 85 ? '💙' : '·',
    stored.readinessScore>= 85 ? '💚' : '·',
    stored.activityScore >= 85 ? '🟠' : '·',
    stored.recoveryScore >= 85 ? '💜' : '·',
  ].join('') : '(no entry)  ';
  const freshDots = fr ? [
    fr.sleepScore    >= 85 ? '💙' : '·',
    fr.readinessScore>= 85 ? '💚' : '·',
    fr.activityScore >= 85 ? '🟠' : '·',
    fr.recoveryScore >= 85 ? '💜' : '·',
  ].join('') : '(no data)   ';
  const match = stored && fr &&
    (stored.sleepScore    >= 85) === (fr.sleepScore    >= 85) &&
    (stored.readinessScore>= 85) === (fr.readinessScore>= 85) &&
    (stored.activityScore >= 85) === (fr.activityScore >= 85) &&
    (stored.recoveryScore >= 85) === (fr.recoveryScore >= 85);
  console.log(`  ${dk} | ${storedDots.padEnd(14)} | ${freshDots.padEnd(14)} | ${stored&&fr ? (match?'✓':'⚠ MISMATCH') : '—'}`);
}

console.log('\n💡 Key: 💙=Sleep 💚=Readiness 🟠=Activity 💜=Recovery  · = score <85\n');

if (missingCount > 0 || staleCount > 0) {
  console.log('🔧 To fix: re-trigger Oura backfill from Settings → Oura → Disconnect → Connect');
  console.log('   Or run: node scripts/trigger-backfill.js\n');
}
