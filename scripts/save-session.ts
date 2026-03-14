/**
 * save-session.ts
 * Launches Chrome natively (no automation flags), lets you log in manually,
 * then connects via CDP to extract and save the session.
 *
 * Run: npm run save-session
 */

import { chromium } from '@playwright/test';
import { execSync, spawn } from 'child_process';
import * as readline from 'readline';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9222;

async function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('', () => { rl.close(); resolve(); });
  });
}

async function main() {
  console.log('Closing any existing Chrome instances...');
  try {
    execSync('taskkill /F /IM chrome.exe', { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 1500));
  } catch {
    // No Chrome was running — fine
  }

  console.log('Opening Chrome...');
  const chrome = spawn(
    CHROME_PATH,
    [
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--user-data-dir=C:\\Users\\drozz\\AppData\\Local\\Temp\\chrome-session-capture',
      '--no-first-run',
      '--no-default-browser-check',
      'https://chatgpt.com',
    ],
    { detached: true, stdio: 'ignore' }
  );
  chrome.unref();

  // Give Chrome a moment to start
  await new Promise((r) => setTimeout(r, 2000));

  console.log('Log into ChatGPT in the browser window, then press Enter here to save the session...');
  await waitForEnter();

  console.log('Connecting to browser and saving session...');
  const browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
  const context = browser.contexts()[0];
  await context.storageState({ path: 'fixtures/chatgpt-session.json' });
  console.log('Session saved successfully');

  await browser.close();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
