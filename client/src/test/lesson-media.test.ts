import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SAMPLE_LESSON_VIDEO } from '@cadence/shared';

/**
 * The bundled sample lesson video is a generated asset
 * (`npm run lesson:video`, scripts/make-lesson-video.mjs) that the seed hands
 * to every lesson. Three things have to stay true, and none of them is
 * obvious from reading the code:
 *
 *  - the file is actually there, because `videoUrl` is only a string and a
 *    missing file shows up as an empty player rather than a failed build;
 *  - its real duration matches `SAMPLE_LESSON_VIDEO.durationSeconds`, which
 *    the seed writes into every lesson row. If the video were regenerated
 *    shorter than that, no learner could ever reach the 90% completion
 *    threshold the server enforces;
 *  - the captions stop inside the video, so no cue is unreachable.
 *
 * The MP4 is parsed here rather than mocked: these assertions are only worth
 * anything if they read the committed bytes.
 */

const publicDir = resolve(__dirname, '../../public');

/** Walks the box tree and returns the offset of the first box of a type. */
function findBox(buffer: Buffer, type: string): number {
  const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);
  const walk = (start: number, end: number): number => {
    let offset = start;
    while (offset + 8 <= end) {
      const size = buffer.readUInt32BE(offset);
      const name = buffer.toString('ascii', offset + 4, offset + 8);
      if (name === type) return offset;
      // stsd is a container too, but its children start after a version,
      // flags and entry count rather than straight after the header.
      if (containers.has(name) || name === 'stsd') {
        const hit = walk(offset + (name === 'stsd' ? 16 : 8), offset + size);
        if (hit >= 0) return hit;
      }
      if (size < 8) break;
      offset += size;
    }
    return -1;
  };
  const found = walk(0, buffer.length);
  if (found < 0) throw new Error(`No ${type} box in the sample video`);
  return found;
}

describe('the bundled sample lesson video', () => {
  const video = readFileSync(resolve(publicDir, 'media/lesson-sample.mp4'));

  it('is a non-empty MP4', () => {
    expect(video.byteLength).toBeGreaterThan(100_000);
    expect(video.toString('ascii', 4, 8)).toBe('ftyp');
  });

  it('is exactly as long as the seed says it is', () => {
    const mdhd = findBox(video, 'mdhd');
    const timescale = video.readUInt32BE(mdhd + 20);
    const duration = video.readUInt32BE(mdhd + 24);
    expect(duration / timescale).toBe(SAMPLE_LESSON_VIDEO.durationSeconds);
  });

  it('declares the frame size the player lays out for', () => {
    const avc1 = findBox(video, 'avc1');
    expect(video.readUInt16BE(avc1 + 32)).toBe(512);
    expect(video.readUInt16BE(avc1 + 34)).toBe(288);
  });

  it('can be seeked: the sample table marks sync samples', () => {
    const stss = findBox(video, 'stss');
    expect(video.readUInt32BE(stss + 12)).toBeGreaterThan(0);
  });

  it('keeps every caption cue inside the video', () => {
    const vtt = readFileSync(resolve(publicDir, 'captions/lesson-sample.en.vtt'), 'utf8');
    const seconds = (stamp: string) => {
      const [hh, mm, ss] = stamp.split(':');
      return Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
    };
    const ends = [...vtt.matchAll(/-->\s*([\d:.]+)/g)].map((match) => seconds(match[1]!));

    expect(ends.length).toBeGreaterThan(0);
    expect(Math.max(...ends)).toBeLessThanOrEqual(SAMPLE_LESSON_VIDEO.durationSeconds);
  });
});
