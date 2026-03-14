/**
 * login.ts
 * Resolves and exports the ChatGPT session file path used by askBob().
 *
 * Session setup (manual):
 *   1. Export cookies from chatgpt.com via the Cookie-Editor browser extension
 *      (Export → Export as JSON) and save the file to fixtures/chatgpt-session.json
 *   2. Run  npm run convert-session  to convert the Cookie-Editor format into
 *      Playwright storageState format (no-op if already converted).
 *   3. Run tests normally.
 *
 * Override the path with the CHATGPT_SESSION env var if needed.
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

export const SESSION_PATH = path.resolve(
  process.env.CHATGPT_SESSION ?? './fixtures/chatgpt-session.json'
);
