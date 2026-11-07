import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import {
  createApplication,
  createCourse,
  createInstructor,
  createUser,
  loginAs,
  resetDb,
  testApp,
} from '../helpers/factories.js';
import request from 'supertest';

/**
 * The learner-to-instructor workflow, end to end over HTTP.
 */

/** A body that satisfies every rule in the shared schema. */
const VALID_APPLICATION = {
  professionalTitle: 'Senior backend engineer',
  expertise: ['TypeScript', 'Node.js', 'API design'],
  experience:
    'Four years running internal TypeScript workshops for 40+ engineers, plus mentoring new hires through their first production API.',
  biography:
    'I build and maintain payment APIs used by small businesses across West Africa. I care about boring, reliable systems: typed boundaries, good error messages and tests that catch real bugs before customers do.',
  motivation:
    'I want to teach the whole loop: typed boundaries, tests, and running the thing in production where it actually matters.',
  portfolioUrl: 'https://ada.dev/talks',
};

describe('instructor applications', () => {
  beforeEach(async () => {
    await resetDb();
  });

  // =========================================================================
  describe('applying', () => {
    it('lets a learner apply, and reports PENDING afterwards', async () => {
      await createUser({ email: 'ada@test.dev', firstName: 'Ada', lastName: 'Okafor' });
      const ada = await loginAs('ada@test.dev');

      const before = await ada.agent.get('/api/v1/instructor-applications/me');
      expect(before.status).toBe(200);
      expect(before.body.data.status).toBe('NOT_APPLIED');
      expect(before.body.data.application).toBeNull();

      const applied = await ada
        .withCsrf(ada.agent.post('/api/v1/instructor-applications'))
        .send(VALID_APPLICATION);
      expect(applied.status).toBe(201);
      expect(applied.body.data.status).toBe('PENDING');
      expect(applied.body.data.application.professionalTitle).toBe(
        'Senior backend engineer',
      );

      // A SUBMITTED event was recorded, not just a status field.
      const events = await prisma.instructorApplicationEvent.findMany({
        where: { userId: ada.userId },
      });
      expect(events).toHaveLength(1);
      expect(events[0]!.action).toBe('SUBMITTED');
      expect(events[0]!.toStatus).toBe('PENDING');

      // The applicant is notified, and so is every admin.
      const mine = await prisma.notification.findMany({ where: { userId: ada.userId } });
      expect(mine.map((row) => row.type)).toContain('APPLICATION_SUBMITTED');
    });

    it('notifies every admin that an application arrived', async () => {
      await createUser({ email: 'admin1@test.dev', role: 'ADMIN' });
      await createUser({ email: 'admin2@test.dev', role: 'ADMIN' });
      await createUser({ email: 'applicant@test.dev' });
      const applicant = await loginAs('applicant@test.dev');

      await applicant
        .withCsrf(applicant.agent.post('/api/v1/instructor-applications'))
        .send(VALID_APPLICATION);

      const adminNotifications = await prisma.notification.findMany({
        where: { type: 'APPLICATION_RECEIVED' },
      });
      expect(adminNotifications).toHaveLength(2);
    });

    it('refuses a second active application with 409', async () => {
      await createUser({ email: 'dup@test.dev' });
      const agent = await loginAs('dup@test.dev');

      const first = await agent
        .withCsrf(agent.agent.post('/api/v1/instructor-applications'))
        .send(VALID_APPLICATION);
      expect(first.status).toBe(201);

      const second = await agent
        .withCsrf(agent.agent.post('/api/v1/instructor-applications'))
        .send(VALID_APPLICATION);
      expect(second.status).toBe(409);

      expect(
        await prisma.instructorApplication.count({ where: { userId: agent.userId } }),
      ).toBe(1);
    });

    it('is protected by the database index, not only by the service check', async () => {
      const user = await createUser({ email: 'race@test.dev' });
      await createApplication(user.id);

      // Bypasses the service entirely: this is the index under test.
      await expect(
        prisma.instructorApplication.create({
          data: {
            userId: user.id,
            professionalTitle: 'Second pending',
            expertise: ['X'],
            experience: 'x'.repeat(50),
            biography: 'b'.repeat(100),
            motivation: 'm'.repeat(60),
            status: 'PENDING',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('survives two simultaneous submissions with one success and one 409', async () => {
      await createUser({ email: 'double@test.dev' });
      const agent = await loginAs('double@test.dev');

      const [a, b] = await Promise.all([
        agent
          .withCsrf(agent.agent.post('/api/v1/instructor-applications'))
          .send(VALID_APPLICATION),
        agent
          .withCsrf(agent.agent.post('/api/v1/instructor-applications'))
          .send(VALID_APPLICATION),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);
      expect(
        await prisma.instructorApplication.count({ where: { userId: agent.userId } }),
      ).toBe(1);
    });

    it('validates the body against the shared schema', async () => {
      await createUser({ email: 'invalid@test.dev' });
      const agent = await loginAs('invalid@test.dev');

      const response = await agent
        .withCsrf(agent.agent.post('/api/v1/instructor-applications'))
        .send({
          ...VALID_APPLICATION,
          motivation: 'Too short.',
          expertise: [],
          portfolioUrl: 'http://insecure.example.com',
        });

      expect(response.status).toBe(400);
      expect(Object.keys(response.body.errors)).toEqual(
        expect.arrayContaining(['motivation', 'expertise', 'portfolioUrl']),
      );
    });

    it('never takes the applicant’s name or email from the body', async () => {
      await createUser({
        email: 'real@test.dev',
        firstName: 'Real',
        lastName: 'Person',
      });
      const agent = await loginAs('real@test.dev');

      await agent.withCsrf(agent.agent.post('/api/v1/instructor-applications')).send({
        ...VALID_APPLICATION,
        firstName: 'Spoofed',
        lastName: 'Identity',
        email: 'attacker@evil.test',
        userId: '00000000-0000-0000-0000-000000000000',
        status: 'APPROVED',
      });

      const row = await prisma.instructorApplication.findFirstOrThrow({
        where: { userId: agent.userId },
      });
      expect(row.status).toBe('PENDING');
      expect(row.userId).toBe(agent.userId);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: agent.userId } });
      expect(user.firstName).toBe('Real');
      expect(user.email).toBe('real@test.dev');
      expect(user.role).toBe('LEARNER');
    });

    it('refuses an application from someone who already teaches', async () => {
      await createInstructor({ email: 'already@test.dev' });
      const agent = await loginAs('already@test.dev');

      const response = await agent
        .withCsrf(agent.agent.post('/api/v1/instructor-applications'))
        .send(VALID_APPLICATION);
      expect(response.status).toBe(403);
    });
  });

  // =========================================================================
  describe('editing and withdrawing', () => {
    it('lets the applicant edit a pending application and records the edit', async () => {
      const user = await createUser({ email: 'editor@test.dev' });
      await createApplication(user.id);
      const agent = await loginAs('editor@test.dev');

      const response = await agent
        .withCsrf(agent.agent.patch('/api/v1/instructor-applications/me'))
        .send({ professionalTitle: 'Staff backend engineer' });

      expect(response.status).toBe(200);
      expect(response.body.data.application.professionalTitle).toBe(
        'Staff backend engineer',
      );

      const events = await prisma.instructorApplicationEvent.findMany({
        where: { userId: user.id, action: 'UPDATED' },
      });
      expect(events).toHaveLength(1);
    });

    it('lets the applicant withdraw, keeping the row as history', async () => {
      const user = await createUser({ email: 'withdrawer@test.dev' });
      const application = await createApplication(user.id);
      const agent = await loginAs('withdrawer@test.dev');

      const response = await agent.withCsrf(
        agent.agent.post('/api/v1/instructor-applications/me/withdraw'),
      );
      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('WITHDRAWN');

      const row = await prisma.instructorApplication.findUniqueOrThrow({
        where: { id: application.id },
      });
      expect(row.status).toBe('WITHDRAWN');

      const events = await prisma.instructorApplicationEvent.findMany({
        where: { applicationId: application.id, action: 'WITHDRAWN' },
      });
      expect(events).toHaveLength(1);
    });

    it('cannot edit an application that has been decided', async () => {
      const user = await createUser({ email: 'decided@test.dev' });
      await createApplication(user.id, { status: 'REJECTED' });
      const agent = await loginAs('decided@test.dev');

      const response = await agent
        .withCsrf(agent.agent.patch('/api/v1/instructor-applications/me'))
        .send({ professionalTitle: 'Too late' });
      expect(response.status).toBe(404);
    });

    it('lets a withdrawn applicant apply again straight away', async () => {
      const user = await createUser({ email: 'again@test.dev' });
      await createApplication(user.id, { status: 'WITHDRAWN' });
      const agent = await loginAs('again@test.dev');

      const response = await agent
        .withCsrf(agent.agent.post('/api/v1/instructor-applications'))
        .send(VALID_APPLICATION);
      expect(response.status).toBe(201);
      expect(
        await prisma.instructorApplication.count({ where: { userId: user.id } }),
      ).toBe(2);
    });
  });

  // =========================================================================
  describe('the reapply cooldown', () => {
    it('refuses a reapplication while the cooldown is running', async () => {
      const user = await createUser({ email: 'cooldown@test.dev' });
      await prisma.instructorApplication.create({
        data: {
          userId: user.id,
          professionalTitle: 'Rejected applicant',
          expertise: ['X'],
          experience: 'x'.repeat(50),
          biography: 'b'.repeat(100),
          motivation: 'm'.repeat(60),
          status: 'REJECTED',
          decisionReason: 'Not this time.',
          decidedAt: new Date(),
        },
      });
      const agent = await loginAs('cooldown@test.dev');

      const status = await agent.agent.get('/api/v1/instructor-applications/me');
      expect(status.body.data.status).toBe('REJECTED');
      expect(status.body.data.canReapplyNow).toBe(false);
      expect(status.body.data.canReapplyAt).toBeTruthy();

      const response = await agent
        .withCsrf(agent.agent.post('/api/v1/instructor-applications'))
        .send(VALID_APPLICATION);
      expect(response.status).toBe(422);
    });

    it('allows it once the cooldown has elapsed', async () => {
      const user = await createUser({ email: 'elapsed@test.dev' });
      const longAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
      await prisma.instructorApplication.create({
        data: {
          userId: user.id,
          professionalTitle: 'Rejected long ago',
          expertise: ['X'],
          experience: 'x'.repeat(50),
          biography: 'b'.repeat(100),
          motivation: 'm'.repeat(60),
          status: 'REJECTED',
          decisionReason: 'Not then.',
          decidedAt: longAgo,
        },
      });
      const agent = await loginAs('elapsed@test.dev');

      const status = await agent.agent.get('/api/v1/instructor-applications/me');
      expect(status.body.data.canReapplyNow).toBe(true);

      const response = await agent
        .withCsrf(agent.agent.post('/api/v1/instructor-applications'))
        .send(VALID_APPLICATION);
      expect(response.status).toBe(201);
    });
  });

  // =========================================================================
  describe('admin review', () => {
    it('approves: role changes, profile is created, event and notification recorded', async () => {
      const applicant = await createUser({
        email: 'approveme@test.dev',
        firstName: 'Kemi',
        lastName: 'Adeyemi',
      });
      const application = await createApplication(applicant.id);
      await createUser({ email: 'admin@test.dev', role: 'ADMIN' });
      const admin = await loginAs('admin@test.dev');

      const response = await admin
        .withCsrf(
          admin.agent.post(
            `/api/v1/admin/instructor-applications/${application.id}/approve`,
          ),
        )
        .send({ reason: 'Strong portfolio.' });
      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('APPROVED');

      const user = await prisma.user.findUniqueOrThrow({ where: { id: applicant.id } });
      expect(user.role).toBe('INSTRUCTOR');

      const profile = await prisma.instructorProfile.findUniqueOrThrow({
        where: { userId: applicant.id },
      });
      expect(profile.status).toBe('ACTIVE');
      expect(profile.displayName).toBe('Kemi Adeyemi');
      expect(profile.title).toBe('Senior backend engineer');

      const event = await prisma.instructorApplicationEvent.findFirstOrThrow({
        where: { applicationId: application.id, action: 'APPROVED' },
      });
      expect(event.actorId).toBe(admin.userId);
      expect(event.fromStatus).toBe('PENDING');
      expect(event.toStatus).toBe('APPROVED');

      const notification = await prisma.notification.findFirstOrThrow({
        where: { userId: applicant.id, type: 'APPLICATION_APPROVED' },
      });
      expect(notification.link).toBe('/instructor');
    });

    it('rejects: the role is unchanged and the reason is stored', async () => {
      const applicant = await createUser({ email: 'rejectme@test.dev' });
      const application = await createApplication(applicant.id);
      await createUser({ email: 'admin@test.dev', role: 'ADMIN' });
      const admin = await loginAs('admin@test.dev');

      const response = await admin
        .withCsrf(
          admin.agent.post(
            `/api/v1/admin/instructor-applications/${application.id}/reject`,
          ),
        )
        .send({ reason: 'We already have two Node.js API courses this quarter.' });
      expect(response.status).toBe(200);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: applicant.id } });
      expect(user.role).toBe('LEARNER');
      expect(
        await prisma.instructorProfile.findUnique({ where: { userId: applicant.id } }),
      ).toBeNull();

      const row = await prisma.instructorApplication.findUniqueOrThrow({
        where: { id: application.id },
      });
      expect(row.status).toBe('REJECTED');
      expect(row.decisionReason).toContain('two Node.js API courses');
    });

    it('requires a reason to reject', async () => {
      const applicant = await createUser({ email: 'noreason@test.dev' });
      const application = await createApplication(applicant.id);
      await createUser({ email: 'admin@test.dev', role: 'ADMIN' });
      const admin = await loginAs('admin@test.dev');

      const response = await admin
        .withCsrf(
          admin.agent.post(
            `/api/v1/admin/instructor-applications/${application.id}/reject`,
          ),
        )
        .send({ reason: '' });
      expect(response.status).toBe(400);
      expect(response.body.errors.reason).toBeDefined();
    });

    it('resolves two simultaneous decisions as one success and one 409', async () => {
      const applicant = await createUser({ email: 'contended@test.dev' });
      const application = await createApplication(applicant.id);
      await createUser({ email: 'admin1@test.dev', role: 'ADMIN' });
      await createUser({ email: 'admin2@test.dev', role: 'ADMIN' });
      const one = await loginAs('admin1@test.dev');
      const two = await loginAs('admin2@test.dev');

      const [a, b] = await Promise.all([
        one
          .withCsrf(
            one.agent.post(
              `/api/v1/admin/instructor-applications/${application.id}/approve`,
            ),
          )
          .send({}),
        two
          .withCsrf(
            two.agent.post(
              `/api/v1/admin/instructor-applications/${application.id}/reject`,
            ),
          )
          .send({ reason: 'Rejecting at the very same moment.' }),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([200, 409]);

      // Exactly one decision event exists, so no decision was lost or doubled.
      const decisions = await prisma.instructorApplicationEvent.findMany({
        where: {
          applicationId: application.id,
          action: { in: ['APPROVED', 'REJECTED'] },
        },
      });
      expect(decisions).toHaveLength(1);
    });

    it('refuses a decision on an already-decided application', async () => {
      const applicant = await createUser({ email: 'twice@test.dev' });
      const application = await createApplication(applicant.id, { status: 'APPROVED' });
      await createUser({ email: 'admin@test.dev', role: 'ADMIN' });
      const admin = await loginAs('admin@test.dev');

      const response = await admin
        .withCsrf(
          admin.agent.post(
            `/api/v1/admin/instructor-applications/${application.id}/approve`,
          ),
        )
        .send({});
      expect(response.status).toBe(409);
    });

    it('will not let an admin approve their own application', async () => {
      const admin = await createUser({ email: 'selfadmin@test.dev', role: 'ADMIN' });
      const application = await createApplication(admin.id);
      const agent = await loginAs('selfadmin@test.dev');

      const response = await agent
        .withCsrf(
          agent.agent.post(
            `/api/v1/admin/instructor-applications/${application.id}/approve`,
          ),
        )
        .send({});
      expect(response.status).toBe(403);

      const row = await prisma.instructorApplication.findUniqueOrThrow({
        where: { id: application.id },
      });
      expect(row.status).toBe('PENDING');
    });

    it('will not let an applicant approve anything', async () => {
      const applicant = await createUser({ email: 'sneaky@test.dev' });
      const application = await createApplication(applicant.id);
      const agent = await loginAs('sneaky@test.dev');

      const response = await agent
        .withCsrf(
          agent.agent.post(
            `/api/v1/admin/instructor-applications/${application.id}/approve`,
          ),
        )
        .send({});
      expect(response.status).toBe(403);

      const row = await prisma.instructorApplication.findUniqueOrThrow({
        where: { id: application.id },
      });
      expect(row.status).toBe('PENDING');
    });

    it('keeps internal notes away from the applicant', async () => {
      const applicant = await createUser({ email: 'noted@test.dev' });
      const application = await createApplication(applicant.id);
      await createUser({ email: 'admin@test.dev', role: 'ADMIN' });
      const admin = await loginAs('admin@test.dev');

      const SECRET = 'Check the overlap with the existing accessibility course first.';
      const added = await admin
        .withCsrf(
          admin.agent.post(
            `/api/v1/admin/instructor-applications/${application.id}/notes`,
          ),
        )
        .send({ note: SECRET });
      expect(added.status).toBe(200);

      // The admin sees it.
      const adminView = await admin.agent.get(
        `/api/v1/admin/instructor-applications/${application.id}`,
      );
      expect(JSON.stringify(adminView.body)).toContain(SECRET);

      // The applicant does not — not the note, and not the NOTE_ADDED event.
      const applicantAgent = await loginAs('noted@test.dev');
      const applicantView = await applicantAgent.agent.get(
        '/api/v1/instructor-applications/me',
      );
      expect(applicantView.status).toBe(200);
      expect(JSON.stringify(applicantView.body)).not.toContain(SECRET);
      expect(
        (applicantView.body.data.history as { action: string }[]).map((e) => e.action),
      ).not.toContain('NOTE_ADDED');
    });

    it('lists and filters applications for the admin queue', async () => {
      const a = await createUser({ email: 'queue-a@test.dev', firstName: 'Ada' });
      const b = await createUser({ email: 'queue-b@test.dev', firstName: 'Kemi' });
      const c = await createUser({ email: 'queue-c@test.dev', firstName: 'Yusuf' });
      await createApplication(a.id);
      await createApplication(b.id, { title: 'Lead product designer' });
      await createApplication(c.id, { status: 'REJECTED' });
      await createUser({ email: 'admin@test.dev', role: 'ADMIN' });
      const admin = await loginAs('admin@test.dev');

      const pending = await admin.agent.get(
        '/api/v1/admin/instructor-applications?status=PENDING',
      );
      expect(pending.status).toBe(200);
      expect(pending.body.data).toHaveLength(2);
      expect(pending.body.meta.counts).toMatchObject({
        PENDING: 2,
        REJECTED: 1,
        ALL: 3,
      });

      const searched = await admin.agent.get(
        '/api/v1/admin/instructor-applications?search=designer',
      );
      expect(searched.body.data).toHaveLength(1);
      expect(searched.body.data[0].applicant.firstName).toBe('Kemi');
    });
  });

  // =========================================================================
  describe('suspension and reinstatement', () => {
    it('suspends with a reason, records the event and notifies', async () => {
      const { user } = await createInstructor({ email: 'suspendee@test.dev' });
      await createUser({ email: 'admin@test.dev', role: 'ADMIN' });
      const admin = await loginAs('admin@test.dev');

      const response = await admin
        .withCsrf(admin.agent.post(`/api/v1/admin/instructors/${user.id}/suspend`))
        .send({ reason: 'Two lessons use third-party video without permission.' });
      expect(response.status).toBe(200);

      const profile = await prisma.instructorProfile.findUniqueOrThrow({
        where: { userId: user.id },
      });
      expect(profile.status).toBe('SUSPENDED');
      expect(profile.suspendedById).toBe(admin.userId);
      expect(profile.suspensionReason).toContain('third-party video');

      // The role is untouched: suspension is not a demotion.
      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.role).toBe('INSTRUCTOR');

      await prisma.instructorApplicationEvent.findFirstOrThrow({
        where: { userId: user.id, action: 'SUSPENDED' },
      });
      await prisma.notification.findFirstOrThrow({
        where: { userId: user.id, type: 'INSTRUCTOR_SUSPENDED' },
      });
    });

    it('requires a reason to suspend', async () => {
      const { user } = await createInstructor({ email: 'noreasonsusp@test.dev' });
      await createUser({ email: 'admin@test.dev', role: 'ADMIN' });
      const admin = await loginAs('admin@test.dev');

      const response = await admin
        .withCsrf(admin.agent.post(`/api/v1/admin/instructors/${user.id}/suspend`))
        .send({});
      expect(response.status).toBe(400);
    });

    it('reinstates, clearing the suspension fields', async () => {
      const { user } = await createInstructor({
        email: 'reinstatee@test.dev',
        suspended: true,
      });
      await createUser({ email: 'admin@test.dev', role: 'ADMIN' });
      const admin = await loginAs('admin@test.dev');

      const response = await admin
        .withCsrf(admin.agent.post(`/api/v1/admin/instructors/${user.id}/reinstate`))
        .send({ reason: 'Videos replaced.' });
      expect(response.status).toBe(200);

      const profile = await prisma.instructorProfile.findUniqueOrThrow({
        where: { userId: user.id },
      });
      expect(profile.status).toBe('ACTIVE');
      expect(profile.suspendedAt).toBeNull();
      expect(profile.suspensionReason).toBeNull();

      await prisma.instructorApplicationEvent.findFirstOrThrow({
        where: { userId: user.id, action: 'REINSTATED' },
      });
    });

    it('refuses to suspend an already-suspended instructor', async () => {
      const { user } = await createInstructor({
        email: 'already-susp@test.dev',
        suspended: true,
      });
      await createUser({ email: 'admin@test.dev', role: 'ADMIN' });
      const admin = await loginAs('admin@test.dev');

      const response = await admin
        .withCsrf(admin.agent.post(`/api/v1/admin/instructors/${user.id}/suspend`))
        .send({ reason: 'Suspending a second time should be refused.' });
      expect(response.status).toBe(409);
    });

    it('lists instructors with their course and learner counts', async () => {
      const { user } = await createInstructor({ email: 'counted@test.dev' });
      await createCourse({ ownerId: user.id, status: 'PUBLISHED' });
      await createCourse({ ownerId: user.id, status: 'DRAFT' });
      await createInstructor({ email: 'suspended@test.dev', suspended: true });
      await createUser({ email: 'admin@test.dev', role: 'ADMIN' });
      const admin = await loginAs('admin@test.dev');

      const response = await admin.agent.get('/api/v1/admin/instructors');
      expect(response.status).toBe(200);
      expect(response.body.meta.counts).toMatchObject({
        ACTIVE: 1,
        SUSPENDED: 1,
        ALL: 2,
      });

      const counted = (response.body.data as { email: string; totalCourses: number }[]).find(
        (row) => row.email === 'counted@test.dev',
      );
      expect(counted?.totalCourses).toBe(2);
    });
  });

  // =========================================================================
  describe('mass assignment', () => {
    it('ignores a role sent to register', async () => {
      const agent = request.agent(testApp());
      const response = await agent.post('/api/v1/auth/register').send({
        firstName: 'Climbing',
        lastName: 'Privileges',
        email: 'climber@test.dev',
        password: 'Password123',
        confirmPassword: 'Password123',
        role: 'ADMIN',
      });
      expect(response.status).toBe(201);
      expect(response.body.data.user.role).toBe('LEARNER');

      const row = await prisma.user.findUniqueOrThrow({
        where: { email: 'climber@test.dev' },
      });
      expect(row.role).toBe('LEARNER');
    });

    it('ignores role and status sent to the profile endpoint', async () => {
      await createUser({ email: 'profile@test.dev' });
      const agent = await loginAs('profile@test.dev');

      const response = await agent
        .withCsrf(agent.agent.patch('/api/v1/auth/me'))
        .send({
          firstName: 'Still',
          lastName: 'ALearner',
          role: 'ADMIN',
          isActive: true,
          instructorStatus: 'ACTIVE',
        });
      expect(response.status).toBe(200);

      const row = await prisma.user.findUniqueOrThrow({ where: { id: agent.userId } });
      expect(row.role).toBe('LEARNER');
      expect(
        await prisma.instructorProfile.findUnique({ where: { userId: agent.userId } }),
      ).toBeNull();
    });
  });
});
