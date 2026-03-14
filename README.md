# bob-qa

Automated test framework for **Bob** — the PDQ Custom GPT customer support chatbot.

---

## 1. Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 20+ |
| ChatGPT account with access to Bob | For session setup |
| Anthropic API key (Claude Haiku) | For LLM judge |

> **Architecture note:** Bob is a Custom GPT hosted on ChatGPT — **no REST API exists**.
> All tests drive the real ChatGPT web UI using Playwright browser automation with a saved session.
> Migrating Bob to the OpenAI Assistants API would enable programmatic access and is recommended as a future follow-up.

---

## 2. First-time setup

### Step 1 — Install dependencies

```bash
npm install
npx playwright install chromium
```

### Step 2 — Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```
BOB_URL=https://chatgpt.com/g/g-REPLACE_WITH_REAL_ID-bob
CHATGPT_SESSION=./fixtures/chatgpt-session.json
JUDGE_API_KEY=sk-ant-api03-REPLACE_WITH_REAL_KEY
JUDGE_MODEL=claude-haiku-4-5-20251001
BASELINE_SCORE_PATH=./baselines/latest.json
SLACK_WEBHOOK_URL=   # optional
```

### Step 3 — Save your ChatGPT session

```bash
npm run save-session
```

This opens a real Chrome window (not Playwright's Chromium — this avoids bot detection). Log in to chatgpt.com, then press **Enter** in the terminal. The session is saved to `fixtures/chatgpt-session.json`.

Alternatively, export cookies from chatgpt.com using the **Cookie-Editor** browser extension (Export → Export as JSON), save to `fixtures/chatgpt-session.json`, then run:

```bash
npm run convert-session
```

> Sessions typically last 7–30 days. Re-run when tests fail with a session expiry error.

---

## 3. Running tests locally

> Always use `--workers=1`. ChatGPT rate-limits concurrent sessions and the UI behaves unpredictably with parallel browsers.

```bash
# All suites (slow — ~1.5 hrs for 3×3 runs each)
npm test

# Individual suites
npm run test:functional    # Behaviors A–E
npm run test:security      # Risks 1–8 + 2b, 9 tests (P0)
npm run test:golden        # G1–G10 golden set

# Score gate (reads ./reports/golden-latest.json)
npm run score-gate

# Baseline comparison
npm run baseline-compare
```

### Viewing reports

After a run, Playwright generates:
- `test-results/html-report-<timestamp>/index.html` — full Playwright HTML report (one folder per run)
- `reports/golden-latest.json` — structured golden set results
- `reports/security-latest.json` — structured security test results

---

## 4. Session expiry — detection and refresh

`askBob()` detects session expiry mid-run (login redirect or Cloudflare challenge) and throws a clear error. Re-run `npm run save-session` to capture a fresh session.

---

## 6. Architecture

```
Bob (Custom GPT at chatgpt.com/g/...)
        │
        │  Playwright browser automation
        │  (storageState session — no REST API)
        ▼
  ChatGPT Web UI
        │
        │  innerText extraction
        ▼
  fixtures/test-data.ts
  ├── askBob()              — drives browser, returns response string
  ├── checkCriteria()       — Layer 1: regex | Layer 2: Claude Haiku judge
  └── runWithVarianceRules()— 3-run variance logic, P0/P1 gating
        │
        ▼
  Test suites (Playwright Test)
  ├── tests/functional/behaviors.spec.ts   — Behaviors A–E (P1)
  ├── tests/security/risks.spec.ts         — Risks 1–8 + 2b, 9 tests (P0)
  └── tests/golden/golden-set.spec.ts      — G1–G10 golden set
        │
        ▼
  reports/golden-latest.json
        │
        ▼
  scripts/score-gate.ts    — CI release gates
  scripts/baseline-compare.ts — regression detection
  scripts/pr-comment.ts    — GitHub PR markdown comment
```

**Why Playwright and not the OpenAI API?**
Custom GPTs do not expose a REST endpoint. The Assistants API and the `/v1/chat/completions` endpoint only access base models — they cannot call your Custom GPT's system prompt or knowledge base. Playwright is currently the only reliable way to test a Custom GPT programmatically.

**LLM judge:** Claude Haiku (`claude-haiku-4-5-20251001`) via `@anthropic-ai/sdk`. Used only for purely descriptive criteria; deterministic `mustInclude`/`mustNotInclude` regex checks run first with no API cost.

---

## 7. CI gate logic

| Gate | Condition | Action |
|---|---|---|
| Gate 1 | P0 failure | `exit(1)` — **block release** |
| Gate 2 | P1 average score < 80% | `exit(1)` — **block release** |
| Gate 3 | Safety criterion passes run 1 but fails run 2 | `exit(1)` — **block release** |
| Gate 4 | P1 score 60–79% (borderline) | Slack warning + log — non-blocking |

---

## 8. Updating baselines after intentional Bob changes

When Bob's system prompt is intentionally updated (new features, policy changes):

```bash
# 1. Run the full golden suite against the updated Bob
npm run test:golden

# 2. Review results — confirm changes are intentional
cat reports/golden-latest.json

# 3. Reset the baseline (this makes the current results the new reference point)
rm baselines/latest.json

# 4. Run score-gate — it will write a fresh baseline
npm run score-gate
```

Future runs will now compare against the new baseline. Commit `baselines/latest.json` to track the score history in version control.

---

## GitHub CI secrets required

| Secret | Description |
|---|---|
| `BOB_URL` | Full Custom GPT URL: `https://chatgpt.com/g/g-XXXX-bob` |
| `CHATGPT_SESSION_JSON` | Contents of `fixtures/chatgpt-session.json` (generated by `npm run save-session`) |
| `JUDGE_API_KEY` | Anthropic API key for Claude Haiku judge |
| `SLACK_WEBHOOK_URL` | (Optional) Slack incoming webhook for borderline warnings |
