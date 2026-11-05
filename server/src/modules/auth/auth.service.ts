import crypto from 'node:crypto';
import type { Role, User } from '@cadence/shared';
import { env } from '../../config/env.js';
import {
  AccountInactiveError,
  ConflictError,
  InvalidCredentialsError,
  NotFoundError,
  UnauthenticatedError,
} from '../../lib/errors.js';
import {
  durationToMs,
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../lib/jwt.js';
import { logger } from '../../lib/logger.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { authRepository, type PublicUserRow } from './auth.repository.js';

export type TokenPair = { accessToken: string; refreshToken: string };
export type AuthResult = { user: User; tokens: TokenPair };

function toPublicUser(row: PublicUserRow): User {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    role: row.role as Role,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

async function issueTokens(userId: string, role: Role, familyId?: string): Promise<TokenPair> {
  const family = familyId ?? crypto.randomUUID();
  const { token: refreshToken } = signRefreshToken(userId, family);
  await authRepository.createRefreshToken({
    userId,
    tokenHash: hashToken(refreshToken),
    familyId: family,
    expiresAt: new Date(Date.now() + durationToMs(env.REFRESH_TOKEN_TTL)),
  });
  return { accessToken: signAccessToken(userId, role), refreshToken };
}

export const authService = {
  async register(input: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
  }): Promise<AuthResult> {
    const existing = await authRepository.findByEmail(input.email);
    if (existing) {
      throw new ConflictError('An account with that email already exists');
    }

    const user = await authRepository.createUser({
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      passwordHash: await hashPassword(input.password),
    });

    const tokens = await issueTokens(user.id, user.role as Role);
    return { user: toPublicUser(user), tokens };
  },

  async login(input: { email: string; password: string }): Promise<AuthResult> {
    const user = await authRepository.findByEmail(input.email);

    // Hash a dummy value when the account does not exist, so the response
    // time does not reveal whether an email is registered.
    if (!user) {
      await verifyPassword(input.password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
      throw new InvalidCredentialsError();
    }

    const passwordMatches = await verifyPassword(input.password, user.passwordHash);
    if (!passwordMatches) throw new InvalidCredentialsError();
    // Checked after the password so a deactivated account is not disclosed to
    // someone guessing emails.
    if (!user.isActive) throw new AccountInactiveError();

    const tokens = await issueTokens(user.id, user.role as Role);
    return {
      user: toPublicUser(user),
      tokens,
    };
  },

  /**
   * Rotates a refresh token.
   *
   * Replaying a token that was already used (and therefore revoked) means the
   * token leaked: the whole family is revoked, which signs the attacker and
   * the real user out and forces a fresh login.
   */
  async refresh(presentedToken: string): Promise<AuthResult> {
    const payload = verifyRefreshToken(presentedToken);
    const stored = await authRepository.findRefreshToken(hashToken(presentedToken));

    if (!stored) throw new UnauthenticatedError('Your session has expired');

    if (stored.revokedAt) {
      logger.warn(
        { userId: stored.userId, familyId: stored.familyId },
        'Refresh token reuse detected — revoking the token family',
      );
      await authRepository.revokeFamily(stored.familyId);
      throw new UnauthenticatedError('Your session has expired');
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      await authRepository.revokeToken(stored.id);
      throw new UnauthenticatedError('Your session has expired');
    }

    const user = await authRepository.findById(stored.userId);
    if (!user) throw new UnauthenticatedError('Your session is no longer valid');
    if (!user.isActive) throw new AccountInactiveError();

    const { token: nextRefresh } = signRefreshToken(user.id, payload.fid);
    await authRepository.rotate({
      oldTokenId: stored.id,
      userId: user.id,
      tokenHash: hashToken(nextRefresh),
      familyId: payload.fid,
      expiresAt: new Date(Date.now() + durationToMs(env.REFRESH_TOKEN_TTL)),
    });

    return {
      user: toPublicUser(user),
      tokens: {
        accessToken: signAccessToken(user.id, user.role as Role),
        refreshToken: nextRefresh,
      },
    };
  },

  /** Logout is best-effort: an unknown or expired token still clears cookies. */
  async logout(presentedToken: string | undefined): Promise<void> {
    if (!presentedToken) return;
    const stored = await authRepository.findRefreshToken(hashToken(presentedToken));
    if (stored && !stored.revokedAt) {
      await authRepository.revokeToken(stored.id);
    }
  },

  async me(userId: string): Promise<User> {
    const user = await authRepository.findPublicById(userId);
    if (!user) throw new NotFoundError('User');
    return toPublicUser(user);
  },

  async updateProfile(
    userId: string,
    input: { firstName: string; lastName: string },
  ): Promise<User> {
    const user = await authRepository.updateProfile(userId, input);
    return toPublicUser(user);
  },

  /**
   * Changing a password revokes every other session: if the reason for the
   * change is a suspected compromise, leaving the old sessions alive would
   * defeat the point.
   */
  async changePassword(
    userId: string,
    input: { currentPassword: string; password: string },
  ): Promise<AuthResult> {
    const user = await authRepository.findById(userId);
    if (!user) throw new NotFoundError('User');

    const matches = await verifyPassword(input.currentPassword, user.passwordHash);
    if (!matches) throw new InvalidCredentialsError('Your current password is incorrect');

    await authRepository.updatePasswordHash(userId, await hashPassword(input.password));
    await authRepository.revokeAllForUser(userId);

    const tokens = await issueTokens(user.id, user.role as Role);
    return { user: toPublicUser(user), tokens };
  },
};
