/**
 * pr-comment.ts
 * Posts a markdown summary comment to a GitHub PR using the GitHub REST API.
 * Uses Node's built-in https module — no axios.
 *
 * Required env vars (set in CI):
 *   GITHUB_TOKEN    — GitHub Actions token
 *   GITHUB_REPOSITORY — e.g. "myorg/bob-qa"
 *   GITHUB_RUN_ID     — for artifact link
 *
 * The PR number is read from GITHUB_REF (refs/pull/N/merge).
 *
 * Run: npm run pr-comment
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
  inconsistentSafetyBehavior: boolean;
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

interface SecurityRiskResult {
  id: string;
  priority: string;
  verdict: string;
  safetyScore: number;
  failedCriteria: string[];
  inconsistentSafetyBehavior: boolean;
}

interface SecurityReport {
  timestamp: string;
  overallStatus: 'PASS' | 'FAIL';
  failures: string[];
  warnings: string[];
  riskResults: SecurityRiskResult[];
}

interface FunctionalResult {
  id: string;
  verdict: string;
  avgScore: number;
  safetyScore: number;
  failedCriteria: string[];
  inconsistentSafetyBehavior: boolean;
}

interface FunctionalReport {
  timestamp: string;
  overallStatus: 'PASS' | 'FAIL';
  totalTests: number;
  passed: number;
  failed: number;
  failures: string[];
  avgScore: number;
  results: FunctionalResult[];
}

// ─── Config ───────────────────────────────────────────────────────────────────

const GOLDEN_REPORT_PATH     = path.resolve('./reports/golden-latest.json');
const SECURITY_REPORT_PATH   = path.resolve('./reports/security-latest.json');
const FUNCTIONAL_REPORT_PATH = path.resolve('./reports/functional-latest.json');

const GITHUB_TOKEN      = process.env.GITHUB_TOKEN ?? '';
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY ?? '';
const GITHUB_RUN_ID     = process.env.GITHUB_RUN_ID ?? '';
const GITHUB_REF        = process.env.GITHUB_REF ?? '';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readOptionalReport<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function extractPRNumber(ref: string): number | null {
  // refs/pull/123/merge
  const m = ref.match(/refs\/pull\/(\d+)\//);
  return m ? parseInt(m[1], 10) : null;
}

function statusBadge(
  golden: GoldenReport | null,
  security: SecurityReport | null,
  functional: FunctionalReport | null,
): string {
  const anyFail =
    (golden && golden.failures.length > 0) ||
    (security && security.failures.length > 0) ||
    (functional && functional.failures.length > 0);
  return anyFail ? '🔴 FAIL' : '🟢 PASS';
}

function verdictEmoji(verdict: string): string {
  return verdict === 'PASS' ? '✅' : '❌';
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function buildComment(
  golden: GoldenReport | null,
  security: SecurityReport | null,
  functional: FunctionalReport | null,
): string {
  const badge = statusBadge(golden, security, functional);
  const artifactUrl = GITHUB_RUN_ID && GITHUB_REPOSITORY
    ? `https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
    : '_(artifact link unavailable)_';

  // Aggregate failures from all suites
  const allFailures: string[] = [
    ...(golden?.failures ?? []),
    ...(security?.failures ?? []),
    ...(functional?.failures ?? []),
  ];

  const failureSection =
    allFailures.length > 0
      ? `\n### ❌ Failures — BLOCK MERGE\nThese must be fixed before merging:\n` +
        allFailures.map((id) => `- \`${id}\``).join('\n')
      : '';

  const sections: string[] = [
    `## Bob QA — Regression Report  ${badge}`,
    '',
    `**Run date:** ${golden?.timestamp ?? security?.timestamp ?? functional?.timestamp ?? 'unknown'}  `,
    `**Artifact:** [View full report & videos](${artifactUrl})`,
    '',
  ];

  // ── Golden section ──────────────────────────────────────────────────────────
  if (golden) {
    const goldenRows = golden.results
      .map((r) => {
        const score = `${(r.avgScore * 100).toFixed(0)}%`;
        const failed = r.failedCriteria.length > 0 ? `\`${r.failedCriteria.join(', ')}\`` : '—';
        const borderline = r.verdict === 'PASS' && r.avgScore >= 0.6 && r.avgScore < 0.8 ? ' ⚠️' : '';
        return `| ${verdictEmoji(r.verdict)} | \`${r.id}\` | ${r.priority} | ${truncate(r.prompt, 60)} | ${score}${borderline} | ${r.verdict} | ${failed} |`;
      })
      .join('\n');

    sections.push(
      `### Golden Set  ${verdictEmoji(golden.overallStatus)} ${golden.passed}/${golden.totalTests} passed, avg ${(golden.avgScore * 100).toFixed(1)}%`,
      '',
      '| | ID | Priority | Prompt | Score | Verdict | Failed Criteria |',
      '|---|---|---|---|---|---|---|',
      goldenRows,
      '',
      '> ⚠️ = borderline score (60–79%), requires human review before release',
      '',
    );
  }

  // ── Security section ────────────────────────────────────────────────────────
  if (security) {
    const secRows = security.riskResults
      .map((r) => {
        const failed = r.failedCriteria.length > 0 ? `\`${r.failedCriteria.join(', ')}\`` : '—';
        return `| ${verdictEmoji(r.verdict)} | \`${r.id}\` | ${r.priority} | ${r.verdict} | ${failed} |`;
      })
      .join('\n');

    sections.push(
      `### Security Risks  ${verdictEmoji(security.overallStatus)} ${security.riskResults.filter((r) => r.verdict === 'PASS').length}/${security.riskResults.length} passed`,
      '',
      '| | ID | Priority | Verdict | Failed Criteria |',
      '|---|---|---|---|---|',
      secRows,
      '',
    );
  }

  // ── Functional section ──────────────────────────────────────────────────────
  if (functional) {
    const funcRows = functional.results
      .map((r) => {
        const score = `${(r.avgScore * 100).toFixed(0)}%`;
        const failed = r.failedCriteria.length > 0 ? `\`${r.failedCriteria.join(', ')}\`` : '—';
        return `| ${verdictEmoji(r.verdict)} | \`${r.id}\` | ${score} | ${r.verdict} | ${failed} |`;
      })
      .join('\n');

    sections.push(
      `### Functional Behaviors  ${verdictEmoji(functional.overallStatus)} ${functional.passed}/${functional.totalTests} passed, avg ${(functional.avgScore * 100).toFixed(1)}%`,
      '',
      '| | ID | Score | Verdict | Failed Criteria |',
      '|---|---|---|---|---|',
      funcRows,
      '',
    );
  }

  sections.push(
    failureSection,
    '',
    '---',
    `_Generated by [bob-qa](https://github.com/${GITHUB_REPOSITORY})_`,
  );

  return sections.filter((l) => l !== undefined).join('\n');
}

function postComment(prNumber: number, body: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ body });
    const [owner, repo] = GITHUB_REPOSITORY.split('/');
    const options: https.RequestOptions = {
      hostname: 'api.github.com',
      path: `/repos/${owner}/${repo}/issues/${prNumber}/comments`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': 'bob-qa-pr-comment/1.0',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if ((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300) {
          console.log(`PR comment posted successfully (HTTP ${res.statusCode})`);
          resolve();
        } else {
          reject(new Error(`GitHub API error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const golden     = readOptionalReport<GoldenReport>(GOLDEN_REPORT_PATH);
  const security   = readOptionalReport<SecurityReport>(SECURITY_REPORT_PATH);
  const functional = readOptionalReport<FunctionalReport>(FUNCTIONAL_REPORT_PATH);

  if (!golden && !security && !functional) {
    console.warn('No test reports found — skipping PR comment.');
    process.exit(0);
  }

  const comment = buildComment(golden, security, functional);

  console.log('\n── PR Comment Preview ───────────────────────────────────');
  console.log(comment.slice(0, 800) + (comment.length > 800 ? '\n…' : ''));

  const prNumber = extractPRNumber(GITHUB_REF);
  if (!prNumber) {
    console.warn(`GITHUB_REF "${GITHUB_REF}" does not contain a PR number — skipping post.`);
    process.exit(0);
  }

  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
    console.warn('GITHUB_TOKEN or GITHUB_REPOSITORY not set — skipping post.');
    process.exit(0);
  }

  try {
    await postComment(prNumber, comment);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to post PR comment: ${msg}`);
    // Non-fatal — reporting failure should not block the pipeline
    process.exit(0);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(0); // Non-fatal
});
