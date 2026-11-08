import { describe, expect, it, vi } from 'vitest';
import { http } from 'msw';
import userEvent from '@testing-library/user-event';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { CourseAnalytics, LessonSummary, ModuleWithLessons } from '@cadence/shared';
import { renderWithRouter } from '@/test/render';
import { ok, server } from '@/test/msw-server';
import { ManageLessonsPage } from '@/pages/instructor/ManageLessonsPage';
import { CourseAnalyticsPage } from '@/pages/instructor/CourseAnalyticsPage';
import { VideoUploader } from '@/components/instructor/VideoUploader';

/**
 * The three component behaviours the brief calls out by name: keyboard
 * reordering, the uploader's progress/failure/retry, and the analytics
 * empty states.
 */

const COURSE_ID = '33333333-3333-3333-3333-333333333333';
const MODULE_ID = '55555555-5555-5555-5555-555555555555';

function lesson(id: string, title: string, order: number): LessonSummary {
  return {
    id,
    moduleId: MODULE_ID,
    courseId: COURSE_ID,
    title,
    description: '',
    durationSeconds: 600,
    order,
    isPreview: false,
    videoKind: 'URL',
    status: 'NOT_STARTED',
    progress: null,
  };
}

const MODULE: ModuleWithLessons = {
  id: MODULE_ID,
  title: 'Foundations',
  order: 1,
  lessons: [
    lesson('aaaaaaaa-0000-0000-0000-000000000001', 'First lesson', 1),
    lesson('aaaaaaaa-0000-0000-0000-000000000002', 'Second lesson', 2),
    lesson('aaaaaaaa-0000-0000-0000-000000000003', 'Third lesson', 3),
  ],
};

function mockCourse() {
  server.use(
    http.get(`*/api/v1/instructor/courses/${COURSE_ID}`, () =>
      ok({
        id: COURSE_ID,
        slug: 'a-course',
        title: 'A course',
        description: 'x'.repeat(100),
        shortDescription: 'A course.',
        category: 'Engineering',
        thumbnailUrl: '/t.svg',
        difficulty: 'BEGINNER',
        status: 'DRAFT',
        lessonCount: 3,
        estimatedDuration: 1800,
        publishedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        enrollment: null,
        instructor: null,
        modules: [MODULE],
        learningObjectives: [],
        prerequisites: [],
        targetAudience: '',
        createdBy: null,
      }),
    ),
  );
}

describe('reordering lessons by keyboard', () => {
  it('moves a lesson with the arrow buttons and sends the new order', async () => {
    const user = userEvent.setup();
    mockCourse();

    const reordered = vi.fn();
    server.use(
      http.patch(
        `*/api/v1/instructor/modules/${MODULE_ID}/lessons/reorder`,
        async ({ request }) => {
          reordered(await request.json());
          return ok([]);
        },
      ),
    );

    renderWithRouter(<ManageLessonsPage />, {
      path: '/instructor/courses/:id/lessons',
      initialEntries: [`/instructor/courses/${COURSE_ID}/lessons`],
    });

    // Every row carries its own labelled Move up / Move down button, so a
    // keyboard or screen-reader user never has to discover the drag handle.
    const moveDown = await screen.findByRole('button', {
      name: /move first lesson down/i,
    });
    expect(moveDown).toBeInTheDocument();

    // Reachable and operable by keyboard alone.
    moveDown.focus();
    expect(moveDown).toHaveFocus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(reordered).toHaveBeenCalledWith({
        lessonIds: [
          'aaaaaaaa-0000-0000-0000-000000000002',
          'aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000003',
        ],
      });
    });
  });

  it('disables Move up on the first row and Move down on the last', async () => {
    mockCourse();
    renderWithRouter(<ManageLessonsPage />, {
      path: '/instructor/courses/:id/lessons',
      initialEntries: [`/instructor/courses/${COURSE_ID}/lessons`],
    });

    expect(
      await screen.findByRole('button', { name: /move first lesson up/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /move third lesson down/i }),
    ).toBeDisabled();
    // ...and the ones in between are live.
    expect(screen.getByRole('button', { name: /move second lesson up/i })).toBeEnabled();
  });
});

