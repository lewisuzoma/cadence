import type { NextFunction, Request, Response } from 'express';
import { ACCESS_COOKIE } from '../lib/cookies.js';
import { AccountInactiveError, ForbiddenError, UnauthenticatedError } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';
import type { AuthUser } from './types.js';
import type { Role } from '@cadence/shared';

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
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = req.cookies?.[ACCESS_COOKIE] as string | undefined;
    if (!token) throw new UnauthenticatedError();
    req.user = await loadUser(token);
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Attaches the user when a valid cookie is present, but never rejects.  The
 * catalog uses this: signed-out visitors get the public view, signed-in ones
 * additionally get their enrollment state.
 */
export async function optionalAuthenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = req.cookies?.[ACCESS_COOKIE] as string | undefined;
  if (!token) return next();
  try {
    req.user = await loadUser(token);
  } catch {
    // An expired or tampered cookie is simply treated as "not signed in".
  }
  next();
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
