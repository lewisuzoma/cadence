import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { LoginPage } from './LoginPage';
import { RegisterPage } from './RegisterPage';
import { fail, learnerUser, ok, server } from '@/test/msw-server';
import { currentPath, renderWithRouter } from '@/test/render';

describe('LoginPage', () => {
  it('validates in the browser using the shared schema, without calling the API', async () => {
    // Any request would be an unhandled-request error, which is the assertion:
    // client-side validation must short-circuit before the network.
    renderWithRouter(<LoginPage />, { path: '/login' });

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    // An empty email reports the required rule, not the format rule.
    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
  });

  it('rejects a malformed email', async () => {
    renderWithRouter(<LoginPage />, { path: '/login' });

    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email');
    await userEvent.type(screen.getByLabelText('Password'), 'Password123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
  });

  it('shows the server message when credentials are refused', async () => {
    server.use(
      http.post('/api/v1/auth/login', () =>
        fail(401, 'INVALID_CREDENTIALS', 'Invalid email or password'),
      ),
    );

    renderWithRouter(<LoginPage />, { path: '/login' });

    await userEvent.type(screen.getByLabelText('Email'), 'ada@cadence.dev');
    await userEvent.type(screen.getByLabelText('Password'), 'Password123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Invalid email or password');
  });

  it('appends the correlation id to a server error so it can be reported', async () => {
    /*
     * A 500 tells the browser nothing about what broke, by design.  The id is
     * what turns "login is broken" into something traceable to a log line --
     * the thing that was missing when a CORS misconfiguration 500'd every
     * sign-in and left no way to tie the two together.
     */
    server.use(
      http.post('/api/v1/auth/login', () =>
        HttpResponse.json(
          {
            success: false,
            message: 'Something went wrong',
            code: 'INTERNAL_ERROR',
            requestId: 'req-abc-123',
          },
          { status: 500, headers: { 'X-Request-Id': 'req-abc-123' } },
        ),
      ),
    );

    renderWithRouter(<LoginPage />, { path: '/login' });

    await userEvent.type(screen.getByLabelText('Email'), 'ada@cadence.dev');
    await userEvent.type(screen.getByLabelText('Password'), 'Password123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong (ref: req-abc-123)');
  });

  it('reads the id from the header when a proxy answers with no envelope', async () => {
    // What a crashed upstream or a misrouted dev proxy actually returns: there
    // is no JSON body to carry `requestId`, so the header has to serve.
    server.use(
      http.post(
        '/api/v1/auth/login',
        () =>
          new HttpResponse('<html><body>502 Bad Gateway</body></html>', {
            status: 502,
            headers: { 'Content-Type': 'text/html', 'X-Request-Id': 'req-xyz-789' },
          }),
      ),
    );

    renderWithRouter(<LoginPage />, { path: '/login' });

    await userEvent.type(screen.getByLabelText('Email'), 'ada@cadence.dev');
    await userEvent.type(screen.getByLabelText('Password'), 'Password123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The server sent an unreadable response (ref: req-xyz-789)');
  });

  it('leaves a 401 message free of a correlation id', async () => {
    // User-facing copy stays clean; 4xx is the client's to fix, not ours.
    server.use(
      http.post('/api/v1/auth/login', () =>
        HttpResponse.json(
          { success: false, message: 'Invalid email or password', code: 'INVALID_CREDENTIALS' },
          { status: 401, headers: { 'X-Request-Id': 'req-should-not-show' } },
        ),
      ),
    );

    renderWithRouter(<LoginPage />, { path: '/login' });

    await userEvent.type(screen.getByLabelText('Email'), 'ada@cadence.dev');
    await userEvent.type(screen.getByLabelText('Password'), 'Password123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Invalid email or password');
    expect(alert).not.toHaveTextContent('req-should-not-show');
  });

  it('maps a server field error onto the matching input', async () => {
    server.use(
      http.post('/api/v1/auth/login', () =>
        fail(400, 'VALIDATION_ERROR', 'Validation failed', {
          email: ['That email is not recognised'],
        }),
      ),
    );

    renderWithRouter(<LoginPage />, { path: '/login' });
    await userEvent.type(screen.getByLabelText('Email'), 'ada@cadence.dev');
    await userEvent.type(screen.getByLabelText('Password'), 'Password123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('That email is not recognised')).toBeInTheDocument();
    // The field error is announced with the input, not only in a banner.
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('navigates to the dashboard on success', async () => {
    renderWithRouter(<LoginPage />, {
      path: '/login',
      extraRoutes: [{ path: '/dashboard', element: <p>Dashboard landed</p> }],
    });

    await userEvent.type(screen.getByLabelText('Email'), 'ada@cadence.dev');
    await userEvent.type(screen.getByLabelText('Password'), 'Password123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Dashboard landed', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(currentPath()).toBe('/dashboard');
  });

  it('honours the ?next= destination after signing in', async () => {
    renderWithRouter(<LoginPage />, {
      path: '/login',
      initialEntries: ['/login?next=%2Fmy-learning'],
      extraRoutes: [{ path: '/my-learning', element: <p>My learning</p> }],
    });

    await userEvent.type(screen.getByLabelText('Email'), 'ada@cadence.dev');
    await userEvent.type(screen.getByLabelText('Password'), 'Password123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('My learning', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(currentPath()).toBe('/my-learning');
  });
});

describe('RegisterPage', () => {
  const fill = async (overrides?: { confirm?: string; password?: string }) => {
    await userEvent.type(screen.getByLabelText(/First name/), 'Ada');
    await userEvent.type(screen.getByLabelText(/Last name/), 'Okafor');
    await userEvent.type(screen.getByLabelText(/^Email/), 'ada@cadence.dev');
    await userEvent.type(screen.getByLabelText(/^Password/), overrides?.password ?? 'Password123');
    await userEvent.type(
      screen.getByLabelText(/Confirm password/),
      overrides?.confirm ?? 'Password123',
    );
  };

  it('requires the two passwords to match', async () => {
    renderWithRouter(<RegisterPage />, { path: '/register' });
    await fill({ confirm: 'Different123' });
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
  });

  it('enforces the password rules from the shared schema', async () => {
    renderWithRouter(<RegisterPage />, { path: '/register' });
    await fill({ password: 'password', confirm: 'password' });
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Include at least one number')).toBeInTheDocument();
  });

  it('attaches a duplicate-email conflict to the email field', async () => {
    server.use(
      http.post('/api/v1/auth/register', () =>
        HttpResponse.json(
          {
            success: false,
            message: 'An account with that email already exists',
            code: 'CONFLICT',
          },
          { status: 409 },
        ),
      ),
    );

    renderWithRouter(<RegisterPage />, { path: '/register' });
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByText('An account with that email already exists'),
    ).toBeInTheDocument();
  });

  it('has no role field, so a role cannot be chosen at registration', () => {
    renderWithRouter(<RegisterPage />, { path: '/register' });
    expect(screen.queryByLabelText(/role/i)).not.toBeInTheDocument();
  });
});

/**
 * The sign-in card's own controls, from desktop artifact page 2.
 */
describe('LoginPage — artifact controls', () => {
  it('reveals and re-hides the password', async () => {
    renderWithRouter(<LoginPage />, { path: '/login' });

    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');

    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');

    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('offers "Keep me signed in for 30 days", unticked by default', () => {
    renderWithRouter(<LoginPage />, { path: '/login' });

    const checkbox = screen.getByRole('checkbox', {
      name: /Keep me signed in for 30 days/,
    });
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
  });

  it('sends rememberMe to the API when it is ticked', async () => {
    let sentRememberMe: unknown;
    server.use(
      http.post('/api/v1/auth/login', async ({ request }) => {
        // Cloning is what makes the body readable without tripping the
        // jsdom AbortSignal issue the default handler avoids.
        const body = (await request.clone().json()) as { rememberMe?: boolean };
        sentRememberMe = body.rememberMe;
        return ok({ user: learnerUser }, 'Signed in');
      }),
    );

    renderWithRouter(<LoginPage />, { path: '/login' });
    await userEvent.type(screen.getByLabelText('Email'), 'ada@cadence.dev');
    await userEvent.type(screen.getByLabelText('Password'), 'Password123');
    await userEvent.click(
      screen.getByRole('checkbox', { name: /Keep me signed in for 30 days/ }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(sentRememberMe).toBe(true));
  });

  it('fills the seeded credentials from a prototype shortcut', async () => {
    renderWithRouter(<LoginPage />, { path: '/login' });

    await userEvent.click(screen.getByRole('button', { name: /Demo admin/ }));

    // Filled in rather than submitted, so the reviewer sees what is sent.
    expect(screen.getByLabelText('Email')).toHaveValue('admin@cadence.dev');
    expect(screen.getByLabelText('Password')).toHaveValue('Password123');
  });

  it('links "Forgot password?" at a real destination', () => {
    renderWithRouter(<LoginPage />, { path: '/login' });
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });
});
