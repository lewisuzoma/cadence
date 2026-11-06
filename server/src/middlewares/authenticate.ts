import type { NextFunction, Request, Response } from 'express';
import { ACCESS_COOKIE } from '../lib/cookies.js';
import { AccountInactiveError, ForbiddenError, UnauthenticatedError } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';
import type { AuthUser } from './types.js';
import type { Role } from '@cadence/shared';

/**
 * Authentication middleware.
 *
 * These are declared to return `void`, with the async work in a promise chain
 * ending in `.catch(next)`. Express 4 does not await middleware, so handing it
 * an `async` function means a rejection becomes an unhandled promise rejection
 * instead of a 500 — the shape below makes that impossible.
 */

async function loadUser(token: string): Promise<AuthUser> {
  const payload = verifyAccessToken(token);
  // The token is trusted for identity but not for state: a user deactivated
  // one minute ago still holds a valid 15-minute token, so the row is read.
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      email: true,
      role: true,
      firstName: true,
      lastName: true,
      isActive: true,
    },
  });
  if (!user) throw new UnauthenticatedError('Your session is no longer valid');
  if (!user.isActive) throw new AccountInactiveError();
  return user;
}

/** Requires a valid access cookie; 401 otherwise. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[ACCESS_COOKIE] as string | undefined;
  if (!token) {
    next(new UnauthenticatedError());
    return;
  }

  loadUser(token)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch(next);
}

/**
 * Attaches the user when a valid cookie is present, but never rejects. The
 * catalog uses this: signed-out visitors get the public view, signed-in ones
 * additionally get their enrollment state.
 */
export function optionalAuthenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const token = req.cookies?.[ACCESS_COOKIE] as string | undefined;
  if (!token) {
    next();
    return;
  }

  loadUser(token)
    .then((user) => {
      req.user = user;
    })
    .catch(() => {
      // An expired or tampered cookie is simply treated as "not signed in".
    })
    .finally(() => next());
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthenticatedError());
    if (!roles.includes(req.user.role)) {
      return next(new ForbiddenError('This area is restricted to administrators'));
    }
    next();
  };
}
