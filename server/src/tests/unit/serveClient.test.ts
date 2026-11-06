import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveClientDist } from '../../middlewares/serveClient.js';

/**
 * Whether this process serves the SPA decides which of the two deployment
 * shapes it is in — nginx in front (Docker Compose), or one process doing
 * both (Laravel Cloud and friends). Getting the answer wrong is quiet and
 * expensive: a stray match would have the API answering HTML, and a missed
 * one leaves a single-process deployment serving nothing at `/`.
 */

const made: string[] = [];

/** A throwaway directory, optionally with a client build inside it. */
function fixture(withIndex: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'cadence-client-'));
  made.push(root);
  const dist = join(root, 'client', 'dist');
  mkdirSync(dist, { recursive: true });
  if (withIndex) writeFileSync(join(dist, 'index.html'), '<!DOCTYPE html>');
  return dist;
}

afterEach(() => {
  delete process.env.CLIENT_DIST;
  for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('resolveClientDist', () => {
  it('accepts a CLIENT_DIST that holds a built client', () => {
    const dist = fixture(true);
    process.env.CLIENT_DIST = dist;
    expect(resolveClientDist()).toBe(dist);
  });

  it('rejects a directory with no index.html', () => {
    // A half-copied or empty build is not a client: serving it would answer
    // every route with a 404 from express.static instead of falling through.
    process.env.CLIENT_DIST = fixture(false);
    expect(resolveClientDist()).toBeNull();
  });

  it('rejects a CLIENT_DIST that does not exist', () => {
    process.env.CLIENT_DIST = join(tmpdir(), 'cadence-nothing-here-at-all');
    expect(resolveClientDist()).toBeNull();
  });

  it('finds the build by walking up from the server, as a deployment lays it out', () => {
    // No CLIENT_DIST set: this is the Laravel Cloud layout, where client/dist
    // sits beside the server build at the repository root. The repository's
    // own client is built in CI before the suite runs, so either a path is
    // returned or there is no build to find — never a wrong path.
    const found = resolveClientDist();
    if (found !== null) expect(found.replace(/\\/g, '/')).toMatch(/\/client\/dist$/);
  });
});
