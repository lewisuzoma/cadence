#!/usr/bin/env node
/**
 * Checks that `.env` has every key `.env.example` declares.
 *
 * This exists because of a real failure: `APP_URL` and `MAIL_FROM` were added
 * to `server/src/config/env.ts` (and to `.env.example`) for password reset,
 * but `.env` is gitignored, so existing clones kept a copy without them. The
 * server validates its environment and exits, so the symptom was a container
 * that died at boot with a message nobody reads until they go looking.
 *
 * A key is "missing" only when the template has it and `.env` does not. Extra
 * local keys are fine — someone may be overriding something deliberately.
 *
 * Deliberately NOT wired into `postinstall`: that runs during `npm ci` inside
 * the Docker build, where `.env` is absent on purpose (`.dockerignore`).
 * It runs from `predev`, and on demand via `npm run env:check`.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const examplePath = join(root, '.env.example');
const envPath = join(root, '.env');

/** Keys only: values are nobody's business here, and must never be printed. */
function keysOf(path) {
  const keys = new Set();
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match) keys.add(match[1]);
  }
  return keys;
}

if (!existsSync(examplePath)) {
  console.error('check-env: .env.example is missing — cannot tell what is required.');
  process.exit(1);
}

if (!existsSync(envPath)) {
  console.error(
    [
      '',
      '  No .env file found.',
      '',
      '  Create one from the template:',
      '',
      '      cp .env.example .env',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

const required = keysOf(examplePath);
const present = keysOf(envPath);
const missing = [...required].filter((key) => !present.has(key));

if (missing.length > 0) {
  console.error(
    [
      '',
      `  Your .env is missing ${missing.length} key${missing.length === 1 ? '' : 's'} that .env.example declares:`,
      '',
      ...missing.map((key) => `      ${key}`),
      '',
      '  .env is gitignored, so it does not pick up new keys on its own.',
      '  Copy the missing lines across, or start fresh with:',
      '',
      '      cp .env.example .env',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

console.log(`check-env: .env has all ${required.size} keys from .env.example`);
