import { beforeAll } from 'vitest';

/**
 * Per-file setup.  The env has to be in place before `config/env.ts` is
 * imported by anything, which is why these are plain assignments rather than
 * a hook.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters-long';
process.env.COOKIE_SECURE = 'false';
process.env.LOG_LEVEL = 'silent';
// bcrypt at cost 12 would add minutes across the suite; the hashing itself is
// unit-tested separately at the production cost.
//
// Forced with `=`, not `??=`. `bcryptjs` is pure JavaScript, so cost 12 costs
// roughly a second of CPU per hash, and nearly every test creates a user and
// logs in. A developer with BCRYPT_COST=12 in their .env — which .env.example
// ships — silently inherited it here and ran the whole suite at production
// cost: ~850s of test time instead of ~90s, enough CPU pressure to block the
// event loop past vitest's own timeout and fail a passing test. The Compose
// test service already pins '4' for the same reason; nothing is gained by
// letting the ambient environment override it.
process.env.BCRYPT_COST = '4';

beforeAll(() => {
  if (!process.env.DATABASE_URL?.includes('test')) {
    throw new Error('Server tests must point at a database whose name contains "test"');
  }
});
