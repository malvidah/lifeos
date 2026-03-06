#!/usr/bin/env node
// diagnose-dots.mjs — diagnose why health dots are wrong on the calendar
//
// HOW TO RUN:
//   1. Get your JWT: open daylab.me, DevTools → Network → any /api/ request → copy "Authorization: Bearer <TOKEN>"
//   2. Run:
//      SUPABASE_JWT="eyJ..." node scripts/diagnose-dots.mjs
//
// Optional: DAYS=60 to check more history (default 30)

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(__dir, '../.env.local'), 'utf8');
const getEnv = (key) => env.match(new RegExp(`${key}=(.+)`))?.[1]?.trim();

const URL  = getEnv('NEXT_PUBLIC_SUPABASE_URL');
const KEY  = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const JWT  = process.env.SUPABASE_JWT;
const DAYS = parseInt(process.env.DAYS || '30');

if (!URL || !KEY) { console.error('Could not read .env.local'); process.exit(1); }
if (!JWT)         { console.error('Set SUPABASE_JWT env var (copy from DevTools Network tab)'); process.exit(1); }

const sb = createClient(URL, KEY, { global: { headers: { Authorization: `Bearer ${JWT}` } } });
const { data: { user } } = await sb.auth.getUser();
if (!user) { console.error('Auth failed — JWT may be expired'); process.exit(1); }
console.log(`\n✓ Auth OK: ${user.email}\n`);

const since = new Date();
since.setDate(since.getDate() - DAYS);
const sinceStr = since.toISOString().split('T')[0];
const today    = new Date().toISOString().split('T')[0];

// ── Fetch ──────────────────────────────────────────────────────────────────
const [{ data: health }, { data: scores }] = await Promise.all([
  sb.from('entries').select('date,data').eq('user_id', user.id).eq('type', 'health').gte('date', sinceStr).order('date'),
  sb.from('entries').select('date,data').eq('user_id', user.id).eq('type', 'scores').gte('date', sinceStr).order('date'),
]);

console.log(`health entries: ${health?.length ?? 0}  |  score entries: ${scores?.length ?? 0}\n`);

// ── Check for lingering Oura score fields ─────────────────────────────────
const ouraFields = ['sleepScore','readinessScore','activityScore'];
const dirty = (health ?? []).filter(r => ouraFields.some(f => r.data?.[f]));
if (dirty.length) {
  console.log(`⚠️  ${dirty.length} health entries still have Oura score fields (should be 0 after fix):`);
  dirty.slice(0,5).forEach(r => {
    const found = ouraFields.filter(f => r.data?.[f]);
    console.log(`   ${r.date}: ${found.map(f=>`${f}=${r.data[f]}`).join(', ')}`);
  });
  console.log('   → Re-run Oura backfill from Settings to clean these up\n');
} else {
  console.log('✓ No Oura score fields in health entries\n');
}

// ── Per-date key fields ───────────────────────────────────────────────────
const healthMap = Object.fromEntries((health ?? []).map(r => [r.date, r.data]));
const scoreMap  = Object.fromEntries((scores ?? []).map(r => [r.date, r.data]));

// ── 14-day dot audit ──────────────────────────────────────────────────────
console.log('Calendar dot audit — last 14 days:');
console.log('  Date       | Raw health data?         | Stored scores              | Dots shown');
console.log('  -----------|--------------------------|----------------------------|-----------');

for (let i = 13; i >= 0; i--) {
  const d = new Date(); d.setDate(d.getDate() - i);
  const dk = d.toISOString().split('T')[0];
  const h = healthMap[dk];
  const s = scoreMap[dk];

  const rawFields = h ? [
    h.sleepHrs     ? `${h.sleepHrs}h` : null,
    h.hrv          ? `HRV${h.hrv}`    : null,
    h.steps        ? `${h.steps}steps`: null,
  ].filter(Boolean).join(' ') || '(no key fields)' : '— no entry —';

  const storedScores = s ? [
    s.sleepScore    != null ? `Sl=${s.sleepScore}`  : null,
    s.readinessScore!= null ? `Rd=${s.readinessScore}`:null,
    s.activityScore != null ? `Ac=${s.activityScore}`: null,
    s.recoveryScore != null ? `Rv=${s.recoveryScore}`: null,
  ].filter(Boolean).join(' ') || '(scores all null)' : '— no entry —';

  const dots = s ? [
    (s.sleepScore     >= 85) ? '💙' : '·',
    (s.readinessScore >= 85) ? '💚' : '·',
    (s.activityScore  >= 85) ? '🟠' : '·',
    (s.recoveryScore  >= 85) ? '💜' : '·',
  ].join('') : '????';

  const flag = (!s && h) ? ' ← MISSING SCORES' : '';
  console.log(`  ${dk} | ${rawFields.padEnd(24)} | ${storedScores.padEnd(26)} | ${dots}${flag}`);
}

// ── Summary ───────────────────────────────────────────────────────────────
const datesWithHealthButNoScores = (health ?? []).filter(r => !scoreMap[r.date]).map(r=>r.date);
if (datesWithHealthButNoScores.length) {
  console.log(`\n⚠️  ${datesWithHealthButNoScores.length} dates have health data but NO score entry:`);
  console.log('   First few:', datesWithHealthButNoScores.slice(0,8).join(', '));
  console.log('   → Trigger Oura backfill from Settings to compute scores for these dates\n');
} else {
  console.log('\n✓ All health dates have corresponding score entries\n');
}

console.log('KEY: 💙=Sleep≥85  💚=Readiness≥85  🟠=Activity≥85  💜=Recovery≥85  ·=<85  ????=no score entry\n');
