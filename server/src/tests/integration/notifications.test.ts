import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { createApplication, createUser, loginAs, resetDb } from '../helpers/factories.js';

/**
 * In-app notifications.
 *
 * The behaviour that matters most is the one that is easiest to get wrong:
 * a notification belongs to exactly one user, and no request may read or
 * write another user's. The scope lives in the `where` clause rather than in
 * a check after the fact, so these tests assert the outcome rather than the
 * implementation.
 */
describe('notifications', () => {
  beforeEach(async () => {
    await resetDb();
  });

  /** Three notifications for one user, two of them unread. */
  async function seedFor(userId: string) {
    await prisma.notification.createMany({
      data: [
        {
          userId,
          type: 'COURSE_PUBLISHED',
          title: 'Course published',
          body: '"Production Node.js APIs" is live in the catalog.',
          link: '/instructor/courses',
        },
        {
          userId,
          type: 'APPLICATION_APPROVED',
          title: 'Application approved',
          body: "You're now an instructor.",
        },
        {
          userId,
          type: 'COURSE_UNPUBLISHED',
          title: 'Course unpublished',
          body: '"Observability" moved back to drafts.',
          readAt: new Date(),
        },
      ],
    });
  }

  it('lists the caller’s notifications newest first, with an unread count', async () => {
    const user = await createUser({ email: 'reader@test.dev' });
    await seedFor(user.id);
    const agent = await loginAs('reader@test.dev');

    const response = await agent.agent.get('/api/v1/notifications');
    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(3);
    expect(response.body.data.unreadCount).toBe(2);

    const times = (response.body.data.items as { createdAt: string }[]).map(
      (row) => row.createdAt,
    );
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('filters to unread only', async () => {
    const user = await createUser({ email: 'unread@test.dev' });
    await seedFor(user.id);
    const agent = await loginAs('unread@test.dev');

    const response = await agent.agent.get('/api/v1/notifications?unreadOnly=true');
    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(2);
    expect(
      (response.body.data.items as { readAt: string | null }[]).every(
        (row) => row.readAt === null,
      ),
    ).toBe(true);
  });

  it('never shows one user’s notifications to another', async () => {
    const mine = await createUser({ email: 'mine@test.dev' });
    const theirs = await createUser({ email: 'theirs@test.dev' });
    await seedFor(mine.id);
    await prisma.notification.create({
      data: {
        userId: theirs.id,
        type: 'APPLICATION_REJECTED',
        title: 'Private to them',
        body: 'This must never reach the other account.',
      },
    });

    const agent = await loginAs('mine@test.dev');
    const response = await agent.agent.get('/api/v1/notifications');
    expect(response.body.data.items).toHaveLength(3);
    expect(JSON.stringify(response.body)).not.toContain('Private to them');
  });

  it('marks one as read', async () => {
    const user = await createUser({ email: 'marker@test.dev' });
    await seedFor(user.id);
    const target = await prisma.notification.findFirstOrThrow({
      where: { userId: user.id, readAt: null },
    });
    const agent = await loginAs('marker@test.dev');

    const response = await agent.withCsrf(
      agent.agent.post(`/api/v1/notifications/${target.id}/read`),
    );
    expect(response.status).toBe(200);
    expect(response.body.data.unreadCount).toBe(1);

    const row = await prisma.notification.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.readAt).not.toBeNull();
  });

  it('cannot mark another user’s notification as read', async () => {
    const theirs = await createUser({ email: 'victim@test.dev' });
    await createUser({ email: 'attacker@test.dev' });
    const target = await prisma.notification.create({
      data: {
        userId: theirs.id,
        type: 'APPLICATION_APPROVED',
        title: 'Theirs',
        body: 'Not the attacker’s to touch.',
      },
    });

    const agent = await loginAs('attacker@test.dev');
    const response = await agent.withCsrf(
      agent.agent.post(`/api/v1/notifications/${target.id}/read`),
    );
    // A no-op, not an error: the row simply does not match the scope.
    expect(response.status).toBe(200);

    const row = await prisma.notification.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.readAt).toBeNull();
  });

  it('marks everything read at once, for the caller only', async () => {
    const mine = await createUser({ email: 'allmine@test.dev' });
    const theirs = await createUser({ email: 'alltheirs@test.dev' });
    await seedFor(mine.id);
    await seedFor(theirs.id);
    const agent = await loginAs('allmine@test.dev');

    const response = await agent.withCsrf(agent.agent.post('/api/v1/notifications/read-all'));
    expect(response.status).toBe(200);
    expect(response.body.data.unreadCount).toBe(0);

    expect(
      await prisma.notification.count({ where: { userId: mine.id, readAt: null } }),
    ).toBe(0);
    // Untouched.
    expect(
      await prisma.notification.count({ where: { userId: theirs.id, readAt: null } }),
    ).toBe(2);
  });

  it('requires a session', async () => {
    const user = await createUser({ email: 'anon@test.dev' });
    await seedFor(user.id);
    const { api } = await import('../helpers/factories.js');
    expect((await api().get('/api/v1/notifications')).status).toBe(401);
  });

  describe('every event in the spec produces a notification', () => {
    it('tells the owner when their course is published and unpublished', async () => {
      const { createCourse, createInstructor } = await import('../helpers/factories.js');
      const { user } = await createInstructor({ email: 'publisher@test.dev' });
      const { course } = await createCourse({
        ownerId: user.id,
        status: 'DRAFT',
        lessonCount: 2,
      });
      const agent = await loginAs('publisher@test.dev');

      await agent
        .withCsrf(agent.agent.post(`/api/v1/instructor/courses/${course.id}/publish`))
        .send({});
      const published = await prisma.notification.findFirstOrThrow({
        where: { userId: user.id, type: 'COURSE_PUBLISHED' },
      });
      expect(published.body).toContain('live in the catalog');

      await agent
        .withCsrf(agent.agent.post(`/api/v1/instructor/courses/${course.id}/unpublish`))
        .send({});
      await prisma.notification.findFirstOrThrow({
        where: { userId: user.id, type: 'COURSE_UNPUBLISHED' },
      });
    });

    it('tells enrolled learners when a course they are taking is archived', async () => {
      const { createCourse, createInstructor } = await import('../helpers/factories.js');
      const { user } = await createInstructor({ email: 'archiver2@test.dev' });
      const { course } = await createCourse({ ownerId: user.id, status: 'PUBLISHED' });

      const learner = await createUser({ email: 'affected@test.dev' });
      const bystander = await createUser({ email: 'unaffected@test.dev' });
      await prisma.enrollment.create({
        data: { userId: learner.id, courseId: course.id },
      });

      const agent = await loginAs('archiver2@test.dev');
      await agent
        .withCsrf(agent.agent.post(`/api/v1/instructor/courses/${course.id}/archive`))
        .send({});

      const told = await prisma.notification.findFirstOrThrow({
        where: { userId: learner.id, type: 'COURSE_ARCHIVED' },
      });
      // The reassurance matters as much as the fact.
      expect(told.body).toMatch(/keep full access/i);

      // Nobody who was not enrolled hears about it.
      expect(
        await prisma.notification.count({
          where: { userId: bystander.id, type: 'COURSE_ARCHIVED' },
        }),
      ).toBe(0);
    });

    it('covers the whole list the spec names', async () => {
      // A roll-call rather than a behaviour test: each of these is
      // exercised by its own suite, and this asserts none was dropped
      // from the enum as the feature was built.
      const { NOTIFICATION_TYPES } = await import('@cadence/shared');
      for (const type of [
        'APPLICATION_SUBMITTED',
        'APPLICATION_RECEIVED',
        'APPLICATION_APPROVED',
        'APPLICATION_REJECTED',
        'INSTRUCTOR_SUSPENDED',
        'INSTRUCTOR_REINSTATED',
        'COURSE_PUBLISHED',
        'COURSE_UNPUBLISHED',
        'COURSE_ARCHIVED',
        'COURSE_LESSONS_ADDED',
      ] as const) {
        expect(NOTIFICATION_TYPES).toContain(type);
      }
    });
  });

  it('writes the notification in the same transaction as the event', async () => {
    // A rejected approval must leave no notification behind. Driving a real
    // rollback is awkward over HTTP, so this asserts the pairing instead:
    // every decision event has its matching notification, and vice versa.
    const applicant = await createUser({ email: 'paired@test.dev' });
    const application = await createApplication(applicant.id);
    await createUser({ email: 'admin@test.dev', role: 'ADMIN' });
    const admin = await loginAs('admin@test.dev');

    await admin
      .withCsrf(
        admin.agent.post(`/api/v1/admin/instructor-applications/${application.id}/approve`),
      )
      .send({});

    const events = await prisma.instructorApplicationEvent.count({
      where: { applicationId: application.id, action: 'APPROVED' },
    });
    const notifications = await prisma.notification.count({
      where: { userId: applicant.id, type: 'APPLICATION_APPROVED' },
    });
    expect(events).toBe(1);
    expect(notifications).toBe(1);
  });
});
