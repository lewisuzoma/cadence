import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { ResetPasswordPage } from './ResetPasswordPage';
import { LoginPage } from './LoginPage';
import { fail, ok, server } from '@/test/msw-server';
import { currentPath, renderWithRouter } from '@/test/render';

describe('ForgotPasswordPage', () => {
  it('validates the email in the browser, without calling the API', async () => {
    // An unhandled request would fail the test, which is the assertion:
    // nothing reaches the network until the address is well formed.
    renderWithRouter(<ForgotPasswordPage />, { path: '/forgot-password' });

    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByText('Email is required')).toBeInTheDocument();
  });

  it('confirms the request without claiming the account exists', async () => {
    renderWithRouter(<ForgotPasswordPage />, { path: '/forgot-password' });

    await userEvent.type(screen.getByLabelText('Email'), 'ada@cadence.dev');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    const status = await screen.findByRole('status');
    // The hedge is the point: the server will not say whether the address is
    // registered, so the copy must not imply that it is.
    expect(status).toHaveTextContent(/If an account exists for ada@cadence\.dev/);
    expect(status).toHaveTextContent(/expires in 30 minutes/);

    // The form is gone, so the request cannot be fired twice by accident.
    expect(screen.queryByRole('button', { name: 'Send reset link' })).not.toBeInTheDocument();
  });

  it('keeps the form up and reports the failure when the request is refused', async () => {
    server.use(
      http.post('/api/v1/auth/forgot-password', () =>
        fail(429, 'RATE_LIMITED', 'Too many requests. Please try again shortly.'),
      ),
    );

    renderWithRouter(<ForgotPasswordPage />, { path: '/forgot-password' });

    await userEvent.type(screen.getByLabelText('Email'), 'ada@cadence.dev');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests');
    // Still retryable: the confirmation must not appear for a failed send.
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('ResetPasswordPage', () => {
  const at = (search: string) => ({
    path: '/reset-password',
    initialEntries: [`/reset-password${search}`],
  });

  it('refuses to show a form when the link arrived without a token', () => {
    renderWithRouter(<ResetPasswordPage />, at(''));

    expect(screen.getByText('This link is incomplete')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^New password/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('applies the shared password rules before submitting', async () => {
    renderWithRouter(<ResetPasswordPage />, at('?token=abc123'));

    await userEvent.type(screen.getByLabelText(/^New password/), 'short');
    await userEvent.type(screen.getByLabelText(/^Confirm new password/), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));

    expect(await screen.findByText('Use at least 8 characters')).toBeInTheDocument();
  });

  it('reports a mismatched confirmation', async () => {
    renderWithRouter(<ResetPasswordPage />, at('?token=abc123'));

    await userEvent.type(screen.getByLabelText(/^New password/), 'BrandNew123');
    await userEvent.type(screen.getByLabelText(/^Confirm new password/), 'Different123');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
  });

  it('sends the user to sign in with the new password, carrying a notice', async () => {
    renderWithRouter(<ResetPasswordPage />, {
      ...at('?token=abc123'),
      extraRoutes: [{ path: '/login', element: <LoginPage /> }],
    });

    await userEvent.type(screen.getByLabelText(/^New password/), 'BrandNew123');
    await userEvent.type(screen.getByLabelText(/^Confirm new password/), 'BrandNew123');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));

    await waitFor(() => expect(currentPath()).toBe('/login'));
    // The reset deliberately does not sign the user in, so the sign-in screen
    // has to explain why they are looking at it.
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Your password has been updated',
    );
  });

  it('offers a fresh link when the token is spent or expired', async () => {
    server.use(
      http.post('/api/v1/auth/reset-password', () =>
        fail(422, 'UNPROCESSABLE', 'This reset link is no longer valid. Request a new one.'),
      ),
    );

    renderWithRouter(<ResetPasswordPage />, at('?token=stale'));

    await userEvent.type(screen.getByLabelText(/^New password/), 'BrandNew123');
    await userEvent.type(screen.getByLabelText(/^Confirm new password/), 'BrandNew123');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This reset link is no longer valid');
    expect(screen.getByRole('link', { name: 'Request a new link' })).toBeInTheDocument();
  });

  it('submits the token from the query string', async () => {
    let seen: string | undefined;
    server.use(
      http.post('/api/v1/auth/reset-password', async ({ request }) => {
        const body = (await request.json()) as { token?: string };
        seen = body.token;
        return ok({ success: true }, 'Password updated');
      }),
    );

    renderWithRouter(<ResetPasswordPage />, at('?token=tok-from-the-email'));

    await userEvent.type(screen.getByLabelText(/^New password/), 'BrandNew123');
    await userEvent.type(screen.getByLabelText(/^Confirm new password/), 'BrandNew123');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));

    await waitFor(() => expect(seen).toBe('tok-from-the-email'));
  });
});
