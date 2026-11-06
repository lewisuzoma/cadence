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

/** `refreshTtl` travels with the pair so the cookie matches the DB row. */
export type TokenPair = { accessToken: string; refreshToken: string; refreshTtl: string };
export type AuthResult = { user: User; tokens: TokenPair };

function toPublicUser(row: PublicUserRow): User {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    role: row.role,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Which refresh lifetime a session gets. "Keep me signed in" buys a longer
 * refresh token; it never lengthens the access token, so the user row is
 * still re-read every 15 minutes and a deactivation still bites immediately.
 */
function refreshTtlFor(rememberMe: boolean): string {
  return rememberMe ? env.REFRESH_TOKEN_TTL_REMEMBERED : env.REFRESH_TOKEN_TTL;
}

async function issueTokens(
  userId: string,
  role: Role,
  options?: { familyId?: string; rememberMe?: boolean },
): Promise<TokenPair> {
  const family = options?.familyId ?? crypto.randomUUID();
  const ttl = refreshTtlFor(options?.rememberMe ?? false);
  const { token: refreshToken } = signRefreshToken(userId, family);
  await authRepository.createRefreshToken({
    userId,
    tokenHash: hashToken(refreshToken),
    familyId: family,
    // The row's expiry and the cookie's maxAge come from the same value.
    expiresAt: new Date(Date.now() + durationToMs(ttl)),
  });
  return { accessToken: signAccessToken(userId, role), refreshToken, refreshTtl: ttl };
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

    const tokens = await issueTokens(user.id, user.role);
    return { user: toPublicUser(user), tokens };
  },

  async login(input: {
    email: string;
    password: string;
    rememberMe?: boolean;
  }): Promise<AuthResult> {
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

    const tokens = await issueTokens(user.id, user.role, {
      rememberMe: input.rememberMe ?? false,
    });
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

    /*
     * Rotation preserves the chain's original lifetime, so a remembered
     * session is not silently downgraded to 7 days on its first refresh.
     * The remaining life of the presented token is the source of truth —
     * there is no need to store a "remembered" flag on the row.
     */
    const remainingMs = stored.expiresAt.getTime() - stored.createdAt.getTime();
    const rotatedTtl =
      remainingMs > durationToMs(env.REFRESH_TOKEN_TTL)
        ? env.REFRESH_TOKEN_TTL_REMEMBERED
        : env.REFRESH_TOKEN_TTL;

    const { token: nextRefresh } = signRefreshToken(user.id, payload.fid);
    await authRepository.rotate({
      oldTokenId: stored.id,
      userId: user.id,
      tokenHash: hashToken(nextRefresh),
      familyId: payload.fid,
      expiresAt: new Date(Date.now() + durationToMs(rotatedTtl)),
    });

    return {
      user: toPublicUser(user),
      tokens: {
        accessToken: signAccessToken(user.id, user.role),
        refreshToken: nextRefresh,
        refreshTtl: rotatedTtl,
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

    const tokens = await issueTokens(user.id, user.role);
    return { user: toPublicUser(user), tokens };
  },
};
