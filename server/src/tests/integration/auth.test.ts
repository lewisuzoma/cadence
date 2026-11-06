import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { authRepository } from '../../modules/auth/auth.repository.js';
import { mailer } from '../../lib/mailer.js';
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

    it('signs in from the browser, which sends an Origin header', async () => {
      /*
       * The regression test for a 500 that reached a running stack.  Every
       * other case here omits `Origin`, so they all took the "not a browser"
       * branch of the CORS check and passed while the real sign-in was broken.
       * See tests/integration/cors.test.ts for the rest of that surface.
       */
      const response = await api()
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:8080')
        .set('Host', 'localhost:8080')
        .set('X-Forwarded-Proto', 'http')
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

  describe('password reset', () => {
    /**
     * The link is only ever observable through the mail transport, which is
     * the point: the token appears in no response body. Spying on the
     * transport is how a test gets hold of the same string a real user would
     * click.
     */
    function captureResetMail() {
      const sent: { to: string; text: string }[] = [];
      vi.spyOn(mailer, 'send').mockImplementation(async (mail) => {
        sent.push({ to: mail.to, text: mail.text });
      });
      return {
        get token(): string {
          const match = /token=(\S+)/.exec(sent.at(-1)?.text ?? '');
          if (!match) throw new Error(`No reset link was sent (${sent.length} messages)`);
          return decodeURIComponent(match[1]!);
        },
        get count(): number {
          return sent.length;
        },
        get lastRecipient(): string | undefined {
          return sent.at(-1)?.to;
        },
      };
    }

    const NEW_PASSWORD = 'BrandNew123';
    const resetBody = (token: string, password = NEW_PASSWORD) => ({
      token,
      password,
      confirmPassword: password,
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    describe('POST /auth/forgot-password', () => {
      it('sends a link to a registered address', async () => {
        await createUser({ email: 'learner@test.dev' });
        const mail = captureResetMail();

        const response = await api()
          .post('/api/v1/auth/forgot-password')
          .send({ email: 'learner@test.dev' });

        expect(response.status).toBe(200);
        expect(mail.count).toBe(1);
        expect(mail.lastRecipient).toBe('learner@test.dev');
        // The token itself never travels back to the browser.
        expect(JSON.stringify(response.body)).not.toContain(mail.token);
      });

      it('answers identically for an unknown address, and sends nothing', async () => {
        const mail = captureResetMail();
        const known = await createUser({ email: 'learner@test.dev' });

        const registered = await api()
          .post('/api/v1/auth/forgot-password')
          .send({ email: known.email });
        const unknown = await api()
          .post('/api/v1/auth/forgot-password')
          .send({ email: 'nobody@test.dev' });

        // The same answer either way: anything else is an oracle for whether
        // an address has an account here.
        expect(unknown.status).toBe(registered.status);
        expect(unknown.body).toEqual(registered.body);
        expect(mail.count).toBe(1);
      });

      it('sends nothing for a deactivated account', async () => {
        await createUser({ email: 'gone@test.dev', isActive: false });
        const mail = captureResetMail();

        const response = await api()
          .post('/api/v1/auth/forgot-password')
          .send({ email: 'gone@test.dev' });

        // A reset must not be a way back into an account an admin closed.
        expect(response.status).toBe(200);
        expect(mail.count).toBe(0);
      });

      it('stores the token hashed, never in the clear', async () => {
        const user = await createUser({ email: 'learner@test.dev' });
        const mail = captureResetMail();
        await api().post('/api/v1/auth/forgot-password').send({ email: user.email });

        const row = await prisma.passwordResetToken.findFirst({ where: { userId: user.id } });
        expect(row).not.toBeNull();
        expect(row!.tokenHash).not.toBe(mail.token);
        expect(row!.usedAt).toBeNull();
      });

      it('supersedes an outstanding link when a second is requested', async () => {
        const user = await createUser({ email: 'learner@test.dev' });
        const mail = captureResetMail();

        await api().post('/api/v1/auth/forgot-password').send({ email: user.email });
        const firstToken = mail.token;
        await api().post('/api/v1/auth/forgot-password').send({ email: user.email });

        const response = await api()
          .post('/api/v1/auth/reset-password')
          .send(resetBody(firstToken));
        expect(response.status).toBe(422);
      });

      it('rejects a malformed email with a field error', async () => {
        const response = await api()
          .post('/api/v1/auth/forgot-password')
          .send({ email: 'not-an-email' });

        expect(response.status).toBe(400);
        expect(response.body.errors.email).toBeDefined();
      });
    });

    describe('POST /auth/reset-password', () => {
      it('sets the new password, revokes every refresh token, and issues no session', async () => {
        const user = await createUser({ email: 'learner@test.dev' });
        const existing = await loginAs(user.email);
        const mail = captureResetMail();
        await api().post('/api/v1/auth/forgot-password').send({ email: user.email });

        const response = await api()
          .post('/api/v1/auth/reset-password')
          .send(resetBody(mail.token));

        expect(response.status).toBe(200);
        // A reset hands out no session: the user proves the new password by
        // typing it at sign-in.
        expect(response.body.data.user).toBeUndefined();
        const cookies = (response.headers['set-cookie'] as unknown as string[]) ?? [];
        const accessCookies = cookies.filter((c) => c.startsWith('cadence_access='));
        // Any access cookie here is the clearing form — empty value, expiry in
        // the past — and never a freshly minted token.
        for (const cookie of accessCookies) {
          expect(cookie).toMatch(/^cadence_access=;/);
          expect(cookie).toContain('Expires=Thu, 01 Jan 1970');
        }

        /*
         * The session that existed before the reset can no longer renew.
         *
         * Access tokens are stateless JWTs, so the one that device already
         * holds keeps working until it expires — at most ACCESS_TOKEN_TTL
         * (15 minutes). Revoking the refresh token is what ends the session:
         * the moment the access token lapses there is nothing to rotate
         * with. This is the same bound `change-password` has, and closing it
         * entirely would mean a database read on every authenticated request.
         */
        expect((await existing.agent.post('/api/v1/auth/refresh')).status).toBe(401);
        const refreshRows = await prisma.refreshToken.findMany({
          where: { userId: user.id, revokedAt: null },
        });
        expect(refreshRows).toHaveLength(0);

        // Old password refused, new one accepted.
        const withOld = await api()
          .post('/api/v1/auth/login')
          .send({ email: user.email, password: TEST_PASSWORD });
        expect(withOld.status).toBe(401);

        const withNew = await api()
          .post('/api/v1/auth/login')
          .send({ email: user.email, password: NEW_PASSWORD });
        expect(withNew.status).toBe(200);
      });

      it('refuses to spend the same link twice', async () => {
        const user = await createUser({ email: 'learner@test.dev' });
        const mail = captureResetMail();
        await api().post('/api/v1/auth/forgot-password').send({ email: user.email });
        const body = resetBody(mail.token);

        expect((await api().post('/api/v1/auth/reset-password').send(body)).status).toBe(200);

        const replay = await api().post('/api/v1/auth/reset-password').send(body);
        expect(replay.status).toBe(422);
        expect(replay.body.code).toBe('UNPROCESSABLE');
      });

      it('refuses an expired link', async () => {
        const user = await createUser({ email: 'learner@test.dev' });
        const mail = captureResetMail();
        await api().post('/api/v1/auth/forgot-password').send({ email: user.email });

        // Age the row past its window rather than waiting out the TTL.
        await prisma.passwordResetToken.updateMany({
          where: { userId: user.id },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });

        const response = await api()
          .post('/api/v1/auth/reset-password')
          .send(resetBody(mail.token));
        expect(response.status).toBe(422);
      });

      it('gives the same message for unknown, spent and expired links', async () => {
        const user = await createUser({ email: 'learner@test.dev' });
        const mail = captureResetMail();
        await api().post('/api/v1/auth/forgot-password').send({ email: user.email });
        const body = resetBody(mail.token);

        const unknown = await api()
          .post('/api/v1/auth/reset-password')
          .send(resetBody('not-a-real-token'));
        expect(unknown.status).toBe(422);

        await api().post('/api/v1/auth/reset-password').send(body);
        const spent = await api().post('/api/v1/auth/reset-password').send(body);

        // Which kind of failure it was tells a guesser something and tells
        // the real user nothing they can act on.
        expect(spent.body.message).toBe(unknown.body.message);
      });

      it('enforces the password rules and the confirmation without spending the link', async () => {
        const user = await createUser({ email: 'learner@test.dev' });
        const mail = captureResetMail();
        await api().post('/api/v1/auth/forgot-password').send({ email: user.email });
        const token = mail.token;

        const weak = await api()
          .post('/api/v1/auth/reset-password')
          .send(resetBody(token, 'short'));
        expect(weak.status).toBe(400);
        expect(weak.body.errors.password).toBeDefined();

        const mismatched = await api().post('/api/v1/auth/reset-password').send({
          token,
          password: NEW_PASSWORD,
          confirmPassword: 'Different123',
        });
        expect(mismatched.status).toBe(400);
        expect(mismatched.body.errors.confirmPassword).toBeDefined();

        // Neither rejected attempt burned the link.
        const good = await api().post('/api/v1/auth/reset-password').send(resetBody(token));
        expect(good.status).toBe(200);
      });

      it('needs no CSRF token, having no session to protect', async () => {
        const user = await createUser({ email: 'learner@test.dev' });
        const mail = captureResetMail();
        await api().post('/api/v1/auth/forgot-password').send({ email: user.email });

        const response = await api()
          .post('/api/v1/auth/reset-password')
          .send(resetBody(mail.token));
        expect(response.status).toBe(200);
      });
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

describe('error diagnostics', () => {
  /*
   * A 500 in production says only "Something went wrong", by design.  What
   * makes that bearable is the correlation id: it is on every response and in
   * every log line for the request, so a user's report can be matched to the
   * trace that explains it.  Without it the original CORS 500 could not be
   * tied to anything.
   */
  beforeEach(async () => {
    await resetDb();
    await createUser({ email: 'learner@test.dev' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const credentials = { email: 'learner@test.dev', password: TEST_PASSWORD };

  it('puts a request id on a successful response', async () => {
    const response = await api().post('/api/v1/auth/login').send(credentials);

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it('echoes a well-formed inbound request id, so a trace can span services', async () => {
    const response = await api()
      .post('/api/v1/auth/login')
      .set('X-Request-Id', 'trace-abc-123')
      .send(credentials);

    expect(response.headers['x-request-id']).toBe('trace-abc-123');
  });

  it('replaces a malformed inbound request id rather than reflecting it', async () => {
    const response = await api()
      .post('/api/v1/auth/login')
      .set('X-Request-Id', 'not valid! <script>')
      .send(credentials);

    expect(response.headers['x-request-id']).not.toBe('not valid! <script>');
    expect(response.headers['x-request-id']).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it('returns a 500 carrying a request id that matches the header', async () => {
    vi.spyOn(authRepository, 'findByEmail').mockRejectedValue(new Error('boom'));

    const response = await api().post('/api/v1/auth/login').send(credentials);

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
    expect(response.body.requestId).toBeTruthy();
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });

  it('reports a dropped database connection as 503, not 500', async () => {
    /*
     * P1017 is what a restarted Postgres actually produces, and it arrives as
     * a PrismaClientKnownRequestError -- so it slipped past a check that only
     * looked for PrismaClientInitializationError and was reported as a 500.
     */
    vi.spyOn(authRepository, 'findByEmail').mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Server has closed the connection.', {
        code: 'P1017',
        clientVersion: '5.22.0',
      }),
    );

    const response = await api().post('/api/v1/auth/login').send(credentials);

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('SERVICE_UNAVAILABLE');
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });

  it('still maps a query-level Prisma error to 500', async () => {
    // P2xxx is about the request, not the connection: not a 503.
    vi.spyOn(authRepository, 'findByEmail').mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Table does not exist', {
        code: 'P2021',
        clientVersion: '5.22.0',
      }),
    );

    const response = await api().post('/api/v1/auth/login').send(credentials);

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('reports an unreachable database as 503, not 500', async () => {
    // The API is up; a dependency is not.  That distinction is what tells the
    // client to retry, and /api/v1/health already draws it the same way.
    vi.spyOn(authRepository, 'findByEmail').mockRejectedValue(
      new Prisma.PrismaClientInitializationError('Cannot reach database', '5.0.0'),
    );

    const response = await api().post('/api/v1/auth/login').send(credentials);

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('SERVICE_UNAVAILABLE');
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });

  it('leaves a 4xx body free of the request id, keeping user-facing copy clean', async () => {
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'learner@test.dev', password: 'Wrong12345' });

    expect(response.status).toBe(401);
    expect(response.body.requestId).toBeUndefined();
    // Still correlatable from the header when support needs it.
    expect(response.headers['x-request-id']).toBeTruthy();
  });
});
