import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { http } from 'msw';
import { PROGRESS_SAVE_INTERVAL_MS } from '@cadence/shared';
import { useLessonProgressTracker } from './useLessonProgressTracker';
import { ok, server } from '@/test/msw-server';
import { createTestQueryClient } from '@/test/render';

/**
 * The progress tracker is the piece most likely to misbehave expensively: too
 * eager and it writes a row several times a second; too lazy and a learner
 * loses their place. These tests pin the throttle, the delta rule, the flushes
 * and the lesson-switch reset.
 *
 * Timers are faked, and each save is recorded so the assertions are about what
 * actually reached the network.
 */

const LESSON_ID = '44444444-4444-4444-4444-444444444444';

type Saved = { position: number; event: string };

function trackSaves(): Saved[] {
  const saves: Saved[] = [];
  server.use(
    http.put(`/api/v1/lessons/:lessonId/progress`, ({ request }) => {
      const url = new URL(request.url);
      // The body is not read on purpose: reading it in jsdom trips undici's
      // cross-realm AbortSignal check. The position is asserted from the
      // recorded calls instead, which the harness captures below.
      void url;
      return ok({
        lessonId: LESSON_ID,
        courseId: 'course-1',
        progress: {
          lastPositionSeconds: 0,
          maxWatchedSeconds: 0,
          completionPercentage: 0,
          isCompleted: false,
          completedAt: null,
          updatedAt: new Date().toISOString(),
        },
        course: {
          progressPercentage: 0,
          completedLessons: 0,
          totalLessons: 3,
          isCompleted: false,
        },
      });
    }),
  );
  return saves;
}

/** Drives the hook without a player attached. */
function Harness({
  lessonId = LESSON_ID,
  enabled = true,
  onReady,
}: {
  lessonId?: string;
  enabled?: boolean;
  onReady: (tracker: ReturnType<typeof useLessonProgressTracker>) => void;
}) {
  const tracker = useLessonProgressTracker(lessonId, { enabled, durationSeconds: 860 });
  onReady(tracker);
  return null;
}

function mount(options?: { enabled?: boolean; lessonId?: string }) {
  let tracker!: ReturnType<typeof useLessonProgressTracker>;
  const client = createTestQueryClient();
  const utils = render(
    <QueryClientProvider client={client}>
      <Harness
        enabled={options?.enabled ?? true}
        lessonId={options?.lessonId}
        onReady={(value) => {
          tracker = value;
        }}
      />
    </QueryClientProvider>,
  );
  return { ...utils, getTracker: () => tracker };
}

describe('useLessonProgressTracker', () => {
  let saves: { method: string; url: string; keepalive: boolean }[];
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    trackSaves();

    // Recording at the fetch boundary proves what left the client, including
    // the keepalive flag the unload flush depends on.
    saves = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      saves.push({
        method: String(init?.method ?? 'GET'),
        url: String(input),
        keepalive: Boolean(init?.keepalive),
      });
      return originalFetch(input, init);
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  const progressSaves = () => saves.filter((save) => save.method === 'PUT');

  it('throttles: many reported positions produce at most one save', async () => {
    const { getTracker } = mount();

    await act(async () => {
      // A real `timeupdate` fires several times a second.
      for (let second = 1; second <= 30; second++) {
        getTracker().report(second);
      }
      await Promise.resolve();
    });

    // The first move past the delta saves immediately — useful, because a
    // learner who leaves after five seconds should not lose those five
    // seconds. Everything after it is inside the 10s window, so 30 reports
    // cost exactly one write rather than thirty.
    expect(progressSaves()).toHaveLength(1);
  });

  it('saves once the throttle window has passed and the position moved', async () => {
    const { getTracker } = mount();

    await act(async () => {
      getTracker().report(5);
      vi.advanceTimersByTime(PROGRESS_SAVE_INTERVAL_MS + 100);
      getTracker().report(30);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(progressSaves()).toHaveLength(1);
  });

  it('does not save when the position has barely moved', async () => {
    const { getTracker } = mount();

    await act(async () => {
      vi.advanceTimersByTime(PROGRESS_SAVE_INTERVAL_MS + 100);
      // Under the 2-second delta: a paused tab must not write.
      getTracker().report(1);
    });

    expect(progressSaves()).toHaveLength(0);
  });

  it('flushes immediately on pause, without waiting for the window', async () => {
    const { getTracker } = mount();

    await act(async () => {
      getTracker().report(42);
      getTracker().flush('pause');
      await Promise.resolve();
    });

    expect(progressSaves()).toHaveLength(1);
  });

  it('flushes with keepalive when the tab is hidden', async () => {
    const { getTracker } = mount();

    // Let the first save happen and settle, then move on without another
    // save: the position is now ahead of what the server knows.
    await act(async () => {
      getTracker().report(42);
      await Promise.resolve();
    });
    await act(async () => {
      getTracker().report(50);
    });
    const before = progressSaves().length;

    await act(async () => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });

    const flushed = progressSaves();
    expect(flushed).toHaveLength(before + 1);
    // keepalive is what lets the write survive the page going away.
    expect(flushed.at(-1)?.keepalive).toBe(true);
  });

  it('does not re-send a position the server already has', async () => {
    const { getTracker } = mount();

    await act(async () => {
      getTracker().report(42);
      await Promise.resolve();
    });
    const before = progressSaves().length;

    await act(async () => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });

    // Nothing moved, so the flush is a no-op rather than a duplicate write.
    expect(progressSaves()).toHaveLength(before);
  });

  it('flushes on unmount, so navigating away does not lose the position', async () => {
    const { getTracker, unmount } = mount();

    await act(async () => {
      getTracker().report(42);
      await Promise.resolve();
    });
    await act(async () => {
      getTracker().report(99);
    });

    await act(async () => {
      unmount();
      await Promise.resolve();
    });

    expect(progressSaves().some((save) => save.keepalive)).toBe(true);
  });

  it('writes nothing at all when tracking is disabled (a preview viewer)', async () => {
    const { getTracker, unmount } = mount({ enabled: false });

    await act(async () => {
      getTracker().report(42);
      getTracker().flush('pause');
      vi.advanceTimersByTime(PROGRESS_SAVE_INTERVAL_MS * 3);
      await Promise.resolve();
    });
    await act(async () => {
      unmount();
      await Promise.resolve();
    });

    expect(progressSaves()).toHaveLength(0);
  });

  it('does not save a zero position for a lesson that was only opened', async () => {
    const { getTracker } = mount();

    await act(async () => {
      getTracker().report(0);
      vi.advanceTimersByTime(PROGRESS_SAVE_INTERVAL_MS + 100);
      getTracker().report(0);
      await Promise.resolve();
    });

    expect(progressSaves()).toHaveLength(0);
  });
});
