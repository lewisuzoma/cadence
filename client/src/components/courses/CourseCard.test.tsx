import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CourseSummary } from '@cadence/shared';
import { CourseCard } from './CourseCard';
import { courseSummary, enrolledCourse } from '@/test/msw-server';
import { renderWithRouter } from '@/test/render';

/**
 * CourseCard is the most reused component in the app, so these tests pin down
 * every field the design requires it to show, and each enrollment state's CTA.
 */
describe('CourseCard', () => {
  it('renders every field the design specifies', () => {
    renderWithRouter(<CourseCard course={courseSummary} />);

    expect(screen.getByRole('heading', { name: courseSummary.title })).toBeInTheDocument();
    expect(screen.getByText(/Build a typed Node.js API/)).toBeInTheDocument();
    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('Intermediate')).toBeInTheDocument();
    // 15600 seconds formatted the way the catalog shows it.
    expect(screen.getByText('4h 20m')).toBeInTheDocument();
    expect(screen.getByText(/12 lessons/)).toBeInTheDocument();
  });

  it('shows Not started with no progress bar when not enrolled', () => {
    renderWithRouter(<CourseCard course={courseSummary} />);

    expect(screen.getByText('Not started')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Enroll — free/ })).toBeInTheDocument();
  });

  it('shows progress and a Resume action when in progress', () => {
    renderWithRouter(<CourseCard course={enrolledCourse} />);

    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText('58%')).toBeInTheDocument();

    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '58');
    // The accessible name says what is progressing, not just a number.
    expect(bar).toHaveAccessibleName(`${enrolledCourse.title} progress`);

    expect(screen.getByRole('link', { name: /Resume/ })).toBeInTheDocument();
  });

  it('shows Review course once completed', () => {
    const completed: CourseSummary = {
      ...enrolledCourse,
      enrollment: {
        ...enrolledCourse.enrollment!,
        status: 'COMPLETED',
        progressPercentage: 100,
        completedLessons: 12,
        completedAt: '2026-03-01T00:00:00.000Z',
      },
    };
    renderWithRouter(<CourseCard course={completed} />);

    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Review course/ })).toBeInTheDocument();
  });

  it('links to the course by slug', () => {
    renderWithRouter(<CourseCard course={courseSummary} />);
    const link = screen.getByRole('link', { name: courseSummary.title });
    expect(link).toHaveAttribute('href', `/courses/${courseSummary.slug}`);
  });

  it('prefetches on hover, so opening the course feels instant', async () => {
    const onPrefetch = vi.fn();
    renderWithRouter(<CourseCard course={courseSummary} onPrefetch={onPrefetch} />);

    await userEvent.hover(screen.getByRole('heading', { name: courseSummary.title }));
    expect(onPrefetch).toHaveBeenCalledWith(courseSummary.slug);
  });

  it('gives the thumbnail an empty alt, since the title is adjacent', () => {
    renderWithRouter(<CourseCard course={courseSummary} />);
    // A decorative image repeating the heading would be noise for a screen
    // reader, so it is deliberately alt="".
    const image = document.querySelector('img');
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('loading', 'lazy');
  });
});
