import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

/**
 * Password hashing.
 *
 * `bcryptjs` rather than the native `bcrypt`: it is the same algorithm and
 * cost factor in pure JavaScript, which keeps the Alpine runtime image free of
 * node-gyp, Python and a C toolchain.  The trade-off (a slower hash, ~2.5x) is
 * acceptable because hashing happens only on register, login and password
 * change.  Recorded in ARCHITECTURE.md.
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
