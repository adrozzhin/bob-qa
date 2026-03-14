/**
 * convert-session.ts
 * Converts a Cookie-Editor flat-array export into Playwright storageState format.
 * Run: npm run convert-session
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

const SESSION_PATH = process.env.CHATGPT_SESSION ?? './fixtures/chatgpt-session.json';
const resolvedPath = path.resolve(SESSION_PATH);

interface CookieEditorCookie {
  domain: string;
  name: string;
  value: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  expirationDate?: number;
  sameSite?: string;
  hostOnly?: boolean;
  session?: boolean;
  storeId?: string;
}

interface PlaywrightCookie {
  domain: string;
  name: string;
  value: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  expires: number;
  sameSite: 'Lax' | 'Strict' | 'None';
}

interface PlaywrightStorageState {
  cookies: PlaywrightCookie[];
  origins: unknown[];
}

function mapSameSite(raw: string | undefined): 'Lax' | 'Strict' | 'None' {
  switch ((raw ?? '').toLowerCase()) {
    case 'strict':        return 'Strict';
    case 'no_restriction':
    case 'none':          return 'None';
    case 'lax':
    case 'unspecified':
    default:              return 'Lax';
  }
}

function convertCookieEditorToPlaywright(cookies: CookieEditorCookie[]): PlaywrightStorageState {
  const converted: PlaywrightCookie[] = cookies.map((c) => ({
    domain: c.domain,
    name: c.name,
    value: c.value,
    path: c.path ?? '/',
    httpOnly: c.httpOnly ?? false,
    secure: c.secure ?? false,
    expires: c.expirationDate ?? -1,
    sameSite: mapSameSite(c.sameSite),
  }));
  return { cookies: converted, origins: [] };
}

function isPlaywrightFormat(data: unknown): data is PlaywrightStorageState {
  return (
    typeof data === 'object' &&
    data !== null &&
    'cookies' in data &&
    'origins' in data &&
    Array.isArray((data as PlaywrightStorageState).cookies)
  );
}

function isCookieEditorFormat(data: unknown): data is CookieEditorCookie[] {
  return Array.isArray(data) && data.length > 0 && 'name' in (data[0] as object);
}

// ---- main ----
if (!fs.existsSync(resolvedPath)) {
  console.error(`ERROR: Session file not found at ${resolvedPath}`);
  console.error(
    'Export cookies from chatgpt.com using the Cookie-Editor extension (Export → Export as JSON) ' +
    'and save to fixtures/chatgpt-session.json'
  );
  process.exit(1);
}

const raw = fs.readFileSync(resolvedPath, 'utf-8');
let parsed: unknown;
try {
  parsed = JSON.parse(raw);
} catch {
  console.error('ERROR: Session file is not valid JSON.');
  process.exit(1);
}

if (isPlaywrightFormat(parsed)) {
  console.log(`Already in Playwright storageState format (${parsed.cookies.length} cookies). No conversion needed.`);
  process.exit(0);
}

if (!isCookieEditorFormat(parsed)) {
  console.error('ERROR: Unrecognised cookie format. Expected a flat Cookie-Editor array or Playwright storageState object.');
  process.exit(1);
}

const result = convertCookieEditorToPlaywright(parsed);
fs.writeFileSync(resolvedPath, JSON.stringify(result, null, 2), 'utf-8');
console.log(`Converted ${result.cookies.length} cookies. Run tests now.`);
