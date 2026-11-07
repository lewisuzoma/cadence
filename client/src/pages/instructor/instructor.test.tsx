import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http } from 'msw';
import userEvent from '@testing-library/user-event';
import { screen, waitFor, within } from '@testing-library/react';
import { currentPath, renderWithRouter } from '@/test/render';
import { adminUser, learnerUser, ok, server } from '@/test/msw-server';
import { AppLayout } from '@/layouts/AppLayout';
import { BecomeInstructorPage } from '@/pages/instructor/BecomeInstructorPage';
import { SuspendedInstructorPage } from '@/pages/instructor/SuspendedInstructorPage';
import { PermissionRoute } from '@/routes/guards';
import type { MyApplication, User } from '@cadence/shared';

/**
 * The instructor feature's client behaviour.
 *
 * Everything here goes through MSW against the real API shapes, so a
 * change to a shared schema shows up as a failing test rather than as a
 * runtime surprise in the browser.
 */

const instructorUser: User = {
  ...learnerUser,
  role: 'INSTRUCTOR',
  instructorStatus: 'ACTIVE',
};

const suspendedUser: User = {
  ...learnerUser,
  role: 'INSTRUCTOR',
  instructorStatus: 'SUSPENDED',
};

/*
 * The application form keeps a draft in localStorage, which persists
 * across tests in the same worker. Clearing it keeps each case starting
 * from an empty form rather than from whatever its neighbour typed.
 */
beforeEach(() => {
  localStorage.clear();
});

const NOT_APPLIED: MyApplication = {
  status: 'NOT_APPLIED',
  application: null,
  history: [],
  canReapplyAt: null,
  canReapplyNow: false,
  suspension: null,
  instructorSince: null,
  enrolledCourseCount: 3,
};

/** Stubs `/auth/me`, `/instructor-applications/me` and `/notifications`. */
function mockSession(user: User | null, application: MyApplication = NOT_APPLIED) {
  server.use(
    http.get('*/api/v1/auth/me', () =>
      user ? ok({ user }) : new Response(null, { status: 401 }),
    ),
    http.get('*/api/v1/instructor-applications/me', () => ok(application)),
    http.get('*/api/v1/notifications', () =>
      ok({ items: [], unreadCount: 0 }, 'ok', {
        page: 1,
        pageSize: 10,
        total: 0,
        totalPages: 1,
      }),
    ),
  );
}

describe('navigation follows the account state', () => {
  it('offers "Become an Instructor" to a learner with no application', async () => {
    mockSession(learnerUser);
    renderWithRouter(<AppLayout />, { path: '/dashboard' });

    expect(
      await screen.findByRole('link', { name: /become an instructor/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /application pending/i }),
    ).not.toBeInTheDocument();
  });

  it('shows "Application pending" instead once one is under review', async () => {
    mockSession(learnerUser, {
      ...NOT_APPLIED,
      status: 'PENDING',
      application: {
        id: '66666666-6666-6666-6666-666666666666',
        professionalTitle: 'Senior backend engineer',
        expertise: ['TypeScript'],
        experience: 'x'.repeat(60),
        biography: 'b'.repeat(100),
        motivation: 'm'.repeat(60),
        profilePhotoUrl: null,
        portfolioUrl: null,
        status: 'PENDING',
        submittedAt: '2026-11-05T14:02:00.000Z',
        decidedAt: null,
        decisionReason: null,
        updatedAt: '2026-11-06T09:15:00.000Z',
      },
    });
    renderWithRouter(<AppLayout />, { path: '/dashboard' });

    expect(
      await screen.findByRole('link', { name: /application pending/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /become an instructor/i }),
    ).not.toBeInTheDocument();
  });

  it('shows the workspace switcher to an instructor, and no apply link', async () => {
    mockSession(instructorUser);
    renderWithRouter(<AppLayout />, { path: '/dashboard' });

    const group = await screen.findByRole('group', { name: /workspace/i });
    expect(within(group).getByRole('button', { name: /teaching/i })).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /become an instructor/i }),
    ).not.toBeInTheDocument();
  });

  it('offers neither to an admin', async () => {
    mockSession(adminUser);
    renderWithRouter(<AppLayout />, { path: '/dashboard' });

    await screen.findByRole('navigation', { name: 'Main' });
    expect(
      screen.queryByRole('link', { name: /become an instructor/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /workspace/i })).not.toBeInTheDocument();
  });
});

describe('route guards', () => {
  it('sends a learner reaching the workspace to 403', async () => {
    mockSession(learnerUser);
    renderWithRouter(<PermissionRoute require="instructor:dashboard" />, {
      path: '/instructor',
      extraRoutes: [{ path: '/403', element: <p>Forbidden page</p> }],
    });

    // The guard redirects; the probe records where to.
    await waitFor(() => {
      expect(currentPath()).toBe('/403');
    });
  });

  it('shows the suspended page rather than a bare refusal', async () => {
    mockSession(suspendedUser, {
      ...NOT_APPLIED,
      status: 'SUSPENDED',
      suspension: {
        reason: 'Two lessons use third-party video without permission.',
        since: '2026-11-03T16:20:00.000Z',
      },
    });
    renderWithRouter(<PermissionRoute require="instructor:dashboard" />, {
      path: '/instructor',
      extraRoutes: [{ path: '/403', element: <p>Forbidden page</p> }],
    });

    expect(
      await screen.findByRole('heading', { name: /instructor access is suspended/i }),
    ).toBeInTheDocument();
    // And it says what still works, which is the point of the page.
    expect(await screen.findByText(/you can still learn/i)).toBeInTheDocument();
  });

  it('lets an active instructor through', async () => {
    mockSession(instructorUser);
    renderWithRouter(<PermissionRoute require="instructor:dashboard" />, {
      path: '/instructor',
    });
    await waitFor(() => {
      expect(
        screen.queryByRole('heading', { name: /suspended/i }),
      ).not.toBeInTheDocument();
    });
  });
});

