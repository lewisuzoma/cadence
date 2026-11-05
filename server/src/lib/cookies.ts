import type { CookieOptions, Response } from 'express';
import { env } from '../config/env.js';
import { durationToMs, randomCsrfToken } from './jwt.js';

/**
 * Cookie names and options in one place.  Both tokens are httpOnly, so no
 * script can read them; the CSRF token is deliberately readable, because the
 * client has to echo it back in a header (double-submit).
 */
export const ACCESS_COOKIE = 'cadence_access';
export const REFRESH_COOKIE = 'cadence_refresh';
export const CSRF_COOKIE = 'csrf_token';

/** Scoping the refresh cookie means it is not sent on every API call. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

const base: CookieOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'lax',
  path: '/',
};

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string): string {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...base,
    maxAge: durationToMs(env.ACCESS_TOKEN_TTL),
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...base,
    path: REFRESH_COOKIE_PATH,
    maxAge: durationToMs(env.REFRESH_TOKEN_TTL),
  });
  const csrfToken = randomCsrfToken();
  res.cookie(CSRF_COOKIE, csrfToken, {
    ...base,
    httpOnly: false, // the client must read this one to echo it back
    maxAge: durationToMs(env.REFRESH_TOKEN_TTL),
  });
  return csrfToken;
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...base });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: REFRESH_COOKIE_PATH });
  res.clearCookie(CSRF_COOKIE, { ...base, httpOnly: false });
}
