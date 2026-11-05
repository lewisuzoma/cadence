import { beforeEach, describe, expect, it } from 'vitest';
import { createCourse, createUser, loginAs, resetDb } from '../helpers/factories.js';

/**
 * Role and object-level authorization.
 *
 * Every admin route is checked with a learner's session, because "the UI
 * hides the link" is not authorization — the server has to refuse.
 */
describe('authorization', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('returns 403 for a learner on every admin route', async () => {
    await createUser({ email: 'learner@test.dev' });
    const { course, module, lessons } = await createCourse();
    const session = await loginAs('learner@test.dev');
    const { agent, withCsrf } = session;
    const id = course.id;

    const reads = [
      '/api/v1/admin/courses',
      `/api/v1/admin/courses/${id}`,
      '/api/v1/admin/users',
      `/api/v1/admin/users/${session.userId}`,
      `/api/v1/admin/users/${session.userId}/progress`,
      `/api/v1/admin/courses/${id}/learners`,
      '/api/v1/admin/activity',
      '/api/v1/dashboard/admin',
    ];
    for (const path of reads) {
      const response = await agent.get(path);
      expect(response.status, `GET ${path}`).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN');
    }

    const writes: [string, string, object][] = [
      ['post', '/api/v1/admin/courses', { title: 'x' }],
      ['patch', `/api/v1/admin/courses/${id}`, { title: 'x' }],
      ['delete', `/api/v1/admin/courses/${id}`, {}],
      ['patch', `/api/v1/admin/courses/${id}/status`, { status: 'PUBLISHED' }],
      ['post', `/api/v1/admin/courses/${id}/modules`, { title: 'x' }],
      ['patch', `/api/v1/admin/modules/${module.id}`, { title: 'x' }],
      ['delete', `/api/v1/admin/modules/${module.id}`, {}],
      ['post', `/api/v1/admin/modules/${module.id}/lessons`, { title: 'x' }],
      ['patch', `/api/v1/admin/modules/${module.id}/lessons/reorder`, { lessonIds: [] }],
      ['patch', `/api/v1/admin/lessons/${lessons[0]!.id}`, { title: 'x' }],
      ['delete', `/api/v1/admin/lessons/${lessons[0]!.id}`, {}],
      ['patch', `/api/v1/admin/users/${session.userId}`, { isActive: false }],
    ];

    for (const [method, path, payload] of writes) {
      const response = await withCsrf(
        (agent[method as 'post'] as (url: string) => ReturnType<typeof agent.post>)(path),
      ).send(payload);
      // 403 from the role guard, never 400 from validation: authorization is
      // decided before the body is even considered.
      expect(response.status, `${method.toUpperCase()} ${path}`).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN');
    }
  });

  it('lets an admin through the same routes', async () => {
    await createUser({ email: 'admin@test.dev', role: 'ADMIN' });
    const { agent } = await loginAs('admin@test.dev');

    expect((await agent.get('/api/v1/admin/courses')).status).toBe(200);
    expect((await agent.get('/api/v1/admin/users')).status).toBe(200);
    expect((await agent.get('/api/v1/dashboard/admin')).status).toBe(200);
    expect((await agent.get('/api/v1/admin/activity')).status).toBe(200);
  });

  it('requires authentication, not just a role, on admin routes', async () => {
    const { api } = await import('../helpers/factories.js');
    const response = await api().get('/api/v1/admin/courses');
    expect(response.status).toBe(401);
  });

  it('hides draft courses from learners as 404, not 403', async () => {
    await createUser({ email: 'learner@test.dev' });
    const { course } = await createCourse({ status: 'DRAFT' });
    const { agent } = await loginAs('learner@test.dev');

    const response = await agent.get(`/api/v1/courses/${course.slug}`);
    // 403 would confirm the course exists; 404 reveals nothing.
    expect(response.status).toBe(404);
  });

  it('refuses a lesson to someone with no enrollment', async () => {
    await createUser({ email: 'learner@test.dev' });
    const { lessons } = await createCourse();
    const { agent } = await loginAs('learner@test.dev');

    const response = await agent.get(`/api/v1/lessons/${lessons[0]!.id}`);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('allows a preview lesson without an enrollment, but marks it untracked', async () => {
    await createUser({ email: 'learner@test.dev' });
    const { lessons } = await createCourse({ previewFirst: true });
    const { agent } = await loginAs('learner@test.dev');

    const response = await agent.get(`/api/v1/lessons/${lessons[0]!.id}`);
    expect(response.status).toBe(200);
    expect(response.body.data.isTracked).toBe(false);
    expect(response.body.data.videoUrl).toBeTruthy();

    // ...and a preview viewer still cannot record progress.
    const session = await loginAs('learner@test.dev');
    const save = await session
      .withCsrf(session.agent.put(`/api/v1/lessons/${lessons[0]!.id}/progress`))
      .send({ positionSeconds: 10 });
    expect(save.status).toBe(403);
  });
});