describe('the suspended page', () => {
  it('states the reason and both consequences', async () => {
    mockSession(suspendedUser, {
      ...NOT_APPLIED,
      status: 'SUSPENDED',
      suspension: {
        reason: 'Replace the third-party video in two lessons.',
        since: '2026-11-03T16:20:00.000Z',
      },
    });
    renderWithRouter(<SuspendedInstructorPage />, { path: '/instructor' });

    expect(
      await screen.findByText(/replace the third-party video in two lessons/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/you can still learn/i)).toBeInTheDocument();
    expect(screen.getByText(/teaching is paused/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to my learning/i })).toBeInTheDocument();
  });
});

describe('the application form', () => {
  it('validates against the shared schema before sending anything', async () => {
    const user = userEvent.setup();
    mockSession(learnerUser);
    const submitted = vi.fn();
    server.use(
      http.post('*/api/v1/instructor-applications', async ({ request }) => {
        submitted(await request.json());
        return ok(NOT_APPLIED);
      }),
    );

    renderWithRouter(<BecomeInstructorPage />, { path: '/become-an-instructor' });

    await screen.findByRole('heading', { name: /teach on cadence/i });
    await user.click(screen.getByRole('button', { name: /submit application/i }));

    // The short-field rules come from the shared schema, so this proves the
    // client and server agree without duplicating the rules.
    expect(
      await screen.findByText(/add the title learners will see/i),
    ).toBeInTheDocument();
    expect(submitted).not.toHaveBeenCalled();
  });

  it('shows the name and email read-only, from the session', async () => {
    mockSession(learnerUser);
    renderWithRouter(<BecomeInstructorPage />, { path: '/become-an-instructor' });

    const name = await screen.findByLabelText(/full name/i);
    const email = screen.getByLabelText(/^email$/i);

    // The inputs render before `me` resolves, so wait for the value rather
    // than the element: asserting immediately would be a race.
    await waitFor(() => {
      expect(name).toHaveValue('Ada Okafor');
    });
    expect(email).toHaveValue('ada@cadence.dev');
    // Read-only, because the server takes them from req.user regardless.
    expect(name).toBeDisabled();
    expect(email).toBeDisabled();
  });

  it('adds and removes areas of expertise by keyboard', async () => {
    const user = userEvent.setup();
    mockSession(learnerUser);
    renderWithRouter(<BecomeInstructorPage />, { path: '/become-an-instructor' });

    const input = await screen.findByPlaceholderText(/add a skill and press enter/i);

    await user.type(input, 'TypeScript{Enter}');
    await user.type(input, 'Node.js{Enter}');
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
    expect(screen.getByText('Node.js')).toBeInTheDocument();

    // Each tag has its own labelled remove control.
    await user.click(screen.getByRole('button', { name: /remove typescript/i }));
    expect(screen.queryByText('TypeScript')).not.toBeInTheDocument();
    expect(screen.getByText('Node.js')).toBeInTheDocument();
  });

  it('maps a server field error back onto its input', async () => {
    const user = userEvent.setup();
    mockSession(learnerUser);
    server.use(
      http.post(
        '*/api/v1/instructor-applications',
        () =>
          new Response(
            JSON.stringify({
              success: false,
              message: 'Validation failed',
              code: 'VALIDATION_ERROR',
              errors: { professionalTitle: ['That title is already in use'] },
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );

    renderWithRouter(<BecomeInstructorPage />, { path: '/become-an-instructor' });

    /*
     * Pasted, not typed. `user.type` dispatches an event per character,
     * and the long fields here total a few hundred of them — enough to
     * blow the test timeout when the suite runs in parallel. Paste is one
     * event and exercises the same change handlers.
     */
    const fill = async (field: HTMLElement, value: string) => {
      await user.click(field);
      await user.paste(value);
    };

    await fill(
      await screen.findByLabelText(/professional title/i),
      'Senior backend engineer',
    );
    await user.type(
      screen.getByPlaceholderText(/add a skill and press enter/i),
      'TypeScript{Enter}',
    );
    await fill(screen.getByLabelText(/teaching experience/i), 'x'.repeat(60));
    await fill(screen.getByLabelText(/short biography/i), 'b'.repeat(100));
    await fill(screen.getByLabelText(/why do you want to teach/i), 'm'.repeat(60));

    await user.click(screen.getByRole('button', { name: /submit application/i }));

    expect(
      await screen.findByText(/that title is already in use/i),
    ).toBeInTheDocument();
  });
});
