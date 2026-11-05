/**
 * Business constants shared by both sides.  Changing one of these changes the
 * server's authoritative behaviour and the client's optimistic display at the
 * same time, which is the point of keeping them here.
 */

/**
 * A lesson auto-completes once this fraction of its duration has been watched.
 * 0.9 is the documented threshold from the spec: it tolerates skipped credits
 * and outros while still requiring that nearly all of the lesson was seen.
 */
export const COMPLETION_THRESHOLD = 0.9;

/**
 * How close to the end an explicit `POST /complete` must be for the server to
 * trust the video's `ended` event (seconds).
 */
export const END_TOLERANCE_SECONDS = 2;

/** The client saves progress at most this often while the video plays (ms). */
export const PROGRESS_SAVE_INTERVAL_MS = 10_000;

/** ...and only when the position moved by more than this (seconds). */
export const PROGRESS_MIN_DELTA_SECONDS = 2;

/** Resume only matters once the learner is this far in (seconds). */
export const RESUME_MIN_POSITION_SECONDS = 5;

export const DEFAULT_PAGE_SIZE = 12;
export const MAX_PAGE_SIZE = 50;

/** Search inputs debounce before hitting the API (ms). */
export const SEARCH_DEBOUNCE_MS = 300;
