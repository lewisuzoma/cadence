import type { Request, Response } from 'express';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from '@cadence/shared';
import { REFRESH_COOKIE, clearAuthCookies, setAuthCookies } from '../../lib/cookies.js';
import { UnauthenticatedError } from '../../lib/errors.js';
import { created, ok } from '../../lib/response.js';
import { authService, type AuthResult } from './auth.service.js';

/**
 * HTTP only: read the request, call the service, set cookies, answer.  No
 * business rules live here.
 */

/** Tokens go into httpOnly cookies and never into a response body. */
function respondWithSession(res: Response, result: AuthResult): void {
  setAuthCookies(res, result.tokens.accessToken, result.tokens.refreshToken);
}

export const authController = {
  async register(req: Request, res: Response): Promise<void> {
    const input = registerSchema.parse(req.body);
    const result = await authService.register({
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      password: input.password,
    });
    respondWithSession(res, result);
    created(res, 'Account created', { user: result.user });
  },

  async login(req: Request, res: Response): Promise<void> {
    const input = loginSchema.parse(req.body);
    const result = await authService.login(input);
    respondWithSession(res, result);
    ok(res, 'Signed in', { user: result.user });
  },

  async refresh(req: Request, res: Response): Promise<void> {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!token) throw new UnauthenticatedError('No session to refresh');
    const result = await authService.refresh(token);
    respondWithSession(res, result);
    ok(res, 'Session refreshed', { user: result.user });
  },

  async logout(req: Request, res: Response): Promise<void> {
    await authService.logout(req.cookies?.[REFRESH_COOKIE] as string | undefined);
    clearAuthCookies(res);
    ok(res, 'Signed out', { success: true });
  },

  async me(req: Request, res: Response): Promise<void> {
    // `req.user` is set by `authenticate`; the route is never reachable without it.
    const user = await authService.me(req.user!.id);
    ok(res, 'Current user', { user });
  },

  async updateProfile(req: Request, res: Response): Promise<void> {
    const input = updateProfileSchema.parse(req.body);
    const user = await authService.updateProfile(req.user!.id, input);
    ok(res, 'Profile updated', { user });
  },

  async changePassword(req: Request, res: Response): Promise<void> {
    const input = changePasswordSchema.parse(req.body);
    const result = await authService.changePassword(req.user!.id, {
      currentPassword: input.currentPassword,
      password: input.password,
    });
    // A new session replaces the one just invalidated, so the user stays
    // signed in on this device while every other device is signed out.
    respondWithSession(res, result);
    ok(res, 'Password updated', { user: result.user });
  },
};
