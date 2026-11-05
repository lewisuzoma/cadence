import { describe, expect, it } from 'vitest';
import { COMPLETION_THRESHOLD, END_TOLERANCE_SECONDS } from '@cadence/shared';
import {
  applyProgress,
  canComplete,
  clampPosition,
  courseProgressPercentage,
  isCourseComplete,
  meetsThreshold,
  percentageWatched,
} from '../../modules/progress/progress.calculator.js';

/**
 * The completion rules are the part of this system most likely to be got
 * subtly wrong, so they are tested directly rather than only through the API.
 * Durations are 100 seconds so the 90% threshold is exactly 90.
 */

describe('clampPosition', () => {
  it('keeps a position inside the video', () => {
    expect(clampPosition(42, 100)).toBe(42);
  });

  it('clamps past the end to the duration', () => {
    expect(clampPosition(5000, 100)).toBe(100);
  });

  it('treats negative and non-finite positions as zero, not as the end', () => {
    expect(clampPosition(-10, 100)).toBe(0);
    expect(clampPosition(Number.NaN, 100)).toBe(0);
    // Infinity is garbage input, so it collapses to 0 rather than clamping up
    // to the duration: nonsense must never be worth completion credit.
    expect(clampPosition(Number.POSITIVE_INFINITY, 100)).toBe(0);
  });

  it('floors fractional positions, so stored seconds stay integers', () => {
    expect(clampPosition(42.87, 100)).toBe(42);
  });
});

describe('percentageWatched', () => {
  it('rounds to a whole percentage', () => {
    expect(percentageWatched(33, 100)).toBe(33);
    expect(percentageWatched(1, 3)).toBe(33);
  });

  it('is zero for a zero-length lesson rather than dividing by zero', () => {
    expect(percentageWatched(10, 0)).toBe(0);
  });

  it('never exceeds 100', () => {
    expect(percentageWatched(500, 100)).toBe(100);
  });
});

describe('meetsThreshold', () => {
  it(`completes at exactly ${COMPLETION_THRESHOLD * 100}%`, () => {
    expect(meetsThreshold(90, 100)).toBe(true);
  });

  it('does not complete one second short', () => {
    expect(meetsThreshold(89, 100)).toBe(false);
  });

  it('is false for a zero duration', () => {
    expect(meetsThreshold(0, 0)).toBe(false);
  });
});

describe('applyProgress', () => {
  it('records the first watch', () => {
    const result = applyProgress(null, 25, 100);
    expect(result).toEqual({
      lastPositionSeconds: 25,
      maxWatchedSeconds: 25,
      completionPercentage: 25,
      isCompleted: false,
    });
  });

  it('moves lastPosition backwards on a rewind but keeps maxWatched', () => {
    const previous = {
      lastPositionSeconds: 80,
      maxWatchedSeconds: 80,
      completionPercentage: 80,
      isCompleted: false,
    };
    const result = applyProgress(previous, 10, 100);
    // Resume should land where the learner actually is...
    expect(result.lastPositionSeconds).toBe(10);
    // ...but credit already earned is not taken away.
    expect(result.maxWatchedSeconds).toBe(80);
    expect(result.completionPercentage).toBe(80);
  });

  it('auto-completes once the threshold is crossed', () => {
    const result = applyProgress(null, 91, 100);
    expect(result.isCompleted).toBe(true);
    expect(result.completionPercentage).toBe(100);
  });

  it('keeps completion sticky when the learner scrubs back to the start', () => {
    const completed = {
      lastPositionSeconds: 100,
      maxWatchedSeconds: 100,
      completionPercentage: 100,
      isCompleted: true,
    };
    const result = applyProgress(completed, 2, 100);
    expect(result.isCompleted).toBe(true);
    expect(result.completionPercentage).toBe(100);
    expect(result.lastPositionSeconds).toBe(2);
  });

  it('does not complete a lesson that was merely opened', () => {
    const result = applyProgress(null, 0, 100);
    expect(result.isCompleted).toBe(false);
    expect(result.completionPercentage).toBe(0);
  });
});

describe('canComplete', () => {
  it(`accepts a position within ${END_TOLERANCE_SECONDS}s of the end (the ended event)`, () => {
    expect(canComplete(98, 0, 100)).toBe(true);
    expect(canComplete(100, 0, 100)).toBe(true);
  });

  it('rejects a position three seconds short with nothing watched', () => {
    expect(canComplete(97, 0, 100)).toBe(false);
  });

  it('accepts when enough of the lesson was watched earlier', () => {
    // Seeked back to the beginning, but 90s were already watched.
    expect(canComplete(5, 90, 100)).toBe(true);
  });

  it('rejects a zero-length lesson', () => {
    expect(canComplete(0, 0, 0)).toBe(false);
  });
});

describe('courseProgressPercentage', () => {
  it('is completed lessons over total lessons', () => {
    expect(courseProgressPercentage(7, 12)).toBe(58);
    expect(courseProgressPercentage(12, 12)).toBe(100);
  });

  it('treats a course with no lessons as 0%, not 100%', () => {
    expect(courseProgressPercentage(0, 0)).toBe(0);
  });

  it('never exceeds 100 even with stale counts', () => {
    expect(courseProgressPercentage(13, 12)).toBe(100);
  });
});

describe('isCourseComplete', () => {
  it('needs every lesson complete', () => {
    expect(isCourseComplete(11, 12)).toBe(false);
    expect(isCourseComplete(12, 12)).toBe(true);
  });

  it('an empty course is never complete', () => {
    expect(isCourseComplete(0, 0)).toBe(false);
  });
});
