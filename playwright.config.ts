import { defineConfig } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config();

const runTimestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');

export default defineConfig({
  globalSetup: './tests/global-setup.ts',
  timeout: 300_000,          // 5 min per test — multi-turn tests run 3× each (3 runs × 2 turns × ~60s/turn)
  workers: 1,                // NEVER change — one browser session at a time
  retries: 0,                // Variance handled inside runWithVarianceRules
  outputDir: 'test-results/artifacts',
  reporter: [
    ['list'],
    ['html', { outputFolder: `test-results/html-report-${runTimestamp}`, open: 'never' }],
    ['json', { outputFile: 'reports/playwright-results.json' }],
  ],
  use: {
    headless: true,
    storageState: process.env.CHATGPT_SESSION,
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'functional', testDir: './tests/functional' },
    { name: 'security',   testDir: './tests/security' },
    { name: 'golden',     testDir: './tests/golden' },
  ],
});
