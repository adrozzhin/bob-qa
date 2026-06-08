/**
 * global-setup.ts
 * Runs once before all tests.
 *
 * Validates that a ChatGPT session file exists and is still active.
 * If missing or expired, throws with instructions to re-run save-session.
 *
 * To create or refresh the session:
 *   npm run save-session
 */

import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config();

import { SESSION_PATH } from '../scripts/login';

const SETUP_HINT =
  'Run:  npm run save-session\n' +
  'Log in manually in the browser that opens, then press Enter to save the session.';

async function isSessionValid(sessionPath: string): Promise<boolean> {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  const context = await browser.newContext({
    storageState: sessionPath,
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await context.newPage();
  try {
    await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForTimeout(2000);
    const title = await page.title();
    if (title.includes('Just a moment') || page.url().includes('challenge')) {
      return false;
    }
    return !page.url().includes('/auth') && !page.url().includes('login');
  } catch {
    return false;
  } finally {
    await browser.close();
  }
}

async function globalSetup(): Promise<void> {
  if (!fs.existsSync(SESSION_PATH)) {
    throw new Error(`No ChatGPT session found at ${SESSION_PATH}.\n${SETUP_HINT}`);
  }

  // GitHub Actions IPs are datacenter IPs that Cloudflare challenges with
  // "Just a moment", making the live check a false negative in CI. Skip it
  // there — a bad session will still surface as test failures.
  if (process.env.CI) {
    console.log('\n✓ CI mode — skipping live session check, trusting session file\n');
    return;
  }

  const valid = await isSessionValid(SESSION_PATH);
  if (!valid) {
    throw new Error(`ChatGPT session expired (${SESSION_PATH}).\n${SETUP_HINT}`);
  }

  console.log('\n✓ ChatGPT session valid — proceeding with tests\n');
}

export default globalSetup;
