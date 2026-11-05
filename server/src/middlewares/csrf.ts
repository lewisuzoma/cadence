import type { NextFunction, Request, Response } from 'express';
import { CSRF_COOKIE } from '../lib/cookies.js';
import { CsrfError } from '../lib/errors.js';
import { safeEqual } from '../lib/jwt.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Double-submit CSRF protection.
 *
 * Auth cookies are `SameSite=Lax`, which already blocks cross-site POSTs from
 * a plain form submit, but Lax is not a complete defence (and tells us nothing
 * about same-site subdomain attacks).  So every mutating request must also
 * echo the readable `csrf_token` cookie in an `X-CSRF-Token` header: script on
 * another origin cannot read that cookie, so it cannot forge the header.
 *
 * Login, register and refresh are exempt — there is no session yet, and they
 * are the endpoints that mint the token.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (!MUTATING.has(req.method)) return next();

  const cookieToken = req.cookies?.[CSRF_COOKIE] as string | undefined;
  const headerToken = req.get('x-csrf-token');

  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    return next(new CsrfError());
  }
  next();
}
