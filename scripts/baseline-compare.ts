/**
 * baseline-compare.ts
 * Compares the latest golden results against the stored baseline.
 * Detects regressions (previously passing tests that now fail) and
 * improvements (previously failing tests that now pass).
 *
 * Run: npm run baseline-compare
 * Non-blocking — logs findings but does not exit(1).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

// ─── Types ────────────────────────────────────────────────────────────────────

interface BaselineEntry {
  id: string;
  verdict: string;
  avgScore: number;
}

interface BaselineFile {
  timestamp: string;
  avgScore: number;
  results: BaselineEntry[];
}

interface GoldenResult {
  id: string;
  verdict: string;
  avgScore: number;
  priority: string;
}

interface GoldenReport {
  timestamp: string;
  avgScore: number;
  results: GoldenResult[];
}

// ─── Paths ────────────────────────────────────────────────────────────────────

const REPORT_PATH = path.resolve('./reports/golden-latest.json');
const BASELINE_PATH = path.resolve(
  process.env.BASELINE_SCORE_PATH ?? './baselines/latest.json'
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJSON<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const latest = readJSON<GoldenReport>(REPORT_PATH);
const baseline = readJSON<BaselineFile>(BASELINE_PATH);

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║           BOB QA — BASELINE COMPARISON              ║');
console.log('╚══════════════════════════════════════════════════════╝');

if (!latest) {
  console.warn('  No latest report found — skipping baseline comparison.');
  console.warn(`  Expected: ${REPORT_PATH}`);
  process.exit(0);
}

if (!baseline) {
  console.warn('  No baseline found — this run will become the first baseline.');
  console.warn(`  Expected: ${BASELINE_PATH}`);
  process.exit(0);
}

console.log(`\nBaseline date : ${baseline.timestamp}`);
console.log(`Latest date   : ${latest.timestamp}`);
console.log(
  `Score delta   : ${(baseline.avgScore * 100).toFixed(1)}% → ${(latest.avgScore * 100).toFixed(1)}% ` +
  `(${((latest.avgScore - baseline.avgScore) * 100) >= 0 ? '+' : ''}${((latest.avgScore - baseline.avgScore) * 100).toFixed(1)}%)`
);

const baselineMap = new Map<string, BaselineEntry>(
  baseline.results.map((r) => [r.id, r])
);

const regressions: string[] = [];
const improvements: string[] = [];
const scoreDrops: string[] = [];

for (const current of latest.results) {
  const prev = baselineMap.get(current.id);
  if (!prev) {
    console.log(`  ℹ NEW test [${current.id}] — no baseline entry`);
    continue;
  }

  // Verdict flip: PASS → FAIL
  if (prev.verdict === 'PASS' && current.verdict === 'FAIL') {
    const entry = `[${current.id}] PASS → FAIL (score: ${(prev.avgScore * 100).toFixed(1)}% → ${(current.avgScore * 100).toFixed(1)}%)`;
    regressions.push(entry);
  }

  // Verdict flip: FAIL → PASS (improvement)
  if (prev.verdict === 'FAIL' && current.verdict === 'PASS') {
    const entry = `[${current.id}] FAIL → PASS (score: ${(prev.avgScore * 100).toFixed(1)}% → ${(current.avgScore * 100).toFixed(1)}%)`;
    improvements.push(entry);
  }

  // Score drop ≥ 10pp even without verdict flip
  const drop = prev.avgScore - current.avgScore;
  if (drop >= 0.1 && current.verdict === prev.verdict) {
    scoreDrops.push(
      `[${current.id}] score dropped ${(drop * 100).toFixed(1)}pp ` +
      `(${(prev.avgScore * 100).toFixed(1)}% → ${(current.avgScore * 100).toFixed(1)}%)`
    );
  }
}

console.log('\n── Regressions (PASS → FAIL) ────────────────────────────');
if (regressions.length === 0) {
  console.log('  ✓ None');
} else {
  for (const r of regressions) console.error(`  ✗ ${r}`);
}

console.log('── Improvements (FAIL → PASS) ───────────────────────────');
if (improvements.length === 0) {
  console.log('  — None');
} else {
  for (const i of improvements) console.log(`  ↑ ${i}`);
}

console.log('── Score drops ≥ 10pp ───────────────────────────────────');
if (scoreDrops.length === 0) {
  console.log('  ✓ None');
} else {
  for (const d of scoreDrops) console.warn(`  ⚠ ${d}`);
}

console.log('\n── Recommendation ───────────────────────────────────────');
if (regressions.length > 0) {
  console.warn(
    '\n  ⚠ Regressions detected. Investigate before merging.\n' +
    '  To accept new baseline after intentional changes: delete baselines/latest.json\n' +
    '  and re-run the golden suite.\n'
  );
} else {
  console.log('\n  ✓ No regressions detected\n');
}

process.exit(0);
