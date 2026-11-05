import type { Role } from '@cadence/shared';

/**
 * The authenticated principal.  `authenticate` puts it on the request and it
 * is the ONLY source of identity in the server: no handler reads a user id
 * from the body, params or query, which is what rules out IDOR.
 */
export type AuthUser = {
  id: string;
  email: string;
  role: Role;
  firstName: string;
  lastName: string;
  isActive: boolean;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
