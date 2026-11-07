import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import {
  LocalStorageDriver,
  detectType,
  isAllowedMimeType,
  setStorageProvider,
  verifyStoredType,
} from '../../lib/storage/index.js';
import { acceptClientDuration } from '../../lib/storage/duration.js';
import {
  createCourse,
  createInstructor,
  createUser,
  loginAs,
  resetDb,
} from '../helpers/factories.js';

/**
 * Uploads, against the real local driver writing real files to a temp
 * directory. Nothing about storage is mocked: the magic-byte check reads
 * bytes that were actually written, which is the only way this test proves
 * anything about the check.
 */

// --- fixtures: the smallest byte sequences that are genuinely these types --

/** An ISO base-media header with an MP4 brand, then filler. */
function mp4Bytes(sizeBytes = 2048): Buffer {
  const buffer = Buffer.alloc(sizeBytes);
  buffer.writeUInt32BE(0x20, 0); // box size
  buffer.write('ftyp', 4, 'ascii');
  buffer.write('isom', 8, 'ascii');
  return buffer;
}

function pngBytes(sizeBytes = 1024): Buffer {
  const buffer = Buffer.alloc(sizeBytes);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  return buffer;
}

function jpegBytes(sizeBytes = 1024): Buffer {
  const buffer = Buffer.alloc(sizeBytes);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(buffer, 0);
  return buffer;
}

/** An HTML page wearing an .mp4 name — the attack the check exists for. */
function htmlBytes(): Buffer {
  return Buffer.from('<!doctype html><script>alert(1)</script>', 'utf8');
}

let storageDir: string;