describe('the video uploader', () => {
  /** A fake XHR that lets a test drive progress, success and failure. */
  function stubXhr() {
    const listeners: Record<string, ((event: unknown) => void)[]> = {};
    const uploadListeners: Record<string, ((event: unknown) => void)[]> = {};

    const xhr = {
      upload: {
        addEventListener: (type: string, handler: (event: unknown) => void) => {
          (uploadListeners[type] ??= []).push(handler);
        },
      },
      addEventListener: (type: string, handler: (event: unknown) => void) => {
        (listeners[type] ??= []).push(handler);
      },
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      send: vi.fn(),
      abort: vi.fn(),
      // The uploader reads the part's ETag from the response, so a stub
      // has to answer the same question a real XHR would.
      getResponseHeader: vi.fn(() => '"stub-etag"'),
      status: 200,
      withCredentials: false,
    };

    vi.stubGlobal(
      'XMLHttpRequest',
      vi.fn(() => xhr),
    );

    return {
      xhr,
      progress: (loaded: number, total: number) => {
        for (const handler of uploadListeners.progress ?? []) {
          handler({ lengthComputable: true, loaded, total });
        }
      },
      finish: (status: number) => {
        xhr.status = status;
        for (const handler of listeners.load ?? []) handler({});
      },
      fail: () => {
        for (const handler of listeners.error ?? []) handler({});
      },
    };
  }

  function mockPresign() {
    server.use(
      http.post('*/api/v1/uploads/presign', () =>
        ok({
          assetId: '99999999-9999-9999-9999-999999999999',
          uploadUrl: '/api/v1/uploads/by-key/k/bytes',
          method: 'PUT',
          headers: {},
          storageKey: 'k',
          expiresInSeconds: 900,
        }),
      ),
    );
  }

  /**
   * jsdom loads no media, so neither `loadedmetadata` nor `error` ever
   * fires and the duration probe would sit on its 5-second deadline.
   * Dispatching `error` makes it give up at once; the server measures the
   * duration itself anyway, which is the path this exercises.
   */
  function stubMediaProbe() {
    // jsdom implements neither of these.
    URL.createObjectURL ??= () => 'blob:stub';
    URL.revokeObjectURL ??= () => undefined;
    const original = HTMLMediaElement.prototype.load;
    Object.defineProperty(window.HTMLMediaElement.prototype, 'src', {
      configurable: true,
      set(this: HTMLMediaElement) {
        queueMicrotask(() => this.dispatchEvent(new Event('error')));
      },
    });
    return () => {
      HTMLMediaElement.prototype.load = original;
    };
  }

  /**
   * A 12 MB file.
   *
   * Real bytes, because the uploader now takes the total from the
   * `File` itself rather than from the XHR progress event — which is
   * the more honest source, and means a fixture has to be the size it
   * claims to be.
   */
  const FILE_BYTES = 12 * 1024 * 1024;

  function videoFile() {
    return new File([new Uint8Array(FILE_BYTES)], 'lesson.mp4', { type: 'video/mp4' });
  }

  it('shows progress while uploading, then the ready state', async () => {
    stubMediaProbe();
    mockPresign();
    const transfer = stubXhr();
    server.use(
      http.post('*/api/v1/uploads/*/complete', () =>
        ok({
          id: '99999999-9999-9999-9999-999999999999',
          kind: 'VIDEO',
          status: 'READY',
          mimeType: 'video/mp4',
          sizeBytes: FILE_BYTES,
          durationSeconds: 1008,
          originalName: 'lesson.mp4',
          url: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
      ),
    );

    const onChange = vi.fn();
    const { container } = renderWithRouter(
      <VideoUploader courseId={COURSE_ID} value={{}} onChange={onChange} />,
      { path: '/' },
    );

    expect(screen.getByText(/drop a video or choose a file/i)).toBeInTheDocument();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    // The input is `sr-only`, which userEvent's pointer-events check will
    // not click. Firing `change` is exactly what the real picker does.
    fireEvent.change(input, { target: { files: [videoFile()] } });

    // 2 · UPLOADING, with the byte counts the artifact shows.
    await waitFor(() => {
      expect(screen.getByText(/lesson\.mp4/i)).toBeInTheDocument();
    });
    // The XHR exists only once presign has resolved; its listeners are
    // registered with it, so driving events earlier would hit nothing.
    await waitFor(() => {
      expect(transfer.xhr.send).toHaveBeenCalled();
    });
    // 64% of 12 MB, as the artifact's "264 of 412 MB · 64%" line reads.
    transfer.progress(Math.round(FILE_BYTES * 0.64), FILE_BYTES);
    await waitFor(() => {
      expect(
        screen.getByText((content) => /8 of 12 MB/.test(content)),
      ).toBeInTheDocument();
    });
    expect(screen.getByText((content) => /64%/.test(content))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();

    // 3 · PROCESSING → 4 · READY, with the duration the server detected.
    transfer.finish(200);
    await waitFor(() => {
      expect(screen.getByText(/duration detected: 16:48/i)).toBeInTheDocument();
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ durationSeconds: 1008 }),
    );

    vi.unstubAllGlobals();
  });

  it('shows the failure state and offers a retry', async () => {
    stubMediaProbe();
    mockPresign();
    const transfer = stubXhr();

    const { container } = renderWithRouter(
      <VideoUploader courseId={COURSE_ID} value={{}} onChange={vi.fn()} />,
      { path: '/' },
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [videoFile()] } });
    await waitFor(() => {
      expect(screen.getByText(/lesson\.mp4/i)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(transfer.xhr.send).toHaveBeenCalled();
    });

    transfer.fail();

    // 5 · FAILED, saying plainly that nothing was kept.
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/failed/i)).toBeInTheDocument();
    expect(
      within(alert).getByText(/nothing was saved; retrying continues from the start/i),
    ).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: /retry upload/i })).toBeEnabled();
    expect(within(alert).getByRole('button', { name: /choose another/i })).toBeEnabled();

    vi.unstubAllGlobals();
  });

  it('offers an external URL as the other way to give a lesson a video', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithRouter(
      <VideoUploader courseId={COURSE_ID} value={{}} onChange={onChange} />,
      { path: '/' },
    );

    await user.click(screen.getByRole('tab', { name: /paste a video url/i }));
    await user.type(
      screen.getByLabelText(/video url/i),
      'https://example.com/lesson.mp4',
    );

    expect(onChange).toHaveBeenCalled();
    expect(screen.getByText(/must start with https:\/\//i)).toBeInTheDocument();
  });
});

