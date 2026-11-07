import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import {
  createCourse,
  createInstructor,
  createUser,
  loginAs,
  resetDb,
} from '../helpers/factories.js';

/**
 * Phase A's guarantees, exercised over HTTP.
 *
 * Two things are being pinned down here, and both are security properties
 * rather than features:
 *
 *  1. **Ownership is enforced in the service.** Another instructor's course
 *     answers 404 — not 403 — so the workspace cannot be used to discover
 *     that a course exists at all.
 *  2. **Role and status changes take effect on the next request.** The
 *     access token is not reissued, nothing is logged out, and yet the
 *     answer changes, because `authenticate` re-reads the row every time.
 */
describe('ownership and live permissions', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('course ownership', () => {
    it('answers 404, not 403, for another instructor’s course', async () => {
      const alice = await createInstructor({ email: 'alice@test.dev' });
      const bob = await createInstructor({ email: 'bob@test.dev' });
      const { course } = await createCourse({
        ownerId: alice.user.id,
        status: 'DRAFT',
        title: 'Alice private draft',
      });

      const bobAgent = await loginAs('bob@test.dev');

      // Read.
      const read = await bobAgent.agent.get(`/api/v1/instructor/courses/${course.id}`);
      expect(read.status).toBe(404);
      // The body must not hint that the course is real.
      expect(JSON.stringify(read.body)).not.toContain('Alice private draft');

      // Write.
      const update = await bobAgent
        .withCsrf(bobAgent.agent.patch(`/api/v1/instructor/courses/${course.id}`))
        .send({ title: 'Stolen' });
      expect(update.status).toBe(404);

      // Publish.
      const publish = await bobAgent
        .withCsrf(bobAgent.agent.post(`/api/v1/instructor/courses/${course.id}/publish`))
        .send({});
      expect(publish.status).toBe(404);

      // Delete.
      const removed = await bobAgent.withCsrf(
        bobAgent.agent.delete(`/api/v1/instructor/courses/${course.id}`),
      );
      expect(removed.status).toBe(404);

      // Nothing changed.
      const after = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
      expect(after.title).toBe('Alice private draft');
      expect(after.status).toBe('DRAFT');
      expect(after.createdById).toBe(alice.user.id);
      expect(bob.user.id).not.toBe(alice.user.id);
    });

    it('lets the owner read and edit their own course', async () => {
      await createInstructor({ email: 'owner@test.dev' });
      const owner = await loginAs('owner@test.dev');
      const { course } = await createCourse({
        ownerId: owner.userId,
        status: 'DRAFT',
        title: 'My own draft',
      });

      const read = await owner.agent.get(`/api/v1/instructor/courses/${course.id}`);
      expect(read.status).toBe(200);
      expect(read.body.data.title).toBe('My own draft');

      const update = await owner
        .withCsrf(owner.agent.patch(`/api/v1/instructor/courses/${course.id}`))
        .send({ title: 'My own draft, renamed' });
      expect(update.status).toBe(200);
      expect(update.body.data.title).toBe('My own draft, renamed');
    });

    it('sets the owner from the session, ignoring any owner the client sends', async () => {
      const victim = await createInstructor({ email: 'victim@test.dev' });
      await createInstructor({ email: 'author@test.dev' });
      const author = await loginAs('author@test.dev');

      const created = await author
        .withCsrf(author.agent.post('/api/v1/instructor/courses'))
        .send({
          title: 'Mass assignment attempt',
          description:
            'A course whose body tries to claim a different owner, a published status and an elevated role.',
          shortDescription: 'Mass assignment attempt.',
          category: 'Engineering',
          thumbnailUrl: '/thumbnails/test.svg',
          difficulty: 'BEGINNER',
          // None of these may be honoured.
          createdById: victim.user.id,
          ownerId: victim.user.id,
          instructorId: victim.user.id,
          status: 'PUBLISHED',
          role: 'ADMIN',
        });

      expect(created.status).toBe(201);
      const row = await prisma.course.findUniqueOrThrow({
        where: { id: created.body.data.id as string },
      });
      expect(row.createdById).toBe(author.userId);
      expect(row.status).toBe('DRAFT');

      const authorRow = await prisma.user.findUniqueOrThrow({ where: { id: author.userId } });
      expect(authorRow.role).toBe('INSTRUCTOR');
    });

    it('cannot move a course to another owner through PATCH', async () => {
      const other = await createInstructor({ email: 'other@test.dev' });
      await createInstructor({ email: 'mine@test.dev' });
      const mine = await loginAs('mine@test.dev');
      const { course } = await createCourse({ ownerId: mine.userId, status: 'DRAFT' });

      const response = await mine
        .withCsrf(mine.agent.patch(`/api/v1/instructor/courses/${course.id}`))
        .send({ title: 'Renamed', createdById: other.user.id, ownerId: other.user.id });

      expect(response.status).toBe(200);
      const row = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
      expect(row.createdById).toBe(mine.userId);
    });

    it('lets an admin manage any instructor’s course', async () => {
      const alice = await createInstructor({ email: 'alice2@test.dev' });
      await createUser({ email: 'admin@test.dev', role: 'ADMIN' });
      const admin = await loginAs('admin@test.dev');
      const { course } = await createCourse({ ownerId: alice.user.id, status: 'DRAFT' });

      const read = await admin.agent.get(`/api/v1/admin/courses/${course.id}`);
      expect(read.status).toBe(200);
    });
  });

  describe('permissions take effect on the next request', () => {
    it('grants instructor access after approval without a new sign-in', async () => {
      const user = await createUser({ email: 'promoted@test.dev' });
      const agent = await loginAs('promoted@test.dev');

      // Before: a learner has no instructor workspace.
      expect((await agent.agent.get('/api/v1/instructor/dashboard')).status).toBe(403);

      // The approval, applied directly: this test is about the session, not
      // about the review flow, which has its own suite.
      await prisma.$transaction([
        prisma.user.update({ where: { id: user.id }, data: { role: 'INSTRUCTOR' } }),
        prisma.instructorProfile.create({
          data: {
            userId: user.id,
            displayName: 'Promoted User',
            title: 'Engineer',
            bio: 'A biography long enough to satisfy the schema minimum of eighty characters for an instructor profile.',
          },
        }),
      ]);

      // The very next request, on the same cookie jar, is allowed.
      expect((await agent.agent.get('/api/v1/instructor/dashboard')).status).toBe(200);
    });

    it('revokes instructor access on suspension while learning keeps working', async () => {
      const { user } = await createInstructor({ email: 'tosuspend@test.dev' });
      const agent = await loginAs('tosuspend@test.dev');

      expect((await agent.agent.get('/api/v1/instructor/dashboard')).status).toBe(200);

      await prisma.instructorProfile.update({
        where: { userId: user.id },
        data: {
          status: 'SUSPENDED',
          suspendedAt: new Date(),
          suspensionReason: 'Suspended for the purposes of this test.',
        },
      });

      // Teaching: refused on the next request, with a reason the UI can use.
      const refused = await agent.agent.get('/api/v1/instructor/dashboard');
      expect(refused.status).toBe(403);
      expect(refused.body.message).toMatch(/suspended/i);

      // Learning: entirely unaffected.
      expect((await agent.agent.get('/api/v1/dashboard/learner')).status).toBe(200);
      expect((await agent.agent.get('/api/v1/courses')).status).toBe(200);
      expect((await agent.agent.get('/api/v1/enrollments/me')).status).toBe(200);
      expect((await agent.agent.get('/api/v1/auth/me')).status).toBe(200);
    });

    it('restores access on reinstatement', async () => {
      const { user } = await createInstructor({
        email: 'toreinstate@test.dev',
        suspended: true,
      });
      const agent = await loginAs('toreinstate@test.dev');
      expect((await agent.agent.get('/api/v1/instructor/dashboard')).status).toBe(403);

      await prisma.instructorProfile.update({
        where: { userId: user.id },
        data: { status: 'ACTIVE', suspendedAt: null, suspensionReason: null },
      });

      expect((await agent.agent.get('/api/v1/instructor/dashboard')).status).toBe(200);
    });

    it('reports the instructor status on /auth/me so the client can react', async () => {
      await createInstructor({ email: 'me@test.dev' });
      const agent = await loginAs('me@test.dev');

      const me = await agent.agent.get('/api/v1/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.data.user.role).toBe('INSTRUCTOR');
      expect(me.body.data.user.instructorStatus).toBe('ACTIVE');
    });
  });

  describe('an instructor is not an administrator', () => {
    it('refuses every /admin route to an instructor', async () => {
      await createInstructor({ email: 'notadmin@test.dev' });
      const agent = await loginAs('notadmin@test.dev');

      const routes: [string, string][] = [
        ['get', '/api/v1/admin/courses'],
        ['get', '/api/v1/admin/users'],
        ['get', '/api/v1/admin/activity'],
        ['get', '/api/v1/dashboard/admin'],
        ['get', '/api/v1/admin/instructor-applications'],
        ['get', '/api/v1/admin/instructors'],
      ];

      for (const [method, path] of routes) {
        const response = await (method === 'get'
          ? agent.agent.get(path)
          : agent.agent.post(path));
        expect(
          response.status,
          `${method.toUpperCase()} ${path} should be refused`,
        ).toBe(403);
      }
    });
  });
});
