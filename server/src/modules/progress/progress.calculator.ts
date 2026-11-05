import { COMPLETION_THRESHOLD, END_TOLERANCE_SECONDS } from '@cadence/shared';

/**
 * The completion rules, as pure functions.
 *
 * This is the only place that decides what a watch position means. Services
 * call it inside a transaction; it never touches Prisma, time or randomness,
 * so every rule here is unit-testable in isolation.
 */

export type ProgressSnapshot = {
  lastPositionSeconds: number;
  maxWatchedSeconds: number;
  completionPercentage: number;
  isCompleted: boolean;
};

/** A position outside the video cannot mean anything, so it is clamped. */
export function clampPosition(positionSeconds: number, durationSeconds: number): number {
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0) return 0;
  return Math.min(Math.floor(positionSeconds), durationSeconds);
}

/**
 * Applies a reported position to the stored progress.
 *
 *  - `lastPositionSeconds` always takes the newest value: that is what resume
 *    uses, and seeking backwards is a legitimate thing to resume from.
 *  - `maxWatchedSeconds` never decreases, so rewatching cannot remove credit.
 *  - completion is sticky: once true it stays true, and `completionPercentage`
 *    stays at 100 even if the learner then scrubs back to the start.
 */
export function applyProgress(
  previous: ProgressSnapshot | null,
  positionSeconds: number,
  durationSeconds: number,
): ProgressSnapshot {
  const position = clampPosition(positionSeconds, durationSeconds);
  const previousMax = previous?.maxWatchedSeconds ?? 0;
  const maxWatchedSeconds = Math.max(previousMax, position);

  const wasCompleted = previous?.isCompleted ?? false;
  const reachedThreshold = meetsThreshold(maxWatchedSeconds, durationSeconds);
  const isCompleted = wasCompleted || reachedThreshold;

  return {
    lastPositionSeconds: position,
    maxWatchedSeconds,
    completionPercentage: isCompleted
      ? 100
      : percentageWatched(maxWatchedSeconds, durationSeconds),
    isCompleted,
  };
}

/** Has enough of the lesson been watched to count as complete? */
export function meetsThreshold(maxWatchedSeconds: number, durationSeconds: number): boolean {
  if (durationSeconds <= 0) return false;
  return maxWatchedSeconds >= durationSeconds * COMPLETION_THRESHOLD;
}

/**
 * Whether an explicit completion request is believable.  Accepted when the
 * learner has genuinely watched ~90%, or when the position is within the
 * end tolerance — which is what the video element's `ended` event reports.
 */
export function canComplete(
  positionSeconds: number,
  maxWatchedSeconds: number,
  durationSeconds: number,
): boolean {
  if (durationSeconds <= 0) return false;
  const position = clampPosition(positionSeconds, durationSeconds);

  // Either the video genuinely ended (what the `ended` event reports)...
  const reachedEnd = position >= durationSeconds - END_TOLERANCE_SECONDS;

  // ...or the learner has already watched past the threshold. This uses the
  // STORED maxWatchedSeconds, not the position in this request: folding the
  // claimed position into the threshold would let a client skip to 97% and
  // claim completion in a single call, without ever having watched. Real
  // playback saves heartbeats as it goes, so an honest viewer's stored value
  // is already there by the time they reach the end.
  return reachedEnd || meetsThreshold(maxWatchedSeconds, durationSeconds);
}

export function percentageWatched(maxWatchedSeconds: number, durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  const raw = Math.round((maxWatchedSeconds / durationSeconds) * 100);
  return Math.min(100, Math.max(0, raw));
}

/**
 * A course's progress is completed lessons over total lessons — never watched
 * seconds, so a long optional lesson cannot distort it.  An empty course is
 * 0%, not 100%: there is nothing to have finished.
 */
export function courseProgressPercentage(completedLessons: number, totalLessons: number): number {
  if (totalLessons <= 0) return 0;
  const raw = Math.round((completedLessons / totalLessons) * 100);
  return Math.min(100, Math.max(0, raw));
}

/** A course counts as finished only when every lesson in it is complete. */
export function isCourseComplete(completedLessons: number, totalLessons: number): boolean {
  return totalLessons > 0 && completedLessons >= totalLessons;
}
