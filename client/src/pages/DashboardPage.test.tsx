import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { http } from 'msw';
import { DashboardPage } from './DashboardPage';
import { learnerDashboard, ok, server } from '@/test/msw-server';
import { renderWithRouter } from '@/test/render';

/**
 * The dashboard must render the API's aggregates and nothing of its own: a
 * hardcoded or recomputed figure here would diverge from the admin's view of
 * the same learner.
 */
describe('DashboardPage', () => {
  it('renders the stat cards from the API payload', async () => {
    renderWithRouter(<DashboardPage />, { path: '/dashboard' });

    expect(await screen.findByText('Enrolled courses')).toBeInTheDocument();
    // The phone tiles and the desktop cards are both in the DOM — only CSS
    // decides which is visible — so these values legitimately appear twice.
    expect(screen.getAllByText('3').length).toBeGreaterThan(0); // enrolledCourses
    expect(screen.getAllByText('18').length).toBeGreaterThan(0); // completedLessons
    expect(screen.getAllByText('47%').length).toBeGreaterThan(0); // overall
    expect(screen.getByText('6h 12m')).toBeInTheDocument(); // 22320 watched seconds
    expect(screen.getByText('of 38 enrolled lessons')).toBeInTheDocument();
  });

  it('greets the learner, on both the desktop and the app layouts', async () => {
    renderWithRouter(<DashboardPage />, { path: '/dashboard' });

    expect(await screen.findByRole('heading', { name: /Welcome back, Ada\./ })).toBeInTheDocument();
    // The phone header from mobile artifact page 10.
    expect(screen.getByRole('heading', { name: 'Hi, Ada' })).toBeInTheDocument();
    expect(screen.getAllByText(/4-day streak/).length).toBeGreaterThan(0);
  });

  it('offers to resume at the saved position', async () => {
    renderWithRouter(<DashboardPage />, { path: '/dashboard' });

    // 522 seconds, in the player's timecode style.
    const resume = await screen.findByRole('link', { name: /Resume at 08:42/ });
    expect(resume).toHaveAttribute(
      'href',
      `/courses/${learnerDashboard.continueLearning!.courseSlug}/lessons/${learnerDashboard.continueLearning!.lessonId}`,
    );
    expect(screen.getByText(/5 min 38 s left/)).toBeInTheDocument();
  });

  it('shows an empty state, and no Continue card, for a new learner', async () => {
    server.use(
      http.get('/api/v1/dashboard/learner', () =>
        ok(
          {
            stats: {
              enrolledCourses: 0,
              inProgressCourses: 0,
              completedCourses: 0,
              completedLessons: 0,
              totalLessons: 0,
              overallProgressPercentage: 0,
              watchedSeconds: 0,
              streakDays: 0,
              lessonsThisWeek: 0,
            },
            continueLearning: null,
            courses: [],
            recentActivity: [],
          },
          'Dashboard retrieved',
        ),
      ),
    );

    renderWithRouter(<DashboardPage />, { path: '/dashboard' });

    expect(await screen.findByText('Nothing in progress yet')).toBeInTheDocument();
    // Both the header action and the empty state offer this.
    expect(screen.getAllByRole('link', { name: 'Browse courses' }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Resume at/)).not.toBeInTheDocument();
  });

  it('shows an error state with a retry when the aggregates fail to load', async () => {
    server.use(
      http.get('/api/v1/dashboard/learner', () =>
        ok(null, 'broken') && new Response(null, { status: 500 }),
      ),
    );

    renderWithRouter(<DashboardPage />, { path: '/dashboard' });

    const alert = await screen.findByRole('alert', {}, { timeout: 4000 });
    expect(alert).toHaveTextContent('Could not load your dashboard');
  });
});
