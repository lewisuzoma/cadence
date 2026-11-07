import type { InstructorProfileStatus, Role } from '@cadence/shared';

/**
 * The authenticated principal.  `authenticate` puts it on the request and it
 * is the ONLY source of identity in the server: no handler reads a user id
 * from the body, params or query, which is what rules out IDOR.
 *
 * `instructorStatus` is read from the database on every request alongside the
 * role, not carried in the token.  That is what makes an approval or a
 * suspension effective on the user's *very next request* instead of whenever
 * their 15-minute access token happens to expire.
 */
export type AuthUser = {
  id: string;
  email: string;
  role: Role;
  firstName: string;
  lastName: string;
  isActive: boolean;
  /** `null` for anyone without an instructor profile. */
  instructorStatus: InstructorProfileStatus | null;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      /** Set by the `requestId` middleware; see middlewares/requestId.ts. */
      requestId?: string;
    }
  }
}
