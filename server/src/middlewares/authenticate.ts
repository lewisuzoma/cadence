import type { NextFunction, Request, Response } from 'express';
import { can, type Permission, type Role } from '@cadence/shared';
import { ACCESS_COOKIE } from '../lib/cookies.js';
import { AccountInactiveError, ForbiddenError, UnauthenticatedError } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';
import type { AuthUser } from './types.js';

/**
 * Authentication and authorization middleware.
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
  //
  // The instructor profile is read in the same query for the same reason, and
  // it is what makes the prompt's "permissions take effect immediately"
  // requirement true without a token-version column: an admin's approval or
  // suspension is visible to the very next request this user makes.
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      email: true,
      role: true,
      firstName: true,
      lastName: true,
      isActive: true,
      instructorProfile: { select: { status: true } },
    },
  });
  if (!user) throw new UnauthenticatedError('Your session is no longer valid');
  if (!user.isActive) throw new AccountInactiveError();

  const { instructorProfile, ...rest } = user;
  return { ...rest, instructorStatus: instructorProfile?.status ?? null };
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

/**
 * Requires a capability, not a role.
 *
 * This is the guard every new route uses.  Comparing roles was workable with
 * two of them and becomes a bug generator with three: an instructor is also a
 * learner, so `role === 'LEARNER'` would quietly withdraw learner features
 * from anyone who got approved.  `can()` answers from the single permission
 * map in `shared/permissions.ts`, which both sides of the app read.
 *
 * Suspension is handled inside `can()`: a suspended instructor keeps every
 * learner permission and loses only the teaching ones, so this middleware
 * needs no special case for it.
 */
export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthenticatedError());

    const missing = permissions.filter((permission) => !can(req.user, permission));
    if (missing.length === 0) return next();

    // A suspended instructor gets told why, because it is actionable and the
    // UI has a page for it.  Everyone else gets the generic refusal, which
    // discloses nothing about what the permission was.
    if (req.user.role === 'INSTRUCTOR' && req.user.instructorStatus === 'SUSPENDED') {
      return next(
        new ForbiddenError(
          'Your instructor access is suspended. You can still browse and learn.',
        ),
      );
    }

    next(new ForbiddenError('You do not have access to this resource'));
  };
}

/**
 * Role-based guard, kept for the `/admin/*` namespace.
 *
 * Admin is the one case where the role *is* the boundary rather than a
 * shorthand for a capability: the rule is "instructors are not
 * administrators", and stating it as a role keeps a future permission grant
 * from accidentally opening the admin area.
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthenticatedError());
    if (!roles.includes(req.user.role)) {
      return next(new ForbiddenError('This area is restricted to administrators'));
    }
    next();
  };
}