describe('analytics empty states', () => {
  const EMPTY: CourseAnalytics = {
    courseId: COURSE_ID,
    courseTitle: 'Observability for Backend Engineers',
    courseStatus: 'DRAFT',
    lessonCount: 2,
    stats: {
      enrolled: 0,
      active: 0,
      inactive: 0,
      completed: 0,
      completionRate: 0,
      averageProgress: 0,
      lessonsCompleted: 0,
      firstEnrollmentAt: null,
    },
    enrollmentsOverTime: [],
    progressDistribution: [
      { band: '0-25', count: 0, percentage: 0 },
      { band: '25-50', count: 0, percentage: 0 },
      { band: '50-75', count: 0, percentage: 0 },
      { band: '75-99', count: 0, percentage: 0 },
      { band: '100', count: 0, percentage: 0 },
    ],
    lessonCompletion: [],
    activeDays: 14,
    generatedAt: '2026-11-07T14:40:00.000Z',
  };

  it('renders the no-learners state for a draft rather than empty charts', async () => {
    server.use(
      http.get(`*/api/v1/instructor/courses/${COURSE_ID}/analytics`, () => ok(EMPTY)),
      http.get('*/api/v1/instructor/courses', () =>
        ok([], 'ok', { page: 1, pageSize: 50, total: 0, totalPages: 1 }),
      ),
    );

    renderWithRouter(<CourseAnalyticsPage />, {
      path: '/instructor/courses/:id/analytics',
      initialEntries: [`/instructor/courses/${COURSE_ID}/analytics`],
    });

    // The page-level empty state, not the per-chart ones.
    expect(
      await screen.findByRole('heading', { name: /no learners yet/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/this course is a draft\. charts appear after the first enrollment/i),
    ).toBeInTheDocument();
    // The draft gets a way forward, not just an apology.
    expect(screen.getByRole('link', { name: /finish & publish/i })).toBeInTheDocument();
  });

  it('still shows the stat cards, at zero, so the page is not blank', async () => {
    server.use(
      http.get(`*/api/v1/instructor/courses/${COURSE_ID}/analytics`, () => ok(EMPTY)),
      http.get('*/api/v1/instructor/courses', () =>
        ok([], 'ok', { page: 1, pageSize: 50, total: 0, totalPages: 1 }),
      ),
    );

    renderWithRouter(<CourseAnalyticsPage />, {
      path: '/instructor/courses/:id/analytics',
      initialEntries: [`/instructor/courses/${COURSE_ID}/analytics`],
    });

    await screen.findByRole('heading', { name: /no learners yet/i });
    // "Enrolled" appears as a stat-card label and again in the
    // definitions panel; both are intended.
    expect(screen.getAllByText('Enrolled').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Completion rate').length).toBeGreaterThan(0);
    // Each empty chart says why it is empty rather than drawing nothing.
    expect(screen.getAllByText(/no enrollments yet|no learners yet/i).length).toBeGreaterThan(1);
  });

  it('names the active window it used, so the figure is interpretable', async () => {
    server.use(
      http.get(`*/api/v1/instructor/courses/${COURSE_ID}/analytics`, () =>
        ok({ ...EMPTY, stats: { ...EMPTY.stats, enrolled: 10, active: 4, inactive: 6 } }),
      ),
      http.get('*/api/v1/instructor/courses', () =>
        ok([], 'ok', { page: 1, pageSize: 50, total: 0, totalPages: 1 }),
      ),
    );

    renderWithRouter(<CourseAnalyticsPage />, {
      path: '/instructor/courses/:id/analytics',
      initialEntries: [`/instructor/courses/${COURSE_ID}/analytics`],
    });

    // Said in two places — the chart's subtitle and the definitions
    // panel — which is deliberate: the figure must be interpretable
    // wherever it is read.
    const mentions = await screen.findAllByText(
      /progress or enrollment activity in the last 14 days/i,
    );
    expect(mentions.length).toBeGreaterThan(0);
  });
});
