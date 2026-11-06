import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { LoginPage } from './LoginPage';
import { RegisterPage } from './RegisterPage';
import { fail, server } from '@/test/msw-server';
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
