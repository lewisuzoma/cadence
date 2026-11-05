import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import {
  durationToMs,
  hashToken,
  randomCsrfToken,
  safeEqual,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from '../../lib/jwt.js';
import { buildMeta, toSkipTake } from '../../lib/pagination.js';

describe('password hashing', () => {
  it('produces a bcrypt hash that verifies', async () => {
    const hash = await hashPassword('Password123');
    expect(hash).toMatch(/^\$2[aby]\$/);
    expect(await verifyPassword('Password123', hash)).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('Password123');
    expect(await verifyPassword('password123', hash)).toBe(false);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const a = await hashPassword('Password123');
    const b = await hashPassword('Password123');
    expect(a).not.toBe(b);
  });
});

describe('tokens', () => {
  const userId = '11111111-1111-1111-1111-111111111111';
  const familyId = '22222222-2222-2222-2222-222222222222';

  it('round-trips an access token with its role', () => {
    const payload = verifyAccessToken(signAccessToken(userId, 'ADMIN'));
    expect(payload.sub).toBe(userId);
    expect(payload.role).toBe('ADMIN');
    expect(payload.type).toBe('access');
  });

  it('refuses a tampered access token', () => {
    const token = signAccessToken(userId, 'LEARNER');
    expect(() => verifyAccessToken(`${token}x`)).toThrow();
  });

  it('will not accept a refresh token where an access token belongs', () => {
    const { token } = signRefreshToken(userId, familyId);
    expect(() => verifyAccessToken(token)).toThrow();
  });

  it('carries the family id, and a unique jti per rotation', () => {
    const first = signRefreshToken(userId, familyId);
    const second = signRefreshToken(userId, familyId);
    expect(verifyRefreshToken(first.token).fid).toBe(familyId);
    expect(first.jti).not.toBe(second.jti);
    // A different jti means a different stored hash, so each rotation is
    // distinguishable and replay can be detected.
    expect(hashToken(first.token)).not.toBe(hashToken(second.token));
  });

  it('hashes tokens deterministically for storage', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).toHaveLength(64);
  });
});

describe('csrf token comparison', () => {
  it('matches a token against itself', () => {
    const token = randomCsrfToken();
    expect(safeEqual(token, token)).toBe(true);
  });

  it('rejects a different token, and differing lengths', () => {
    expect(safeEqual(randomCsrfToken(), randomCsrfToken())).toBe(false);
    expect(safeEqual('short', 'muchlongervalue')).toBe(false);
  });
});

describe('durationToMs', () => {
  it('parses the supported units', () => {
    expect(durationToMs('15m')).toBe(900_000);
    expect(durationToMs('7d')).toBe(604_800_000);
    expect(durationToMs('30s')).toBe(30_000);
  });

  it('throws on nonsense rather than defaulting silently', () => {
    expect(() => durationToMs('soon')).toThrow();
  });
});

describe('pagination', () => {
  it('converts page and pageSize to skip and take', () => {
    expect(toSkipTake(1, 12)).toEqual({ skip: 0, take: 12 });
    expect(toSkipTake(3, 10)).toEqual({ skip: 20, take: 10 });
  });

  it('reports one page when there are no results', () => {
    expect(buildMeta(1, 12, 0)).toEqual({ page: 1, pageSize: 12, total: 0, totalPages: 1 });
  });

  it('rounds partial pages up', () => {
    expect(buildMeta(1, 12, 40).totalPages).toBe(4);
  });
});
