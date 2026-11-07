import type { InstructorProfileStatus, Role } from './enums.js';

/**
 * The permission model.
 *
 * Why a permission map rather than role comparisons: with three roles, every
 * `role === 'LEARNER'` check in the codebase is a latent bug, because an
 * instructor *is* a learner too and would silently lose a capability the
 * moment they were approved.  Asking `can(user, 'course:enroll')` instead
 * cannot go wrong that way — the grant is stated once, here, and the answer
 * is the same on the server and in the UI.
 *
 * Roles are additive by construction: `INSTRUCTOR ⊇ LEARNER` and
 * `ADMIN ⊇ INSTRUCTOR`, assembled below by spreading, so a permission added
 * to LEARNER is automatically held by the other two.
 */

export const PERMISSIONS = [
  // --- learner ------------------------------------------------------------
  /** The baseline every active account has: browse, enroll, watch, track. */
  'learn',
  'course:enroll',
  'progress:write',
  'dashboard:learner',
  /** Only a non-instructor without a pending application sees the CTA. */
  'instructor:apply',

  // --- instructor ---------------------------------------------------------
  'instructor:dashboard',
  'course:create',
  /** Scoped to courses the actor owns; the service enforces the scope. */
  'course:manage-own',
  'lesson:manage-own',
  'media:upload',
  'analytics:own-courses',

  // --- admin --------------------------------------------------------------
  'course:manage-any',
  'lesson:manage-any',
  'analytics:any-course',
  'analytics:platform',
  'application:review',
  'instructor:manage',
  'user:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Everything about *learning*, which every role keeps for good.
 *
 * This is the set the additive-roles guarantee is really about: approval
 * must never cost someone a learner capability, and suspension must never
 * touch one either.
 */
const LEARNING_PERMISSIONS = [
  'learn',
  'course:enroll',
  'progress:write',
  'dashboard:learner',
] as const satisfies readonly Permission[];

/**
 * `instructor:apply` is the deliberate exception to inheritance.
 *
 * Roles are additive for capabilities, but applying to teach is not a
 * capability you keep once you have it — an instructor has nothing to apply
 * for, and an admin already holds every teaching permission. Modelling it as
 * a learner-only grant means the entry point disappears by itself rather
 * than needing a `role !== 'INSTRUCTOR'` check beside every place it is
 * rendered.
 */
const LEARNER_PERMISSIONS = [
  ...LEARNING_PERMISSIONS,
  'instructor:apply',
] as const satisfies readonly Permission[];

const INSTRUCTOR_PERMISSIONS = [
  ...LEARNING_PERMISSIONS,
  'instructor:dashboard',
  'course:create',
  'course:manage-own',
  'lesson:manage-own',
  'media:upload',
  'analytics:own-courses',
] as const satisfies readonly Permission[];

const ADMIN_PERMISSIONS = [
  ...INSTRUCTOR_PERMISSIONS,
  'course:manage-any',
  'lesson:manage-any',
  'analytics:any-course',
  'analytics:platform',
  'application:review',
  'instructor:manage',
  'user:manage',
] as const satisfies readonly Permission[];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  LEARNER: LEARNER_PERMISSIONS,
  INSTRUCTOR: INSTRUCTOR_PERMISSIONS,
  ADMIN: ADMIN_PERMISSIONS,
};

/**
 * The permissions a suspended instructor loses.
 *
 * Suspension is not a demotion: the role stays INSTRUCTOR so the profile,
 * the courses and the history all survive, and only the teaching
 * capabilities are withheld.  Everything a learner can do is deliberately
 * absent from this list — that is what makes "you can still learn" true
 * rather than merely promised in the UI copy.
 */
const SUSPENDED_INSTRUCTOR_DENIES = [
  'instructor:dashboard',
  'course:create',
  'course:manage-own',
  'lesson:manage-own',
  'media:upload',
  'analytics:own-courses',
] as const satisfies readonly Permission[];

/**
 * An actor, reduced to what a permission decision needs.  Both the server's
 * `AuthUser` and the client's `me` payload satisfy it structurally, so there
 * is one implementation rather than one per side.
 */
export type PermissionPrincipal = {
  role: Role;
  isActive?: boolean;
  /** Absent for anyone who is not an instructor. */
  instructorStatus?: InstructorProfileStatus | null;
};

/**
 * Does this principal hold the permission?
 *
 * An admin is never affected by `instructorStatus`: admins have no instructor
 * profile, and suspending one would be a different feature.
 */
export function can(
  principal: PermissionPrincipal | null | undefined,
  permission: Permission,
): boolean {
  if (!principal) return false;
  // A deactivated account keeps its role but can do nothing at all.
  if (principal.isActive === false) return false;

  if (!ROLE_PERMISSIONS[principal.role]?.includes(permission)) return false;

  if (
    principal.role === 'INSTRUCTOR' &&
    principal.instructorStatus === 'SUSPENDED' &&
    (SUSPENDED_INSTRUCTOR_DENIES as readonly Permission[]).includes(permission)
  ) {
    return false;
  }

  return true;
}

/** True when every one of the permissions is held. */
export function canAll(
  principal: PermissionPrincipal | null | undefined,
  permissions: readonly Permission[],
): boolean {
  return permissions.every((permission) => can(principal, permission));
}

/** True when at least one of the permissions is held. */
export function canAny(
  principal: PermissionPrincipal | null | undefined,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((permission) => can(principal, permission));
}

/**
 * Whether the "Become an Instructor" entry point should be offered.
 *
 * Holding `instructor:apply` is necessary but not sufficient: an applicant
 * with a decision pending is shown "Application pending" instead. Only
 * LEARNER holds the permission at all, so instructors and admins fall out
 * of this without a role check of their own.
 */
export function canApplyToTeach(
  principal: PermissionPrincipal | null | undefined,
  hasPendingApplication: boolean,
): boolean {
  if (!can(principal, 'instructor:apply')) return false;
  return !hasPendingApplication;
}

/** True when the principal teaches and is not suspended. */
export function isActiveInstructor(
  principal: PermissionPrincipal | null | undefined,
): boolean {
  return can(principal, 'instructor:dashboard');
}
