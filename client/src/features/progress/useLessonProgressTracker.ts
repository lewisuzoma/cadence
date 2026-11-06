import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  PROGRESS_MIN_DELTA_SECONDS,
  PROGRESS_SAVE_INTERVAL_MS,
  type ProgressEvent,
} from '@cadence/shared';
import { qk } from '@/lib/query-keys';
import { progressApi, useApplyProgressResult } from './progress.queries';

/**
 * Keeps the server's record of where a learner is in a video.
 *
 * Deliberately NOT a `useMutation` per tick. A 20-minute lesson would fire
 * hundreds of mutations, each re-rendering the tree and each a row write.
 * Instead:
 *
 *  - while playing, save at most once every PROGRESS_SAVE_INTERVAL_MS (10s),
 *    and only when the position moved more than PROGRESS_MIN_DELTA_SECONDS
 *    (2s) — so a paused tab writes nothing
 *  - flush immediately on pause, seek, tab-hide and unmount, because those
 *    are the moments a learner is most likely to walk away
 *  - the unmount/pagehide flush uses `fetch(..., { keepalive: true })` rather
 *    than `navigator.sendBeacon`, because sendBeacon cannot set the
 *    `X-CSRF-Token` header the API requires
 *  - the latest position lives in a ref, never in state: this hook must not
 *    re-render the player on every timeupdate
 *
 * `enabled` is false for preview viewers with no enrollment. The server would
 * refuse those writes with a 403 anyway; not sending them keeps the console
 * and the logs clean.
 */
export type ProgressTracker = {
  /** Call on every `timeupdate`. Cheap: it only writes to a ref. */
  report: (positionSeconds: number) => void;
  /** Force a save now, e.g. on pause or seek. */
  flush: (event: ProgressEvent) => void;
};

export function useLessonProgressTracker(
  lessonId: string,
  options: { enabled: boolean; durationSeconds: number },
): ProgressTracker {
  const { enabled, durationSeconds } = options;
  const queryClient = useQueryClient();
  const applyResult = useApplyProgressResult();

  /** The newest position reported by the media element. */
  const positionRef = useRef(0);
  /** The position last successfully sent, to compute the delta. */
  const savedPositionRef = useRef(0);
  const lastSaveAtRef = useRef(0);
  const inFlightRef = useRef(false);
  const lessonIdRef = useRef(lessonId);

  // Switching lessons must not carry the previous lesson's position over.
  useEffect(() => {
    lessonIdRef.current = lessonId;
    positionRef.current = 0;
    savedPositionRef.current = 0;
    lastSaveAtRef.current = 0;
  }, [lessonId]);

  const send = useCallback(
    async (event: ProgressEvent) => {
      if (!enabled) return;
      const position = Math.floor(positionRef.current);
      if (position <= 0 && savedPositionRef.current === 0 && event === 'heartbeat') return;
      if (inFlightRef.current) return;

      inFlightRef.current = true;
      lastSaveAtRef.current = Date.now();
      try {
        const result = await progressApi.save(lessonIdRef.current, position, event);
        savedPositionRef.current = position;
        applyResult(result);

        // A heartbeat can be the thing that crosses the 90% threshold, so when
        // the server reports completion the rest of the UI has to catch up.
        if (result.progress.isCompleted) {
          void queryClient.invalidateQueries({ queryKey: qk.courses.all });
          void queryClient.invalidateQueries({ queryKey: qk.enrollments.all });
          void queryClient.invalidateQueries({ queryKey: qk.dashboard.all });
        }
      } catch {
        // A dropped save is not worth interrupting playback over: the next
        // heartbeat carries a newer position anyway. Leaving
        // savedPositionRef alone means the delta check will retry.
      } finally {
        inFlightRef.current = false;
      }
    },
    [applyResult, enabled, queryClient],
  );

  /** Throttled: called from `timeupdate`, which fires ~4x a second. */
  const report = useCallback(
    (positionSeconds: number) => {
      const clamped = Math.max(
        0,
        Math.min(positionSeconds, durationSeconds || positionSeconds),
      );
      positionRef.current = clamped;

      const elapsed = Date.now() - lastSaveAtRef.current;
      const moved = Math.abs(clamped - savedPositionRef.current);
      if (elapsed >= PROGRESS_SAVE_INTERVAL_MS && moved > PROGRESS_MIN_DELTA_SECONDS) {
        void send('heartbeat');
      }
    },
    [durationSeconds, send],
  );

  const flush = useCallback(
    (event: ProgressEvent) => {
      void send(event);
    },
    [send],
  );

  /**
   * Page-level exits. `visibilitychange` covers switching tab or locking the
   * phone; `pagehide` covers navigation and closing the tab (and unlike
   * `beforeunload`, it fires reliably on mobile Safari).
   */
  useEffect(() => {
    if (!enabled) return;

    const flushWithKeepalive = (event: ProgressEvent) => {
      const position = Math.floor(positionRef.current);
      if (position <= 0 || position === savedPositionRef.current) return;
      progressApi.flush(lessonIdRef.current, position, event);
      savedPositionRef.current = position;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushWithKeepalive('hidden');
    };
    const onPageHide = () => flushWithKeepalive('hidden');

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      // Unmount: the learner navigated away inside the SPA, so save where
      // they got to. keepalive means this survives the component going away.
      flushWithKeepalive('hidden');
    };
  }, [enabled, lessonId]);

  return { report, flush };
}
