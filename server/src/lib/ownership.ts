import { can } from '@cadence/shared';
import { ForbiddenError, NotFoundError } from './errors.js';
import type { AuthUser } from '../middlewares/types.js';

/**
 * Ownership, decided in one place.
 *
 * The prompt's rule is specific and worth restating, because it is easy to
 * get subtly wrong: when instructor A asks for instructor B's course, the
 * answer is **404, not 403**.  A 403 would confirm the course exists, which
 * leaks the catalogue of unpublished work across accounts; a 404 makes
 * someone else's draft indistinguishable from a course that was never
 * created.
 *
 * Every instructor-scoped read and write funnels through these helpers, so
 * the rule is stated once rather than re-derived at each call site — and a
 * new endpoint that forgets to call one fails its ownership test rather than
 * silently exposing data.
 */

/** Anything with an owner column.  `createdById` is the owner; see the schema. */
export type Owned = { createdById: string };

/** True when the actor may act on any course, not merely their own. */
export function isPlatformAdmin(actor: AuthUser | undefined): boolean {
  return can(actor, 'course:manage-any');
}

/**
 * Narrows a course to one the actor may manage, or throws.
 *
 * `resource` only shapes the 404 message; it never changes the status code.
 */
export function assertOwnsCourse(
  course: Owned | null | undefined,
  actor: AuthUser,
  resource = 'Course',
): asserts course is Owned {
  // A missing course and someone else's course answer identically, on
  // purpose: the caller must not be able to tell them apart.
  if (!course) throw new NotFoundError(resource);
  if (isPlatformAdmin(actor)) return;

  /*
   * Reaching here without the permission means a route forgot its
   * `requirePermission` guard.  403 rather than 404 is deliberate for this
   * one case: it is a programming error on our side, not an ownership
   * question, and it should look different in the logs.
   */
  if (!can(actor, 'course:manage-own')) {
    throw new ForbiddenError('You do not have access to this resource');
  }

  if (course.createdById !== actor.id) throw new NotFoundError(resource);
}

/**
 * The `where` fragment that scopes a query to the actor's own courses.
 *
 * Admins get `{}` — every course.  Everyone else is pinned to their own,
 * which means an instructor's list endpoints cannot return another
 * instructor's rows even if a filter is wrong, because the scope is applied
 * in SQL rather than filtered afterwards.
 */
export function courseOwnerScope(actor: AuthUser): { createdById?: string } {
  return isPlatformAdmin(actor) ? {} : { createdById: actor.id };
}
