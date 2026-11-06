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

/**
 * How long a password-reset link stays valid (minutes).  The server stamps
 * the token row with it and the client quotes it back on the confirmation
 * screen, so the two can never tell the user different things.
 */
export const PASSWORD_RESET_TTL_MINUTES = 30;

/**
 * The sample lesson video that ships in the client bundle
 * (`client/public/media`), used by the seed for every lesson and offered as
 * the default when an admin creates one. Both sides read it from here so a
 * regenerated video cannot leave one of them quoting the old length.
 *
 * `durationSeconds` is the file's real duration — rebuild it with
 * `npm run lesson:video` and the client's media test will fail if the two
 * ever drift apart.
 */
export const SAMPLE_LESSON_VIDEO = {
  url: '/media/lesson-sample.mp4',
  captionsUrl: '/captions/lesson-sample.en.vtt',
  durationSeconds: 725,
} as const;
