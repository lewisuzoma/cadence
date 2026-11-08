import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { logger } from '../logger.js';

const run = promisify(execFile);

/**
 * How long a video is.
 *
 * This number is not cosmetic: completion is `maxWatched >= 0.9 × duration`,
 * so a wrong duration either makes a lesson impossible to complete or marks
 * it complete after a few seconds. That is why a manually typed duration is
 * only accepted for external URLs, where there is genuinely nothing to
 * measure.
 *
 * Three sources, in descending order of trust:
 *
 *  1. **ffprobe** on the stored file — authoritative, used whenever the
 *     binary is present.
 *  2. **The browser's `loadedmetadata` value**, sanity-checked here. Used
 *     when ffprobe is unavailable (it is not in the slim runtime image by
 *     default), and clamped to a plausible range so a hostile client cannot
 *     claim a one-second duration to make a lesson trivially completable.
 *  3. **Nothing** — the asset is stored but stays un-READY, and the publish
 *     checklist reports the lesson as needing a video.
 */

/** Above this, a claimed duration is not plausible for a lesson. */
const MAX_PLAUSIBLE_SECONDS = 12 * 60 * 60;

let ffprobeAvailable: boolean | undefined;

/** Whether ffprobe can be called, probed once per process. */
export async function hasFfprobe(): Promise<boolean> {
  if (ffprobeAvailable !== undefined) return ffprobeAvailable;
  try {
    await run('ffprobe', ['-version'], { timeout: 5000 });
    ffprobeAvailable = true;
  } catch {
    ffprobeAvailable = false;
    logger.info(
      'ffprobe is not available; video durations will use the browser-reported value',
    );
  }
  return ffprobeAvailable;
}

/** Resets the probe cache. Tests only. */
export function resetFfprobeCache(): void {
  ffprobeAvailable = undefined;
}

/** Reads the duration of a file on disk with ffprobe. */
export async function probeDurationFromPath(filePath: string): Promise<number | null> {
  if (!(await hasFfprobe())) return null;
  try {
    const { stdout } = await run(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ],
      { timeout: 30_000 },
    );
    const seconds = Math.round(Number.parseFloat(stdout.trim()));
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch (error) {
    logger.warn({ err: error }, 'ffprobe failed to read a duration');
    return null;
  }
}

/**
 * Reads the duration of a buffer, by writing it to a temp file first.
 *
 * ffprobe needs a seekable input to read the duration of an MP4 whose
 * `moov` atom is at the end, which piping cannot provide.
 */
export async function probeDurationFromBuffer(
  data: Buffer,
  extension: string,
): Promise<number | null> {
  if (!(await hasFfprobe())) return null;
  const dir = await mkdtemp(path.join(tmpdir(), 'cadence-probe-'));
  const file = path.join(dir, `probe${extension}`);
  try {
    await writeFile(file, data);
    return await probeDurationFromPath(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Accepts, or refuses, a duration the browser reported.
 *
 * The client is not trusted, but it is not useless either: the value is
 * taken only when the server could not measure for itself, and only when it
 * is within a plausible range. Anything outside it is dropped rather than
 * clamped, because a client sending nonsense has told us nothing we can use.
 */
export function acceptClientDuration(reported: number | undefined): number | null {
  if (reported === undefined) return null;
  if (!Number.isFinite(reported)) return null;
  const seconds = Math.round(reported);
  if (seconds <= 0 || seconds > MAX_PLAUSIBLE_SECONDS) return null;
  return seconds;
}
