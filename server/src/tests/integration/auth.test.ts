import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../../lib/prisma.js';
import { REFRESH_COOKIE } from '../../lib/cookies.js';
import {
  TEST_PASSWORD,
  api,
  createUser,
  loginAs,
  resetDb,
  testApp,
} from '../helpers/factories.js';

describe('auth', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('POST /auth/register', () => {
    const valid = {
      firstName: 'Ada',
      lastName: 'Okafor',
      email: 'ada@test.dev',
      password: TEST_PASSWORD,
      confirmPassword: TEST_PASSWORD,
    };

    it('creates a learner and sets the auth cookies', async () => {
      const response = await api().post('/api/v1/auth/register').send(valid);

      expect(response.status).toBe(201);
      expect(response.body.data.user.email).toBe('ada@test.dev');
      expect(response.body.data.user.role).toBe('LEARNER');
      // The hash must never travel to the client.
      expect(response.body.data.user).not.toHaveProperty('passwordHash');

      const cookies = (response.headers['set-cookie'] as unknown as string[]) ?? [];
      expect(cookies.some((c) => c.startsWith('cadence_access=') && c.includes('HttpOnly'))).toBe(
        true,
      );
      expect(
        cookies.some((c) => c.startsWith('cadence_refresh=') && c.includes('HttpOnly')),
      ).toBe(true);
      // The CSRF cookie is deliberately readable by script.
      const csrf = cookies.find((c) => c.startsWith('csrf_token='));
      expect(csrf).toBeDefined();
      expect(csrf).not.toContain('HttpOnly');
    });

    it('rejects a mismatched confirmation with a field error', async () => {
      const response = await api()
        .post('/api/v1/auth/register')
        .send({ ...valid, confirmPassword: 'Different123' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.errors.confirmPassword).toBeDefined();
    });

    it('rejects a weak password', async () => {
      const response = await api()
        .post('/api/v1/auth/register')
        .send({ ...valid, password: 'short', confirmPassword: 'short' });
      expect(response.status).toBe(400);
      expect(response.body.errors.password).toBeDefined();
    });

    it('returns 409 for a duplicate email, case-insensitively', async () => {
      await api().post('/api/v1/auth/register').send(valid);
      const response = await api()
        .post('/api/v1/auth/register')
        .send({ ...valid, email: 'ADA@TEST.DEV' });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('CONFLICT');
    });

    it('ignores a role injected into the body', async () => {
      const response = await api()
        .post('/api/v1/auth/register')
        .send({ ...valid, role: 'ADMIN' });

      expect(response.status).toBe(201);
      expect(response.body.data.user.role).toBe('LEARNER');
      const stored = await prisma.user.findUnique({ where: { email: 'ada@test.dev' } });
      expect(stored?.role).toBe('LEARNER');
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await createUser({ email: 'learner@test.dev' });
    });

    it('signs in with the right password', async () => {
      const response = await api()
        .post('/api/v1/auth/login')
        .send({ email: 'learner@test.dev', password: TEST_PASSWORD });

      expect(response.status).toBe(200);
      expect(response.body.data.user.email).toBe('learner@test.dev');
    });

    it('gives the same generic 401 for a wrong password and an unknown email', async () => {
      const wrongPassword = await api()
        .post('/api/v1/auth/login')
        .send({ email: 'learner@test.dev', password: 'Wrong12345' });
      const unknownEmail = await api()
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@test.dev', password: TEST_PASSWORD });

      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      // Identical message: the response must not reveal which accounts exist.
      expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
      expect(wrongPassword.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('issues a 7-day refresh token by default', async () => {
      const response = await api()
        .post('/api/v1/auth/login')
        .send({ email: 'learner@test.dev', password: TEST_PASSWORD });

      expect(response.status).toBe(200);
      const token = await prisma.refreshToken.findFirst({ orderBy: { createdAt: 'desc' } });
      const days = (token!.expiresAt.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.5);
      expect(days).toBeLessThan(7.5);
    });

    it('extends the refresh token to 30 days when "keep me signed in" is ticked', async () => {
      const response = await api()
        .post('/api/v1/auth/login')
        .send({ email: 'learner@test.dev', password: TEST_PASSWORD, rememberMe: true });

      expect(response.status).toBe(200);
      const token = await prisma.refreshToken.findFirst({ orderBy: { createdAt: 'desc' } });
      const days = (token!.expiresAt.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(29.5);
      expect(days).toBeLessThan(30.5);

      // The access cookie is unchanged: a remembered session is still
      // re-validated against the user row every 15 minutes.
      const cookies = (response.headers['set-cookie'] as unknown as string[]) ?? [];
      const access = cookies.find((cookie) => cookie.startsWith('cadence_access='));
      expect(access).toContain('Max-Age=900');
    });

    it('keeps the longer lifetime when a remembered session is rotated', async () => {
      const agent = request.agent(testApp());
      await agent
        .post('/api/v1/auth/login')
        .send({ email: 'learner@test.dev', password: TEST_PASSWORD, rememberMe: true });

      expect((await agent.post('/api/v1/auth/refresh')).status).toBe(200);

      const rotated = await prisma.refreshToken.findFirst({
        where: { revokedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      const days = (rotated!.expiresAt.getTime() - Date.now()) / 86_400_000;
      // Rotation must not quietly downgrade the session back to 7 days.
      expect(days).toBeGreaterThan(29.5);
    });

    it('refuses a deactivated account with 403', async () => {
      await createUser({ email: 'gone@test.dev', isActive: false });
      const response = await api()
        .post('/api/v1/auth/login')
        .send({ email: 'gone@test.dev', password: TEST_PASSWORD });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('ACCOUNT_INACTIVE');
    });
  });

  describe('GET /auth/me', () => {
    it('is 401 without a cookie', async () => {
      const response = await api().get('/api/v1/auth/me');
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('UNAUTHENTICATED');
    });

    it('returns the signed-in user', async () => {
      await createUser({ email: 'learner@test.dev', firstName: 'Ada' });
      const { agent } = await loginAs('learner@test.dev');
      const response = await agent.get('/api/v1/auth/me');

      expect(response.status).toBe(200);
      expect(response.body.data.user.firstName).toBe('Ada');
    });

    it('rejects a user deactivated after the token was issued', async () => {
      const user = await createUser({ email: 'learner@test.dev' });
      const { agent } = await loginAs('learner@test.dev');

      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

      // The access token is still cryptographically valid; the row is not.
      const response = await agent.get('/api/v1/auth/me');
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('ACCOUNT_INACTIVE');
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates the refresh token and keeps the session alive', async () => {
      await createUser({ email: 'learner@test.dev' });
      const { agent } = await loginAs('learner@test.dev');

      const before = await prisma.refreshToken.count({ where: { revokedAt: null } });
      const response = await agent.post('/api/v1/auth/refresh');

      expect(response.status).toBe(200);
      expect(response.body.data.user.email).toBe('learner@test.dev');

      // One token revoked, one minted: still exactly one live token.
      const after = await prisma.refreshToken.count({ where: { revokedAt: null } });
      expect(after).toBe(before);
      expect(await prisma.refreshToken.count({ where: { revokedAt: { not: null } } })).toBe(1);
    });

    it('revokes the whole family when a used token is replayed', async () => {
      const user = await createUser({ email: 'learner@test.dev' });
      const agent = request.agent(testApp());
      const login = await agent
        .post('/api/v1/auth/login')
        .send({ email: 'learner@test.dev', password: TEST_PASSWORD });

      const stolen = ((login.headers['set-cookie'] as unknown as string[]) ?? [])
        .find((cookie) => cookie.startsWith(`${REFRESH_COOKIE}=`))!
        .split('=')[1]!
        .split(';')[0]!;

      // The legitimate client rotates once.
      expect((await agent.post('/api/v1/auth/refresh')).status).toBe(200);

      // The attacker replays the token captured earlier.
      const replay = await request(testApp())
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE}=${stolen}`);

      expect(replay.status).toBe(401);

      // Reuse means the chain leaked, so every token in it is revoked and the
      // real user is forced to sign in again too.
      const live = await prisma.refreshToken.count({
        where: { userId: user.id, revokedAt: null },
      });
      expect(live).toBe(0);
      expect((await agent.post('/api/v1/auth/refresh')).status).toBe(401);
    });

    it('is 401 with no refresh cookie at all', async () => {
      const response = await api().post('/api/v1/auth/refresh');
      expect(response.status).toBe(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the token and clears the cookies', async () => {
      await createUser({ email: 'learner@test.dev' });
      const { agent, withCsrf } = await loginAs('learner@test.dev');

      const response = await withCsrf(agent.post('/api/v1/auth/logout'));
      expect(response.status).toBe(200);

      expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
      // The cookie jar is cleared, so the session is really gone.
      expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
    });
  });

  describe('CSRF', () => {
    it('rejects a mutation with no X-CSRF-Token header', async () => {
      const admin = await createUser({ email: 'admin@test.dev', role: 'ADMIN' });
      const { agent } = await loginAs('admin@test.dev');

      const response = await agent.post('/api/v1/admin/courses').send({
        title: 'A course',
        description: 'A description long enough to pass validation.',
        category: 'Engineering',
        thumbnailUrl: '/thumbnails/x.svg',
        difficulty: 'BEGINNER',
      });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('CSRF_ERROR');
      expect(await prisma.course.count({ where: { createdById: admin.id } })).toBe(0);
    });

    it('rejects a mutation whose header does not match the cookie', async () => {
      await createUser({ email: 'admin@test.dev', role: 'ADMIN' });
      const { agent } = await loginAs('admin@test.dev');

      const response = await agent
        .post('/api/v1/admin/courses')
        .set('X-CSRF-Token', 'not-the-real-token')
        .send({});

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('CSRF_ERROR');
    });

    it('allows a GET without the header', async () => {
      await createUser({ email: 'learner@test.dev' });
      const { agent } = await loginAs('learner@test.dev');
      expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
    });
  });

  describe('POST /auth/change-password', () => {
    it('changes the password and revokes other sessions', async () => {
      await createUser({ email: 'learner@test.dev' });
      const first = await loginAs('learner@test.dev');
      const second = await loginAs('learner@test.dev');

      const response = await second.withCsrf(
        second.agent.post('/api/v1/auth/change-password'),
      ).send({
        currentPassword: TEST_PASSWORD,
        password: 'BrandNew123',
        confirmPassword: 'BrandNew123',
      });
      expect(response.status).toBe(200);

      // The other device's refresh token is dead.
      expect((await first.agent.post('/api/v1/auth/refresh')).status).toBe(401);
      // The new password works, the old one does not.
      expect(
        (
          await api()
            .post('/api/v1/auth/login')
            .send({ email: 'learner@test.dev', password: 'BrandNew123' })
        ).status,
      ).toBe(200);
      expect(
        (
          await api()
            .post('/api/v1/auth/login')
            .send({ email: 'learner@test.dev', password: TEST_PASSWORD })
        ).status,
      ).toBe(401);
    });

    it('refuses when the current password is wrong', async () => {
      await createUser({ email: 'learner@test.dev' });
      const session = await loginAs('learner@test.dev');

      const response = await session
        .withCsrf(session.agent.post('/api/v1/auth/change-password'))
        .send({
          currentPassword: 'Wrong12345',
          password: 'BrandNew123',
          confirmPassword: 'BrandNew123',
        });

      expect(response.status).toBe(401);
    });
  });
});
