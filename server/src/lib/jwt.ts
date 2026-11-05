import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Role } from '@cadence/shared';
import { env } from '../config/env.js';
import { UnauthenticatedError } from './errors.js';

export type AccessTokenPayload = {
  sub: string;
  role: Role;
  type: 'access';
};

export type RefreshTokenPayload = {
  sub: string;
  /** Rotation chain id, so a replayed token can revoke its whole family. */
  fid: string;
  /** Unique per token, which makes each rotation's hash distinct. */
  jti: string;
  type: 'refresh';
};

export function signAccessToken(userId: string, role: Role): string {
  const payload: AccessTokenPayload = { sub: userId, role, type: 'access' };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL,
    issuer: 'cadence',
    audience: 'cadence-api',
  } as jwt.SignOptions);
}

export function signRefreshToken(userId: string, familyId: string): { token: string; jti: string } {
  const jti = crypto.randomUUID();
  const payload: RefreshTokenPayload = { sub: userId, fid: familyId, jti, type: 'refresh' };
  const token = jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.REFRESH_TOKEN_TTL,
    issuer: 'cadence',
    audience: 'cadence-api',
  } as jwt.SignOptions);
  return { token, jti };
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: 'cadence',
      audience: 'cadence-api',
    }) as AccessTokenPayload;
    if (decoded.type !== 'access') throw new UnauthenticatedError('Wrong token type');
    return decoded;
  } catch {
    // Expiry and tampering are indistinguishable to the caller on purpose.
    throw new UnauthenticatedError('Your session has expired');
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET, {
      issuer: 'cadence',
      audience: 'cadence-api',
    }) as RefreshTokenPayload;
    if (decoded.type !== 'refresh') throw new UnauthenticatedError('Wrong token type');
    return decoded;
  } catch {
    throw new UnauthenticatedError('Your session has expired');
  }
}

/**
 * Refresh tokens are stored as a SHA-256 hash.  bcrypt is unnecessary here:
 * the token is already 200+ bits of signed entropy, so there is nothing to
 * brute-force, and a fast digest keeps rotation cheap.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Turns `7d` / `15m` into milliseconds, for cookie `maxAge`. */
export function durationToMs(duration: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(duration);
  if (!match) throw new Error(`Unsupported duration: ${duration}`);
  const value = Number(match[1]);
  const unit = match[2] as 'ms' | 's' | 'm' | 'h' | 'd';
  const factors = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
  return value * factors[unit];
}

export function randomCsrfToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Constant-time comparison for the double-submit CSRF check. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
