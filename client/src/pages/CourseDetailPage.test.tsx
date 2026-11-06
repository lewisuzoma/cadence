import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { CourseDetailPage } from './CourseDetailPage';
import { courseDetail, fail, ok, server } from '@/test/msw-server';
import { renderWithRouter } from '@/test/render';

const PATH = '/courses/:slug';
const ENTRY = `/courses/${courseDetail.slug}`;

const render = () =>
  renderWithRouter(<CourseDetailPage />, { path: PATH, initialEntries: [ENTRY] });

describe('CourseDetailPage', () => {
  it('renders the hero, meta and curriculum from the API', async () => {
    render();

    expect(
      await screen.findByRole('heading', { level: 1, name: courseDetail.title }),
    ).toBeInTheDocument();
    expect(screen.getByText('4h 20m')).toBeInTheDocument();
    expect(screen.getByText(/1 module · 12 lessons/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Module 1 · Foundations' })).toBeInTheDocument();
  });

  it('offers to enrol when the learner is not enrolled', async () => {
    render();
    expect(await screen.findByRole('button', { name: /Enrol — free/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Continue/ })).not.toBeInTheDocument();
  });

  it('flips to the enrolled state optimistically, before the server answers', async () => {
    let resolveEnroll: (() => void) | undefined;
    server.use(
      http.post('/api/v1/courses/:courseId/enroll', async () => {
        // Held open so the assertion lands while the request is in flight.
        await new Promise<void>((resolve) => {
          resolveEnroll = resolve;
        });
        return ok({}, 'Enrolled');
      }),
    );

    render();
    await userEvent.click(await screen.findByRole('button', { name: /Enrol — free/ }));

    // The optimistic cache write has already switched the panel over.
    await waitFor(() => {
      expect(screen.getByText('0 of 12 complete')).toBeInTheDocument();
    });
    // The rail and the lesson rows can both show a bar; at least one is here.
    expect(screen.getAllByRole('progressbar').length).toBeGreaterThan(0);

    resolveEnroll?.();
  });

  it('rolls the optimistic update back when enrolling fails', async () => {
    server.use(
      http.post('/api/v1/courses/:courseId/enroll', () =>
        fail(422, 'UNPROCESSABLE', 'This course has been archived and is no longer open'),
      ),
    );

    render();
    await userEvent.click(await screen.findByRole('button', { name: /Enrol — free/ }));

    // Back to the not-enrolled panel rather than a false "enrolled" state.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Enrol — free/ })).toBeInTheDocument();
    });
    expect(screen.queryByText('0 of 12 complete')).not.toBeInTheDocument();
  });

  it('shows progress and a Continue action for an enrolled learner', async () => {
    server.use(
      http.get('/api/v1/courses/:idOrSlug', () =>
        ok(
          {
            ...courseDetail,
            enrollment: {
              isEnrolled: true,
              status: 'ACTIVE',
              progressPercentage: 58,
              completedLessons: 7,
              lastLessonId: courseDetail.modules[0]!.lessons[0]!.id,
              enrolledAt: '2026-02-10T00:00:00.000Z',
              completedAt: null,
            },
          },
          'Course retrieved',
        ),
      ),
    );

    render();

    expect(await screen.findByText('7 of 12 complete')).toBeInTheDocument();
    expect(screen.getByText('58%')).toBeInTheDocument();
    const continueLink = screen.getByRole('link', { name: /Continue/ });
    expect(continueLink).toHaveAttribute(
      'href',
      `/courses/${courseDetail.slug}/lessons/${courseDetail.modules[0]!.lessons[0]!.id}`,
    );
  });

  it('shows the not-found state for a course that does not exist', async () => {
    server.use(
      http.get('/api/v1/courses/:idOrSlug', () => fail(404, 'NOT_FOUND', 'Course not found')),
    );

    render();
    expect(await screen.findByText('We could not find that page')).toBeInTheDocument();
  });

  it('locks non-preview lessons for a visitor who has not enrolled', async () => {
    render();

    await screen.findByRole('heading', { level: 1, name: courseDetail.title });
    // The first seeded lesson is a preview, the second is not.
    expect(screen.getByRole('link', { name: /Project setup and tsconfig/ })).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /Types that model your domain/ }),
    ).not.toBeInTheDocument();
  });
});
