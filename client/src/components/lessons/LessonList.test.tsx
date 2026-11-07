import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import type { LessonSummary, ModuleWithLessons } from '@cadence/shared';
import { LessonList } from './LessonList';
import { renderWithRouter } from '@/test/render';

const lesson = (overrides: Partial<LessonSummary> & { id: string }): LessonSummary => ({
  moduleId: 'module-1',
  courseId: 'course-1',
  title: 'A lesson',
  description: '',
  durationSeconds: 600,
  order: 1,
  isPreview: false,
  videoKind: 'URL',
  status: 'NOT_STARTED',
  progress: null,
  ...overrides,
});

const modules: ModuleWithLessons[] = [
  {
    id: 'module-1',
    title: 'Module 1 · Foundations',
    order: 1,
    lessons: [
      lesson({
        id: 'l1',
        title: 'Completed lesson',
        status: 'COMPLETED',
        order: 1,
        progress: {
          lastPositionSeconds: 600,
          maxWatchedSeconds: 600,
          completionPercentage: 100,
          isCompleted: true,
          completedAt: '2026-03-01T00:00:00.000Z',
          updatedAt: '2026-03-01T00:00:00.000Z',
        },
      }),
      lesson({
        id: 'l2',
        title: 'In progress lesson',
        status: 'IN_PROGRESS',
        order: 2,
        durationSeconds: 860,
        progress: {
          lastPositionSeconds: 522,
          maxWatchedSeconds: 522,
          completionPercentage: 61,
          isCompleted: false,
          completedAt: null,
          updatedAt: '2026-03-02T00:00:00.000Z',
        },
      }),
      lesson({ id: 'l3', title: 'Not started lesson', status: 'NOT_STARTED', order: 3 }),
      lesson({ id: 'l4', title: 'Locked lesson', status: 'LOCKED', order: 4 }),
    ],
  },
];

describe('LessonList', () => {
  it('shows a status for every lesson, as a word and not only a colour', () => {
    renderWithRouter(<LessonList modules={modules} courseSlug="course" />, { path: '/' });

    // The design's rule: "Status = icon + word + colour. Never colour alone."
    expect(screen.getByText('Completed lesson')).toBeInTheDocument();
    expect(screen.getByText('In progress lesson')).toBeInTheDocument();
    expect(screen.getByText('61% watched')).toBeInTheDocument();
  });

  it('numbers lessons across the whole course and shows durations', () => {
    renderWithRouter(<LessonList modules={modules} courseSlug="course" />, { path: '/' });

    expect(screen.getByText('01')).toBeInTheDocument();
    expect(screen.getByText('04')).toBeInTheDocument();
    // 860 seconds in the player's timecode style.
    expect(screen.getByText('14:20')).toBeInTheDocument();
  });

  it('marks the lesson being watched with aria-current', () => {
    renderWithRouter(
      <LessonList modules={modules} courseSlug="course" currentLessonId="l2" />,
      { path: '/' },
    );

    const current = screen.getByRole('link', { name: /In progress lesson/ });
    expect(current).toHaveAttribute('aria-current', 'true');

    const other = screen.getByRole('link', { name: /Not started lesson/ });
    expect(other).not.toHaveAttribute('aria-current');
  });

  it('does not make a locked lesson a link, so it is not a dead tab stop', () => {
    renderWithRouter(<LessonList modules={modules} courseSlug="course" />, { path: '/' });

    expect(screen.queryByRole('link', { name: /Locked lesson/ })).not.toBeInTheDocument();
    expect(screen.getByText('Locked lesson')).toBeInTheDocument();
    expect(screen.getByText(/Enroll in this course to watch/)).toBeInTheDocument();
  });

  it('locks every non-preview lesson for a visitor who cannot open them', () => {
    const open: ModuleWithLessons[] = [
      {
        ...modules[0]!,
        lessons: [
          lesson({ id: 'p1', title: 'Free preview', isPreview: true, order: 1 }),
          lesson({ id: 'p2', title: 'Members only', order: 2 }),
        ],
      },
    ];

    renderWithRouter(<LessonList modules={open} courseSlug="course" canOpen={false} />, {
      path: '/',
    });

    // The preview stays open, and says so.
    expect(screen.getByRole('link', { name: /Free preview/ })).toBeInTheDocument();
    expect(screen.getByText('Preview')).toBeInTheDocument();
    // The rest is locked.
    expect(screen.queryByRole('link', { name: /Members only/ })).not.toBeInTheDocument();
  });

  it('links each lesson to its player route', () => {
    renderWithRouter(<LessonList modules={modules} courseSlug="my-course" />, { path: '/' });

    expect(screen.getByRole('link', { name: /Completed lesson/ })).toHaveAttribute(
      'href',
      '/courses/my-course/lessons/l1',
    );
  });

  it('summarises each module with its lesson count and completion', () => {
    renderWithRouter(<LessonList modules={modules} courseSlug="course" />, { path: '/' });

    expect(screen.getByRole('heading', { name: 'Module 1 · Foundations' })).toBeInTheDocument();
    // 1 of 4 complete.
    expect(screen.getByText(/1\/4/)).toBeInTheDocument();
  });
});
