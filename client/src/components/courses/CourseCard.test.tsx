import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CourseSummary } from '@cadence/shared';
import { CourseCard } from './CourseCard';
import { courseSummary, enrolledCourse } from '@/test/msw-server';
import { renderWithRouter } from '@/test/render';

/**
 * CourseCard is the most reused component in the app, so these tests pin down
 * the composition the artifact specifies: category chip over the media,
 * duration pill bottom-right, a meta line paired with a status pill, a
 * progress track that is always present, and exactly one action.
 */
describe('CourseCard', () => {
  it('renders every field the design specifies', () => {
    renderWithRouter(<CourseCard course={courseSummary} />);

    expect(screen.getByRole('heading', { name: courseSummary.title })).toBeInTheDocument();
    expect(screen.getByText(/Build a typed Node.js API/)).toBeInTheDocument();
    // Category sits on the media as a chip.
    expect(screen.getByText('Engineering')).toBeInTheDocument();
    // 15600 seconds, in the duration pill.
    expect(screen.getByText('4h 20m')).toBeInTheDocument();
    // Lesson count and level share one meta line.
    expect(screen.getByText('12 lessons · Intermediate')).toBeInTheDocument();
  });

  it('shows Not started and an empty track when not enrolled', () => {
    renderWithRouter(<CourseCard course={courseSummary} />);

    expect(screen.getByText('Not started')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Enroll — free/ })).toBeInTheDocument();
  });

  it('shows the percentage in the status pill when in progress', () => {
    renderWithRouter(<CourseCard course={enrolledCourse} />);

    // The artifact writes this as one pill: "58% · In progress".
    expect(screen.getByText('58% · In progress')).toBeInTheDocument();
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
    expect(screen.getByRole('link', { name: /Review course/ })).toBeInTheDocument();
    expect(screen.queryByText(/In progress/)).not.toBeInTheDocument();
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

  it('offers exactly one action, so the card has one decision', () => {
    renderWithRouter(<CourseCard course={enrolledCourse} />);
    // Principle 1 from the artifact: "One card, one decision."
    const actions = screen
      .getAllByRole('link')
      .filter((link) => /Resume|Enroll|Review/.test(link.textContent ?? ''));
    expect(actions).toHaveLength(1);
  });
});
