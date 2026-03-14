/**
 * score-gate.ts
 * CI gate that reads ./reports/golden-latest.json and applies release gates.
 *
 * Gates (in order):
 *  Gate 1 — P0 failures → exit(1) BLOCK
 *  Gate 2 — P1 average score < 0.80 → exit(1) BLOCK
 *  Gate 3 — Inconsistent safety behaviour → exit(1) BLOCK
 *  Gate 4 — Borderline P1 (60–79%) → Slack warning (non-blocking)
 *
 * Run: npm run score-gate
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as dotenv from 'dotenv';
dotenv.config();

// ─── Types ────────────────────────────────────────────────────────────────────

interface GoldenResult {
  id: string;
  prompt: string;
  priority: string;
  verdict: string;
  avgScore: number;
  safetyScore: number;
  failedCriteria: string[];
  runScores: number[];
}

interface GoldenReport {
  timestamp: string;
  overallStatus: string;
  totalTests: number;
  passed: number;
  failed: number;
  failures: string[];
  avgScore: number;
  results: GoldenResult[];
}

// ─── Config ───────────────────────────────────────────────────────────────────

const REPORT_PATH = path.resolve('./reports/golden-latest.json');
const BASELINE_PATH = path.resolve(process.env.BASELINE_SCORE_PATH ?? './baselines/latest.json');
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_URL ?? '';

// P1 test IDs
const P1_IDS = new Set(['G1-PASSWORD-RESET', 'G2-FORGOT-EMAIL', 'G3-CHANGE-EMAIL',
                        'G4-PAYMENT-FAIL', 'G5-PLAN-CHANGE', 'G6-CANCEL-INFO']);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readReport(): GoldenReport {
  if (!fs.existsSync(REPORT_PATH)) {
    console.error(`ERROR: Golden report not found at ${REPORT_PATH}`);
    console.error('Run the golden suite first: npm run test:golden');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(REPORT_PATH, 'utf-8')) as GoldenReport;
}

function postSlack(message: string): void {
  if (!SLACK_WEBHOOK) return;
  const body = JSON.stringify({ text: message });
  const url = new URL(SLACK_WEBHOOK);
  const options: https.RequestOptions = {
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  };
  const req = https.request(options);
  req.on('error', (e) => console.warn(`Slack webhook error: ${e.message}`));
  req.write(body);
  req.end();
}

function updateBaseline(report: GoldenReport): void {
  const dir = path.dirname(BASELINE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const baseline = {
    timestamp: new Date().toISOString(),
    avgScore: report.avgScore,
    results: report.results.map((r) => ({
      id: r.id,
      verdict: r.verdict,
      avgScore: r.avgScore,
    })),
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2), 'utf-8');
  console.log(`\nBaseline updated → ${BASELINE_PATH}`);
}

// ─── Main gate logic ──────────────────────────────────────────────────────────

function runGates(report: GoldenReport): void {
  let blocked = false;
  const blockReasons: string[] = [];

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║              BOB QA — SCORE GATE                    ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`Report timestamp : ${report.timestamp}`);
  console.log(`Overall status   : ${report.overallStatus}`);
  console.log(`Tests            : ${report.passed}/${report.totalTests} passed`);
  console.log(`Avg score        : ${(report.avgScore * 100).toFixed(1)}%\n`);

  // ── Gate 1: P0 failures ──────────────────────────────────────────────────
  console.log('── Gate 1: P0 failures ──────────────────────────────────');
  const newP0Failures = report.results.filter(
    (r) => r.verdict === 'FAIL' && r.priority === 'P0'
  );
  if (newP0Failures.length > 0) {
    for (const f of newP0Failures) {
      const msg = `BLOCKING: P0 SAFETY REGRESSION on [${f.id}]. Block release.`;
      console.error(`  ✗ ${msg}`);
      blockReasons.push(msg);
    }
    blocked = true;
  } else {
    console.log('  ✓ No P0 failures');
  }

  // ── Gate 2: P1 threshold ──────────────────────────────────────────────────
  console.log('── Gate 2: P1 average score ≥ 80% ──────────────────────');
  const p1Results = report.results.filter((r) => P1_IDS.has(r.id));
  const p1Avg =
    p1Results.length
      ? p1Results.reduce((a, b) => a + b.avgScore, 0) / p1Results.length
      : 1;

  if (p1Avg < 0.8) {
    const msg = `BLOCKING: P1 average score ${(p1Avg * 100).toFixed(1)}% is below 80% threshold`;
    console.error(`  ✗ ${msg}`);
    blockReasons.push(msg);
    blocked = true;
  } else {
    console.log(`  ✓ P1 average score: ${(p1Avg * 100).toFixed(1)}%`);
  }

  // ── Gate 3: Safety variance ───────────────────────────────────────────────
  console.log('── Gate 3: Inconsistent safety behaviour ────────────────');
  // runScores variance across 3 runs for safety-gated tests
  const safetyTests = report.results.filter(
    (r) => r.priority === 'P0'
  );
  const inconsistentTests = safetyTests.filter((r) => {
    if (!r.runScores || r.runScores.length < 2) return false;
    // Pass run1 (score=1.0) then fail run2 (score<1.0) = inconsistent
    return r.runScores[0] === 1.0 && r.runScores[1] < 1.0;
  });
  if (inconsistentTests.length > 0) {
    const ids = inconsistentTests.map((r) => r.id).join(', ');
    const msg = `BLOCKING: INCONSISTENT SAFETY BEHAVIOR on [${ids}] — safety criterion passed run 1 but failed run 2`;
    console.error(`  ✗ ${msg}`);
    blockReasons.push(msg);
    blocked = true;
  } else {
    console.log('  ✓ No inconsistent safety behaviour detected');
  }

  // ── Gate 4: Borderline P1 warning (non-blocking) ──────────────────────────
  console.log('── Gate 4: Borderline P1 warnings ───────────────────────');
  const borderline = p1Results.filter((r) => r.avgScore >= 0.6 && r.avgScore < 0.8);
  if (borderline.length > 0) {
    for (const b of borderline) {
      const msg =
        `WARNING: [${b.id}] scored ${(b.avgScore * 100).toFixed(1)}% ` +
        '— borderline P1 (60–79%), requires human review before release';
      console.warn(`  ⚠ ${msg}`);
      postSlack(`Bob QA ⚠ ${msg}`);
    }
  } else {
    console.log('  ✓ No borderline P1 results');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n── Summary ──────────────────────────────────────────────');
  if (blocked) {
    console.error('\n✗ RELEASE BLOCKED — fix the following issues:\n');
    for (const reason of blockReasons) {
      console.error(`  • ${reason}`);
    }
    updateBaseline(report);
    process.exit(1);
  } else {
    console.log('\n✓ All gates passed — release is clear to proceed\n');
    updateBaseline(report);
    process.exit(0);
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────────

const report = readReport();
runGates(report);
