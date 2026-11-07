import { describe, expect, it } from 'vitest';
import {
  can,
  canAll,
  canAny,
  canApplyToTeach,
  isActiveInstructor,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLES,
  type Permission,
  type PermissionPrincipal,
} from '@cadence/shared';

/**
 * The permission map is the one place the three roles are compared, so these
 * are the tests that stop a capability quietly moving between roles.
 */

const learner: PermissionPrincipal = { role: 'LEARNER', isActive: true };
const instructor: PermissionPrincipal = {
  role: 'INSTRUCTOR',
  isActive: true,
  instructorStatus: 'ACTIVE',
};
const suspended: PermissionPrincipal = {
  role: 'INSTRUCTOR',
  isActive: true,
  instructorStatus: 'SUSPENDED',
};
const admin: PermissionPrincipal = { role: 'ADMIN', isActive: true };

/** Everything a learner can do, which is the additive-roles guarantee. */
const LEARNER_CAPABILITIES: Permission[] = [
  'learn',
  'course:enroll',
  'progress:write',
  'dashboard:learner',
];

describe('permission map', () => {
  it('declares every role in the role table', () => {
    for (const role of ROLES) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
    }
  });

  it('only grants permissions that exist', () => {
    for (const role of ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(PERMISSIONS).toContain(permission);
      }
    }
  });

  it('is additive: INSTRUCTOR ⊇ LEARNER and ADMIN ⊇ INSTRUCTOR', () => {
    for (const permission of ROLE_PERMISSIONS.LEARNER) {
      expect(ROLE_PERMISSIONS.INSTRUCTOR).toContain(permission);
    }
    for (const permission of ROLE_PERMISSIONS.INSTRUCTOR) {
      expect(ROLE_PERMISSIONS.ADMIN).toContain(permission);
    }
  });

  it('gives ADMIN every permission', () => {
    for (const permission of PERMISSIONS) {
      expect(can(admin, permission)).toBe(true);
    }
  });
});

describe('can()', () => {
  it('denies everything to an anonymous caller', () => {
    for (const permission of PERMISSIONS) {
      expect(can(undefined, permission)).toBe(false);
      expect(can(null, permission)).toBe(false);
    }
  });

  it('denies everything to a deactivated account, whatever its role', () => {
    for (const permission of PERMISSIONS) {
      expect(can({ ...admin, isActive: false }, permission)).toBe(false);
      expect(can({ ...instructor, isActive: false }, permission)).toBe(false);
    }
  });

  it('withholds teaching from a learner', () => {
    expect(can(learner, 'instructor:dashboard')).toBe(false);
    expect(can(learner, 'course:create')).toBe(false);
    expect(can(learner, 'course:manage-own')).toBe(false);
    expect(can(learner, 'analytics:own-courses')).toBe(false);
  });

  it('withholds the admin area from an instructor', () => {
    expect(can(instructor, 'course:manage-any')).toBe(false);
    expect(can(instructor, 'application:review')).toBe(false);
    expect(can(instructor, 'instructor:manage')).toBe(false);
    expect(can(instructor, 'analytics:platform')).toBe(false);
    expect(can(instructor, 'user:manage')).toBe(false);
  });

  it('keeps every learner capability for an instructor', () => {
    expect(canAll(instructor, LEARNER_CAPABILITIES)).toBe(true);
  });

  it('keeps every learner capability for a SUSPENDED instructor', () => {
    // The whole point of suspension: teaching stops, learning does not.
    expect(canAll(suspended, LEARNER_CAPABILITIES)).toBe(true);
  });

  it('withdraws every teaching capability from a suspended instructor', () => {
    expect(can(suspended, 'instructor:dashboard')).toBe(false);
    expect(can(suspended, 'course:create')).toBe(false);
    expect(can(suspended, 'course:manage-own')).toBe(false);
    expect(can(suspended, 'lesson:manage-own')).toBe(false);
    expect(can(suspended, 'media:upload')).toBe(false);
    expect(can(suspended, 'analytics:own-courses')).toBe(false);
  });

  it('never applies instructor suspension to an admin', () => {
    // An admin has no instructor profile; a stray status must not disarm them.
    const oddAdmin: PermissionPrincipal = { ...admin, instructorStatus: 'SUSPENDED' };
    expect(can(oddAdmin, 'course:manage-any')).toBe(true);
    expect(can(oddAdmin, 'course:manage-own')).toBe(true);
  });

  it('treats a missing instructorStatus on an instructor as active', () => {
    expect(can({ role: 'INSTRUCTOR', isActive: true }, 'course:create')).toBe(true);
  });
});

describe('canAny / canAll', () => {
  it('canAny is true when one permission is held', () => {
    expect(canAny(learner, ['course:manage-any', 'learn'])).toBe(true);
    expect(canAny(learner, ['course:manage-any', 'application:review'])).toBe(false);
  });

  it('canAll requires all of them', () => {
    expect(canAll(instructor, ['learn', 'course:create'])).toBe(true);
    expect(canAll(instructor, ['learn', 'application:review'])).toBe(false);
  });

  it('is vacuously true for an empty list, and false for nobody', () => {
    expect(canAll(learner, [])).toBe(true);
    expect(canAny(learner, [])).toBe(false);
  });
});

describe('canApplyToTeach()', () => {
  it('offers the CTA to a learner with no pending application', () => {
    expect(canApplyToTeach(learner, false)).toBe(true);
  });

  it('hides it while an application is pending', () => {
    expect(canApplyToTeach(learner, true)).toBe(false);
  });

  it('hides it from an instructor, suspended or not', () => {
    expect(canApplyToTeach(instructor, false)).toBe(false);
    expect(canApplyToTeach(suspended, false)).toBe(false);
  });

  it('hides it from an admin', () => {
    expect(canApplyToTeach(admin, false)).toBe(false);
  });

  it('hides it from a signed-out visitor', () => {
    expect(canApplyToTeach(null, false)).toBe(false);
  });
});

describe('isActiveInstructor()', () => {
  it('distinguishes active from suspended from learner', () => {
    expect(isActiveInstructor(instructor)).toBe(true);
    expect(isActiveInstructor(suspended)).toBe(false);
    expect(isActiveInstructor(learner)).toBe(false);
    // An admin can reach the instructor workspace; they manage any course.
    expect(isActiveInstructor(admin)).toBe(true);
  });
});