describe('uploads', () => {
  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(tmpdir(), 'cadence-uploads-test-'));
    setStorageProvider(new LocalStorageDriver(storageDir));
  });

  afterAll(async () => {
    setStorageProvider(undefined);
    await rm(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetDb();
  });

  // =========================================================================
  describe('type detection', () => {
    it('recognises each allowed format from its magic bytes', () => {
      expect(detectType(mp4Bytes())?.mime).toBe('video/mp4');
      expect(detectType(pngBytes())?.mime).toBe('image/png');
      expect(detectType(jpegBytes())?.mime).toBe('image/jpeg');
      expect(
        detectType(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]))?.mime,
      ).toBe('video/webm');
    });

    it('refuses to identify anything else', () => {
      expect(detectType(htmlBytes())).toBeNull();
      expect(detectType(Buffer.alloc(0))).toBeNull();
      expect(detectType(Buffer.from('GIF89a'))).toBeNull();
    });

    it('rejects content that does not match the declared type', () => {
      const verdict = verifyStoredType({
        kind: 'VIDEO',
        declaredMimeType: 'video/mp4',
        head: htmlBytes(),
      });
      expect(verdict.ok).toBe(false);
    });

    it('rejects an image uploaded where a video was promised', () => {
      const verdict = verifyStoredType({
        kind: 'VIDEO',
        declaredMimeType: 'video/mp4',
        head: pngBytes(),
      });
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.reason).toMatch(/PNG/);
    });

    it('accepts a genuine match', () => {
      expect(
        verifyStoredType({
          kind: 'VIDEO',
          declaredMimeType: 'video/mp4',
          head: mp4Bytes(),
        }).ok,
      ).toBe(true);
    });

    it('holds an allow-list of declarable types', () => {
      expect(isAllowedMimeType('VIDEO', 'video/mp4')).toBe(true);
      expect(isAllowedMimeType('VIDEO', 'video/quicktime')).toBe(false);
      expect(isAllowedMimeType('IMAGE', 'image/svg+xml')).toBe(false);
      expect(isAllowedMimeType('IMAGE', 'image/webp')).toBe(true);
    });
  });

  describe('client-reported durations', () => {
    it('accepts a plausible one', () => {
      expect(acceptClientDuration(742)).toBe(742);
    });

    it('refuses nonsense rather than clamping it', () => {
      // Completion is measured against this number, so a hostile client
      // claiming one second must not make a lesson trivially completable.
      expect(acceptClientDuration(0)).toBeNull();
      expect(acceptClientDuration(-5)).toBeNull();
      expect(acceptClientDuration(Number.POSITIVE_INFINITY)).toBeNull();
      expect(acceptClientDuration(99_999_999)).toBeNull();
      expect(acceptClientDuration(undefined)).toBeNull();
    });
  });

  // =========================================================================
  describe('the upload flow', () => {
    /** Runs presign → PUT bytes → complete, and returns the final asset. */
    async function upload(
      agent: Awaited<ReturnType<typeof loginAs>>,
      options: {
        kind: 'VIDEO' | 'IMAGE';
        purpose: string;
        mimeType: string;
        bytes: Buffer;
        courseId?: string;
        declaredSize?: number;
        durationSeconds?: number;
      },
    ) {
      const presign = await agent
        .withCsrf(agent.agent.post('/api/v1/uploads/presign'))
        .send({
          kind: options.kind,
          purpose: options.purpose,
          mimeType: options.mimeType,
          sizeBytes: options.declaredSize ?? options.bytes.length,
          originalName: 'fixture',
          ...(options.courseId ? { courseId: options.courseId } : {}),
        });
      if (presign.status !== 201) return { presign, put: null, complete: null };

      const put = await agent
        .withCsrf(agent.agent.put(presign.body.data.uploadUrl.replace('/api/v1', '/api/v1')))
        .set('Content-Type', 'application/octet-stream')
        .send(options.bytes);

      const complete = await agent
        .withCsrf(
          agent.agent.post(`/api/v1/uploads/${presign.body.data.assetId}/complete`),
        )
        .send(
          options.durationSeconds !== undefined
            ? { durationSeconds: options.durationSeconds }
            : {},
        );

      return { presign, put, complete };
    }

    it('uploads a thumbnail end to end and marks it READY', async () => {
      const { user } = await createInstructor({ email: 'uploader@test.dev' });
      const { course } = await createCourse({ ownerId: user.id, status: 'DRAFT' });
      const agent = await loginAs('uploader@test.dev');

      const { presign, put, complete } = await upload(agent, {
        kind: 'IMAGE',
        purpose: 'COURSE_THUMBNAIL',
        mimeType: 'image/png',
        bytes: pngBytes(),
        courseId: course.id,
      });

      expect(presign.status).toBe(201);
      expect(presign.body.data.storageKey).toContain(user.id);
      expect(put?.status).toBe(200);
      expect(complete?.status).toBe(200);
      expect(complete?.body.data.status).toBe('READY');
      expect(complete?.body.data.url).toContain('/api/v1/media/');

      const asset = await prisma.mediaAsset.findFirstOrThrow({
        where: { ownerId: user.id },
      });
      expect(asset.status).toBe('READY');
      expect(asset.mimeType).toBe('image/png');
    });

    it('uploads a video and records the duration the browser reported', async () => {
      const { user } = await createInstructor({ email: 'videouploader@test.dev' });
      const { course } = await createCourse({ ownerId: user.id, status: 'DRAFT' });
      const agent = await loginAs('videouploader@test.dev');

      const { complete } = await upload(agent, {
        kind: 'VIDEO',
        purpose: 'LESSON_VIDEO',
        mimeType: 'video/mp4',
        bytes: mp4Bytes(),
        courseId: course.id,
        durationSeconds: 1008,
      });

      expect(complete?.status).toBe(200);
      expect(complete?.body.data.status).toBe('READY');
      // ffprobe cannot read a synthetic header, so the sanity-checked
      // browser value is what lands — exactly the documented fallback.
      expect(complete?.body.data.durationSeconds).toBe(1008);
      // A video never gets a durable URL, even once READY.
      expect(complete?.body.data.url).toBeNull();
    });

    it('refuses a file whose contents do not match its declared type', async () => {
      const { user } = await createInstructor({ email: 'liar@test.dev' });
      const { course } = await createCourse({ ownerId: user.id, status: 'DRAFT' });
      const agent = await loginAs('liar@test.dev');

      const { presign, complete } = await upload(agent, {
        kind: 'VIDEO',
        purpose: 'LESSON_VIDEO',
        mimeType: 'video/mp4',
        bytes: htmlBytes(),
        courseId: course.id,
        durationSeconds: 60,
      });

      expect(presign.status).toBe(201);
      expect(complete?.status).toBe(422);
      expect(complete?.body.message).toMatch(/not a recognised|don't match/i);

      // The asset row is gone, so nothing can later attach it to a lesson.
      expect(
        await prisma.mediaAsset.count({ where: { id: presign.body.data.assetId } }),
      ).toBe(0);
    });

    it('refuses an oversized file before issuing a target', async () => {
      const { user } = await createInstructor({ email: 'toobig@test.dev' });
      const { course } = await createCourse({ ownerId: user.id, status: 'DRAFT' });
      const agent = await loginAs('toobig@test.dev');

      const response = await agent
        .withCsrf(agent.agent.post('/api/v1/uploads/presign'))
        .send({
          kind: 'IMAGE',
          purpose: 'COURSE_THUMBNAIL',
          mimeType: 'image/png',
          // MAX_IMAGE_MB is 5.
          sizeBytes: 50 * 1024 * 1024,
          courseId: course.id,
        });

      expect(response.status).toBe(422);
      expect(response.body.message).toMatch(/limit/i);
      // No row was reserved for a request that was never going to work.
      expect(await prisma.mediaAsset.count()).toBe(0);
    });

    it('refuses a format that is not on the allow-list', async () => {
      const { user } = await createInstructor({ email: 'svg@test.dev' });
      const { course } = await createCourse({ ownerId: user.id, status: 'DRAFT' });
      const agent = await loginAs('svg@test.dev');

      const response = await agent
        .withCsrf(agent.agent.post('/api/v1/uploads/presign'))
        .send({
          kind: 'IMAGE',
          purpose: 'COURSE_THUMBNAIL',
          mimeType: 'image/svg+xml',
          sizeBytes: 1024,
          courseId: course.id,
        });
      expect(response.status).toBe(422);
    });

    it('refuses to presign against another instructor’s course', async () => {
      const alice = await createInstructor({ email: 'alice6@test.dev' });
      await createInstructor({ email: 'bob6@test.dev' });
      const { course } = await createCourse({ ownerId: alice.user.id });
      const bob = await loginAs('bob6@test.dev');

      const response = await bob
        .withCsrf(bob.agent.post('/api/v1/uploads/presign'))
        .send({
          kind: 'IMAGE',
          purpose: 'COURSE_THUMBNAIL',
          mimeType: 'image/png',
          sizeBytes: 1024,
          courseId: course.id,
        });
      expect(response.status).toBe(404);
      expect(await prisma.mediaAsset.count()).toBe(0);
    });

    it('refuses an upload from a learner', async () => {
      await createUser({ email: 'justalearner@test.dev' });
      const agent = await loginAs('justalearner@test.dev');

      const response = await agent
        .withCsrf(agent.agent.post('/api/v1/uploads/presign'))
        .send({
          kind: 'IMAGE',
          purpose: 'PROFILE_PHOTO',
          mimeType: 'image/png',
          sizeBytes: 1024,
        });
      expect(response.status).toBe(403);
    });

    it('refuses an upload from a suspended instructor', async () => {
      await createInstructor({ email: 'suspendedup@test.dev', suspended: true });
      const agent = await loginAs('suspendedup@test.dev');

      const response = await agent
        .withCsrf(agent.agent.post('/api/v1/uploads/presign'))
        .send({
          kind: 'IMAGE',
          purpose: 'PROFILE_PHOTO',
          mimeType: 'image/png',
          sizeBytes: 1024,
        });
      expect(response.status).toBe(403);
      expect(response.body.message).toMatch(/suspended/i);
    });

    it('will not write bytes for another user’s reserved key', async () => {
      const alice = await createInstructor({ email: 'alice7@test.dev' });
      await createInstructor({ email: 'bob7@test.dev' });
      const { course } = await createCourse({ ownerId: alice.user.id });

      const aliceAgent = await loginAs('alice7@test.dev');
      const presign = await aliceAgent
        .withCsrf(aliceAgent.agent.post('/api/v1/uploads/presign'))
        .send({
          kind: 'IMAGE',
          purpose: 'COURSE_THUMBNAIL',
          mimeType: 'image/png',
          sizeBytes: 1024,
          courseId: course.id,
        });
      expect(presign.status).toBe(201);

      const bob = await loginAs('bob7@test.dev');
      const hijack = await bob
        .withCsrf(bob.agent.put(presign.body.data.uploadUrl as string))
        .set('Content-Type', 'application/octet-stream')
        .send(pngBytes());
      expect(hijack.status).toBe(404);
    });

    it('is idempotent on a repeated completion', async () => {
      const { user } = await createInstructor({ email: 'twice@test.dev' });
      const { course } = await createCourse({ ownerId: user.id });
      const agent = await loginAs('twice@test.dev');

      const { presign, complete } = await upload(agent, {
        kind: 'IMAGE',
        purpose: 'COURSE_THUMBNAIL',
        mimeType: 'image/png',
        bytes: pngBytes(),
        courseId: course.id,
      });
      expect(complete?.status).toBe(200);

      const again = await agent
        .withCsrf(
          agent.agent.post(`/api/v1/uploads/${presign.body.data.assetId}/complete`),
        )
        .send({});
      expect(again.status).toBe(200);
      expect(again.body.data.status).toBe('READY');
    });

    it('cancels an upload and removes the object', async () => {
      const { user } = await createInstructor({ email: 'canceller@test.dev' });
      const { course } = await createCourse({ ownerId: user.id });
      const agent = await loginAs('canceller@test.dev');

      const { presign } = await upload(agent, {
        kind: 'IMAGE',
        purpose: 'COURSE_THUMBNAIL',
        mimeType: 'image/png',
        bytes: pngBytes(),
        courseId: course.id,
      });

      const removed = await agent.withCsrf(
        agent.agent.delete(`/api/v1/uploads/${presign.body.data.assetId}`),
      );
      expect(removed.status).toBe(204);
      expect(
        await prisma.mediaAsset.count({ where: { id: presign.body.data.assetId } }),
      ).toBe(0);
    });
  });

  // =========================================================================
  describe('serving media', () => {
    it('serves an uploaded image publicly, with nosniff', async () => {
      const { user } = await createInstructor({ email: 'server@test.dev' });
      const asset = await prisma.mediaAsset.create({
        data: {
          ownerId: user.id,
          kind: 'IMAGE',
          storageKey: 'course_thumbnail/test/public.png',
          mimeType: 'image/png',
          sizeBytes: 1024,
          status: 'READY',
        },
      });
      await new LocalStorageDriver(storageDir).write(asset.storageKey, pngBytes());

      const { api } = await import('../helpers/factories.js');
      const response = await api().get(`/api/v1/media/${asset.storageKey}`);
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('image/png');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    it('never serves a video through the public media route', async () => {
      const { user } = await createInstructor({ email: 'videoserver@test.dev' });
      const asset = await prisma.mediaAsset.create({
        data: {
          ownerId: user.id,
          kind: 'VIDEO',
          storageKey: 'lesson_video/test/private.mp4',
          mimeType: 'video/mp4',
          sizeBytes: 2048,
          durationSeconds: 100,
          status: 'READY',
        },
      });
      await new LocalStorageDriver(storageDir).write(asset.storageKey, mp4Bytes());

      const { api } = await import('../helpers/factories.js');
      const response = await api().get(`/api/v1/media/${asset.storageKey}`);
      expect(response.status).toBe(403);
    });

    it('refuses a lesson video to someone with no access, and serves it to a learner who has', async () => {
      const { user } = await createInstructor({ email: 'gatekeeper@test.dev' });
      const { course, lessons } = await createCourse({
        ownerId: user.id,
        status: 'PUBLISHED',
        lessonCount: 1,
      });

      const asset = await prisma.mediaAsset.create({
        data: {
          ownerId: user.id,
          kind: 'VIDEO',
          storageKey: 'lesson_video/test/gated.mp4',
          mimeType: 'video/mp4',
          sizeBytes: 2048,
          durationSeconds: 100,
          status: 'READY',
        },
      });
      await new LocalStorageDriver(storageDir).write(asset.storageKey, mp4Bytes());
      await prisma.lesson.update({
        where: { id: lessons[0]!.id },
        data: { videoAssetId: asset.id },
      });

      // Not enrolled: refused.
      await createUser({ email: 'outsider@test.dev' });
      const outsider = await loginAs('outsider@test.dev');
      const refused = await outsider.agent.get(`/api/v1/lessons/${lessons[0]!.id}/video`);
      expect(refused.status).toBe(403);

      // Enrolled: served, and Range works so the player can seek.
      await createUser({ email: 'enrolledviewer@test.dev' });
      const viewer = await loginAs('enrolledviewer@test.dev');
      await prisma.enrollment.create({
        data: { userId: viewer.userId, courseId: course.id },
      });

      const full = await viewer.agent.get(`/api/v1/lessons/${lessons[0]!.id}/video`);
      expect(full.status).toBe(200);
      expect(full.headers['accept-ranges']).toBe('bytes');

      const ranged = await viewer.agent
        .get(`/api/v1/lessons/${lessons[0]!.id}/video`)
        .set('Range', 'bytes=0-99');
      expect(ranged.status).toBe(206);
      expect(ranged.headers['content-range']).toBe('bytes 0-99/2048');
      expect(ranged.headers['content-length']).toBe('100');
    });
  });

  // =========================================================================
  describe('orphan cleanup', () => {
    it('removes PENDING assets older than the cutoff and leaves READY ones', async () => {
      const { user } = await createInstructor({ email: 'orphans@test.dev' });
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000);

      const stale = await prisma.mediaAsset.create({
        data: {
          ownerId: user.id,
          kind: 'IMAGE',
          storageKey: 'course_thumbnail/test/stale.png',
          mimeType: 'image/png',
          sizeBytes: 100,
          status: 'PENDING',
          createdAt: old,
        },
      });
      const live = await prisma.mediaAsset.create({
        data: {
          ownerId: user.id,
          kind: 'IMAGE',
          storageKey: 'course_thumbnail/test/live.png',
          mimeType: 'image/png',
          sizeBytes: 100,
          status: 'READY',
          createdAt: old,
        },
      });
      const recent = await prisma.mediaAsset.create({
        data: {
          ownerId: user.id,
          kind: 'IMAGE',
          storageKey: 'course_thumbnail/test/recent.png',
          mimeType: 'image/png',
          sizeBytes: 100,
          status: 'PENDING',
        },
      });

      const { uploadsService } = await import('../../modules/uploads/uploads.service.js');
      const removed = await uploadsService.cleanupOrphans(60 * 24);

      expect(removed).toBe(1);
      expect(await prisma.mediaAsset.count({ where: { id: stale.id } })).toBe(0);
      expect(await prisma.mediaAsset.count({ where: { id: live.id } })).toBe(1);
      expect(await prisma.mediaAsset.count({ where: { id: recent.id } })).toBe(1);
    });
  });
});
