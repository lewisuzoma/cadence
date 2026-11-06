import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { http } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { ProtectedRoute, RoleRoute } from './guards';
import { adminUser, fail, learnerUser, ok, server } from '@/test/msw-server';
import { createTestQueryClient } from '@/test/render';

/**
 * Route guards.
 *
 * These are a navigation convenience, not the security boundary — the API
 * refuses unauthorised requests regardless. What matters here is that a
 * signed-out visitor is sent to /login with a `next` that brings them back,
 * and that a learner who reaches an admin URL sees a 403 rather than a
 * silent redirect that looks like the page does not exist.
 */
function renderGuard(
  guard: 'protected' | 'admin',
  initialPath: string,
) {
  const client = createTestQueryClient();
  const element =
    guard === 'protected' ? <ProtectedRoute /> : <RoleRoute allow={['ADMIN']} />;

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={element}>
            <Route path="/admin/courses" element={<p>Admin courses</p>} />
            <Route path="/my-learning" element={<p>My learning</p>} />
          </Route>
          <Route path="/login" element={<p>Sign in page</p>} />
          <Route path="/403" element={<p>Admins only page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProtectedRoute', () => {
  it('renders the route for a signed-in learner', async () => {
    renderGuard('protected', '/my-learning');
    expect(await screen.findByText('My learning')).toBeInTheDocument();
  });

  it('redirects a signed-out visitor to the sign-in page', async () => {
    server.use(http.get('/api/v1/auth/me', () => fail(401, 'UNAUTHENTICATED', 'Authentication required')));

    renderGuard('protected', '/my-learning');
    expect(await screen.findByText('Sign in page')).toBeInTheDocument();
  });

  it('shows a loading state while the session is being checked', () => {
    renderGuard('protected', '/my-learning');
    // Announced politely so it does not interrupt on first paint.
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session');
  });
});

describe('RoleRoute', () => {
  it('lets an admin through', async () => {
    server.use(http.get('/api/v1/auth/me', () => ok({ user: adminUser }, 'Current user')));

    renderGuard('admin', '/admin/courses');
    expect(await screen.findByText('Admin courses')).toBeInTheDocument();
  });

  it('sends a learner to the 403 page, not to a redirect that hides the route', async () => {
    server.use(http.get('/api/v1/auth/me', () => ok({ user: learnerUser }, 'Current user')));

    renderGuard('admin', '/admin/courses');
    expect(await screen.findByText('Admins only page')).toBeInTheDocument();
    expect(screen.queryByText('Admin courses')).not.toBeInTheDocument();
  });

  it('sends a signed-out visitor to sign in rather than to 403', async () => {
    server.use(http.get('/api/v1/auth/me', () => fail(401, 'UNAUTHENTICATED', 'Authentication required')));

    renderGuard('admin', '/admin/courses');
    expect(await screen.findByText('Sign in page')).toBeInTheDocument();
  });
});
