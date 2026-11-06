import crypto from 'node:crypto';
import { PASSWORD_RESET_TTL_MINUTES, type Role, type User } from '@cadence/shared';
import { env } from '../../config/env.js';
import {
  AccountInactiveError,
  ConflictError,
  InvalidCredentialsError,
  NotFoundError,
  UnauthenticatedError,
  UnprocessableError,
} from '../../lib/errors.js';
import {
  durationToMs,
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../lib/jwt.js';
import { logger } from '../../lib/logger.js';
import { sendPasswordResetEmail } from '../../lib/mailer.js';
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

/**
 * A real hash to compare against when the email is unknown, so an unknown
 * address costs the same time as a wrong password and cannot be distinguished
 * from one.  Built lazily rather than written out as a literal: bcryptjs
 * short-circuits on any hash that is not exactly 60 characters, and the
 * hand-written constant this replaces was 66 -- so it returned `false`
 * immediately and the defence was inert.  Hashing a random value at the
 * configured cost is correct by construction.
 *
 * Lazy, not module-level, so start-up is not blocked on a cost-12 hash.
 */
let dummyPasswordHash: Promise<string> | undefined;
function getDummyPasswordHash(): Promise<string> {
  return (dummyPasswordHash ??= hashPassword(crypto.randomUUID()));
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

const PASSWORD_RESET_TTL_MS = PASSWORD_RESET_TTL_MINUTES * 60 * 1000;

/**
 * The secret that goes in the emailed link.  256 bits from the CSPRNG, in
 * base64url so it survives a URL untouched; only its hash is ever stored.
 */
function newResetToken(): string {
  return crypto.randomBytes(32).toString('base64url');
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
      await verifyPassword(input.password, await getDummyPasswordHash());
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

  /**
   * Step one of a self-service reset.
   *
   * Returns nothing, whatever happened. An unknown address, a deactivated
   * account and a successful send are indistinguishable from the outside —
   * otherwise this endpoint would answer "is this person a user here?" for
   * anyone who asked, which is exactly what the sign-in path goes to such
   * lengths to avoid.
   *
   * It does not throw if the mail fails either: that would leak the same
   * thing by the back door (only a real account can produce a send error).
   * The failure is logged, which is where an operator should be looking.
   */
  async forgotPassword(email: string): Promise<void> {
    const user = await authRepository.findByEmail(email);
    // No link for an account an administrator has deactivated: a reset must
    // not be a way back in.
    if (!user || !user.isActive) {
      logger.info({ email }, 'Password reset requested for an unusable address — not sending');
      return;
    }

    // Asking again supersedes the last link, so a mailbox never accumulates
    // several live tokens.
    await authRepository.invalidatePasswordResets(user.id);

    const token = newResetToken();
    await authRepository.createPasswordResetToken({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
    });

    // Built from configuration, never from the request's Host header.
    const resetUrl = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;

    try {
      await sendPasswordResetEmail({
        to: user.email,
        firstName: user.firstName,
        resetUrl,
      });
    } catch (error) {
      logger.error({ err: error, userId: user.id }, 'Failed to send the password reset email');
    }
  },

  /**
   * Step two: spend the token and set the new password.
   *
   * Deliberately does NOT sign the user in. A reset is the one moment the
   * account is being recovered by whoever holds the mailbox, and making them
   * type the new password into the sign-in screen proves it reached the right
   * person rather than handing a session straight to a link-follower.
   *
   * Every refresh token is revoked: if the reason for the reset is that
   * someone else had the old password, leaving their session renewable
   * defeats the point. An access token already issued keeps working until it
   * expires (at most ACCESS_TOKEN_TTL), which is the same bound
   * `changePassword` carries — closing it would cost a database read on
   * every authenticated request.
   */
  async resetPassword(input: { token: string; password: string }): Promise<void> {
    const invalid = new UnprocessableError(
      'This reset link is no longer valid. Request a new one.',
    );

    const stored = await authRepository.findPasswordResetToken(hashToken(input.token));
    // One message for unknown, spent and expired alike — which it is tells a
    // guesser something, and tells the real user nothing they can act on.
    if (!stored || stored.usedAt || stored.expiresAt.getTime() <= Date.now()) throw invalid;
    if (!stored.user.isActive) throw new AccountInactiveError();

    const redeemed = await authRepository.redeemPasswordReset({
      tokenId: stored.id,
      userId: stored.userId,
      passwordHash: await hashPassword(input.password),
    });
    // Lost the race with a concurrent redemption of the same link.
    if (!redeemed) throw invalid;

    logger.info(
      { userId: stored.userId },
      'Password reset completed — every refresh token revoked',
    );
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
