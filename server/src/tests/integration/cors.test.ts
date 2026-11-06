import { beforeEach, describe, expect, it } from 'vitest';
import { TEST_PASSWORD, api, createUser, resetDb } from '../helpers/factories.js';

/**
 * CORS, exercised the way a browser actually behaves.
 *
 * This file exists because of a bug that reached a running stack: every
 * mutation from the browser returned 500, while the whole suite stayed green.
 * Supertest sends no `Origin` header, so every other test took the
 * "not a browser" branch and the CORS path was never evaluated at all.
 *
 * A browser sends `Origin` on every request whose method is not GET or HEAD,
 * same-origin requests included -- being same-origin suppresses the preflight,
 * not the header. So these tests always set `Origin`, and set `Host` alongside
 * it, which is the pair nginx forwards in the real stack.
 */

/** The headers a browser + nginx produce for a same-origin POST. */
const sameOrigin = (origin: string) => ({
  Origin: origin,
  Host: origin.replace(/^https?:\/\//, ''),
  'X-Forwarded-Proto': origin.startsWith('https') ? 'https' : 'http',
});

function post(path: string, headers: Record<string, string>) {
  const req = api().post(path);
  for (const [key, value] of Object.entries(headers)) req.set(key, value);
  return req;
}

describe('CORS', () => {
  beforeEach(async () => {
    await resetDb();
    await createUser({ email: 'learner@test.dev' });
  });

  const credentials = { email: 'learner@test.dev', password: TEST_PASSWORD };

  it('allows a same-origin POST, which is what the browser sends', async () => {
    const response = await post('/api/v1/auth/login', sameOrigin('http://localhost:8080')).send(
      credentials,
    );

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:8080');
  });

  it('allows a same-origin POST on a port no allow-list mentions', async () => {
    // The regression: CORS_ORIGIN defaults to :5173, so an allow-list lookup
    // alone refuses this -- and refused it as a 500.  Changing CLIENT_PORT must
    // not break the app.
    const response = await post('/api/v1/auth/login', sameOrigin('http://localhost:9999')).send(
      credentials,
    );

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:9999');
  });

  it('allows a same-origin POST behind TLS termination', async () => {
    const response = await post('/api/v1/auth/login', sameOrigin('https://cadence.example')).send(
      credentials,
    );

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://cadence.example');
  });

  it('allows a cross-origin POST from a configured origin', async () => {
    // CORS_ORIGIN's default, i.e. `vite dev` talking to the API directly.
    const response = await post('/api/v1/auth/login', {
      Origin: 'http://localhost:5173',
      Host: 'localhost:4000',
    }).send(credentials);

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('refuses a foreign origin as a 403, not a server fault', async () => {
    const response = await post('/api/v1/auth/login', {
      Origin: 'http://evil.test',
      Host: 'localhost:8080',
    }).send(credentials);

    // A client sending a disallowed origin is not a server bug; reporting it
    // as one is what made the original failure undiagnosable.
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('refuses before the route runs, so no session is created', async () => {
    const response = await post('/api/v1/auth/login', {
      Origin: 'http://evil.test',
      Host: 'localhost:8080',
    }).send(credentials);

    // Merely withholding the CORS header would stop the browser reading the
    // response while the sign-in still happened, letting a foreign page plant
    // session cookies.  Nothing may be set.
    expect(response.status).toBe(403);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('allows a request with no Origin at all', async () => {
    // curl, the container health check, and every other test in this suite.
    const response = await api().post('/api/v1/auth/login').send(credentials);

    expect(response.status).toBe(200);
  });

  it('does not treat a different port on the same host as same-origin', async () => {
    // Host and Origin disagree on the port, so this is genuinely cross-origin
    // and is not on the allow-list.  Comparing hostnames only would let any
    // port on the host ride along with credentials.
    const response = await post('/api/v1/auth/login', {
      Origin: 'http://localhost:7777',
      Host: 'localhost:8080',
    }).send(credentials);

    expect(response.status).toBe(403);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
