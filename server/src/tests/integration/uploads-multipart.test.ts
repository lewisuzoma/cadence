import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { LocalStorageDriver, setStorageProvider } from '../../lib/storage/index.js';
import {
  createCourse,
  createInstructor,
  loginAs,
  resetDb,
} from '../helpers/factories.js';

/**
 * Resumable multipart uploads, against the real local driver writing
 * real part files to a temp directory.
 *
 * The point of the feature is that a dropped connection costs one part
 * rather than the whole transfer, so the tests that matter most are the
 * ones that drop the connection: send some parts, come back, and check
 * that only the missing ones are needed.
 */

/** An ISO base-media header with an MP4 brand, then filler. */
function mp4Bytes(sizeBytes: number): Buffer {
  const buffer = Buffer.alloc(sizeBytes);
  buffer.writeUInt32BE(0x20, 0);
  buffer.write('ftyp', 4, 'ascii');
  buffer.write('isom', 8, 'ascii');
  return buffer;
}

/** Comfortably over the 16 MB threshold, so the server goes multipart. */
function bigMp4(): Buffer {
  return mp4Bytes(20 * 1024 * 1024);
}

type Agent = Awaited<ReturnType<typeof loginAs>>;

type MultipartPlan = {
  uploadId: string;
  partSizeBytes: number;
  totalParts: number;
  uploadedParts: number[];
  resumed: boolean;
};

let storageDir: string;

describe('resumable multipart uploads', () => {
  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(tmpdir(), 'cadence-multipart-test-'));
    setStorageProvider(new LocalStorageDriver(storageDir));
  });

  afterAll(async () => {
    setStorageProvider(undefined);
    await rm(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetDb();
  });

  /** Presigns an upload for a large file. */
  async function begin(
    agent: Agent,
    courseId: string,
    file: Buffer,
    fingerprint = 'big.mp4|20971520|1700000000000',
  ) {
    return agent.withCsrf(agent.agent.post('/api/v1/uploads/presign')).send({
      kind: 'VIDEO',
      purpose: 'LESSON_VIDEO',
      mimeType: 'video/mp4',
      sizeBytes: file.length,
      originalName: 'big.mp4',
      fingerprint,
      courseId,
    });
  }

  /** Stages one part through the local driver's receiving endpoint. */
  async function putPart(
    agent: Agent,
    uploadId: string,
    partNumber: number,
    slice: Buffer,
  ) {
    return agent
      .withCsrf(
        agent.agent.put(`/api/v1/uploads/multipart/${uploadId}/parts/${partNumber}`),
      )
      .set('Content-Type', 'application/octet-stream')
      .send(slice);
  }

  function sliceOf(file: Buffer, partNumber: number, partSize: number): Buffer {
    return file.subarray((partNumber - 1) * partSize, partNumber * partSize);
  }

  // =========================================================================

  it('splits a large file into parts and assembles them on completion', async () => {
    const { user } = await createInstructor({ email: 'bigupload@test.dev' });
    const { course } = await createCourse({ ownerId: user.id, status: 'DRAFT' });
    const agent = await loginAs('bigupload@test.dev');
    const file = bigMp4();

    const presign = await begin(agent, course.id, file);
    expect(presign.status).toBe(201);

    const plan = presign.body.data.multipart as MultipartPlan;
    expect(plan).toBeDefined();
    expect(plan.resumed).toBe(false);
    expect(plan.uploadedParts).toEqual([]);
    // 20 MB at an 8 MB part size is three parts.
    expect(plan.totalParts).toBe(3);

    for (let partNumber = 1; partNumber <= plan.totalParts; partNumber++) {
      const result = await putPart(
        agent,
        plan.uploadId,
        partNumber,
        sliceOf(file, partNumber, plan.partSizeBytes),
      );
      expect(result.status, `part ${partNumber}`).toBe(200);
      // An ETag, so a client reads a part the same way on either driver.
      expect(result.headers.etag).toBeDefined();
    }

    const completed = await agent
      .withCsrf(agent.agent.post(`/api/v1/uploads/${presign.body.data.assetId}/complete`))
      .send({ durationSeconds: 900 });

    expect(completed.status).toBe(200);
    expect(completed.body.data.status).toBe('READY');
    // The assembled object is the whole file, not one part of it.
    expect(completed.body.data.sizeBytes).toBe(file.length);

    const asset = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id: presign.body.data.assetId as string },
    });
    // Finished, and therefore no longer resumable.
    expect(asset.uploadId).toBeNull();
  });

  it('reports which parts have landed, so a client knows what to send', async () => {
    const { user } = await createInstructor({ email: 'status@test.dev' });
    const { course } = await createCourse({ ownerId: user.id, status: 'DRAFT' });
    const agent = await loginAs('status@test.dev');
    const file = bigMp4();

    const presign = await begin(agent, course.id, file);
    const plan = presign.body.data.multipart as MultipartPlan;
    const assetId = presign.body.data.assetId as string;

    const before = await agent.agent.get(`/api/v1/uploads/${assetId}/status`);
    expect(before.status).toBe(200);
    expect(before.body.data.uploadedParts).toEqual([]);
    expect(before.body.data.totalParts).toBe(3);

    // Parts 1 and 3, leaving a deliberate gap.
    await putPart(agent, plan.uploadId, 1, sliceOf(file, 1, plan.partSizeBytes));
    await putPart(agent, plan.uploadId, 3, sliceOf(file, 3, plan.partSizeBytes));

    const after = await agent.agent.get(`/api/v1/uploads/${assetId}/status`);
    expect(after.body.data.uploadedParts).toEqual([1, 3]);
    expect(after.body.data.uploadedBytes).toBeGreaterThan(0);
  });

  it('resumes the same upload when the file is picked again', async () => {
    const { user } = await createInstructor({ email: 'resume@test.dev' });
    const { course } = await createCourse({ ownerId: user.id, status: 'DRAFT' });
    const agent = await loginAs('resume@test.dev');
    const file = bigMp4();

    const first = await begin(agent, course.id, file);
    const plan = first.body.data.multipart as MultipartPlan;
    const assetId = first.body.data.assetId as string;

    // One part lands, then the connection drops.
    await putPart(agent, plan.uploadId, 1, sliceOf(file, 1, plan.partSizeBytes));

    // The user picks the same file again.
    const second = await begin(agent, course.id, file);
    expect(second.status).toBe(201);

    // The same upload comes back, not a second one.
    expect(second.body.data.assetId).toBe(assetId);
    expect((second.body.data.multipart as MultipartPlan).uploadId).toBe(plan.uploadId);
    expect((second.body.data.multipart as MultipartPlan).resumed).toBe(true);
    expect((second.body.data.multipart as MultipartPlan).uploadedParts).toEqual([1]);

    expect(
      await prisma.mediaAsset.count({ where: { ownerId: user.id, status: 'PENDING' } }),
    ).toBe(1);

    // Sending only what was missing still produces the whole file.
    for (const partNumber of [2, 3]) {
      await putPart(
        agent,
        plan.uploadId,
        partNumber,
        sliceOf(file, partNumber, plan.partSizeBytes),
      );
    }
    const completed = await agent
      .withCsrf(agent.agent.post(`/api/v1/uploads/${assetId}/complete`))
      .send({ durationSeconds: 900 });
    expect(completed.status).toBe(200);
    expect(completed.body.data.sizeBytes).toBe(file.length);
  });

  it('does not resume a different file that happens to be the same size', async () => {
    const { user } = await createInstructor({ email: 'different@test.dev' });
    const { course } = await createCourse({ ownerId: user.id, status: 'DRAFT' });
    const agent = await loginAs('different@test.dev');
    const file = bigMp4();

    const first = await begin(agent, course.id, file, 'one.mp4|20971520|1700000000000');
    const second = await begin(agent, course.id, file, 'two.mp4|20971520|1700000000000');

    // Different fingerprints, so two separate uploads. Sharing them would
    // stitch parts of two different videos into one file.
    expect(second.body.data.assetId).not.toBe(first.body.data.assetId);
    expect((second.body.data.multipart as MultipartPlan).resumed).toBe(false);
  });

  it('refuses to complete an upload with a missing part', async () => {
    const { user } = await createInstructor({ email: 'gappy@test.dev' });
    const { course } = await createCourse({ ownerId: user.id, status: 'DRAFT' });
    const agent = await loginAs('gappy@test.dev');
    const file = bigMp4();

    const presign = await begin(agent, course.id, file);
    const plan = presign.body.data.multipart as MultipartPlan;

    /*
     * Parts 1 and 3 only. A truncated file would still pass the
     * magic-byte check — the header is in part 1 — and then fail to play,
     * which is exactly why the gap is caught here instead.
     */
    await putPart(agent, plan.uploadId, 1, sliceOf(file, 1, plan.partSizeBytes));
    await putPart(agent, plan.uploadId, 3, sliceOf(file, 3, plan.partSizeBytes));

    const completed = await agent
      .withCsrf(agent.agent.post(`/api/v1/uploads/${presign.body.data.assetId}/complete`))
      .send({ durationSeconds: 900 });

    expect(completed.status).toBe(422);
    expect(completed.body.message).toMatch(/incomplete|missing/i);

    // Still resumable rather than thrown away.
    const asset = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id: presign.body.data.assetId as string },
    });
    expect(asset.status).toBe('PENDING');
    expect(asset.uploadId).not.toBeNull();
  });

  it('keeps a small file on the single-request path', async () => {
    const { user } = await createInstructor({ email: 'smallfile@test.dev' });
    const { course } = await createCourse({ ownerId: user.id, status: 'DRAFT' });
    const agent = await loginAs('smallfile@test.dev');

    const presign = await agent
      .withCsrf(agent.agent.post('/api/v1/uploads/presign'))
      .send({
        kind: 'IMAGE',
        purpose: 'COURSE_THUMBNAIL',
        mimeType: 'image/png',
        sizeBytes: 1024,
        courseId: course.id,
      });

    expect(presign.status).toBe(201);
    // Multipart's per-part round trip would be pure overhead down here.
    expect(presign.body.data.multipart).toBeUndefined();
    expect(presign.body.data.uploadUrl).toBeDefined();
  });

  it('will not sign a part outside the declared upload', async () => {
    const { user } = await createInstructor({ email: 'outofrange@test.dev' });
    const { course } = await createCourse({ ownerId: user.id, status: 'DRAFT' });
    const agent = await loginAs('outofrange@test.dev');

    const presign = await begin(agent, course.id, bigMp4());
    const response = await agent
      .withCsrf(agent.agent.post(`/api/v1/uploads/${presign.body.data.assetId}/parts`))
      .send({ partNumbers: [999] });

    expect(response.status).toBe(422);
  });

  it('will not let another user stage a part for an upload that is not theirs', async () => {
    const alice = await createInstructor({ email: 'alice-mp@test.dev' });
    await createInstructor({ email: 'bob-mp@test.dev' });
    const { course } = await createCourse({ ownerId: alice.user.id, status: 'DRAFT' });

    const aliceAgent = await loginAs('alice-mp@test.dev');
    const presign = await begin(aliceAgent, course.id, bigMp4());
    const plan = presign.body.data.multipart as MultipartPlan;

    const bob = await loginAs('bob-mp@test.dev');
    expect((await putPart(bob, plan.uploadId, 1, Buffer.alloc(1024))).status).toBe(404);

    const targets = await bob
      .withCsrf(bob.agent.post(`/api/v1/uploads/${presign.body.data.assetId}/parts`))
      .send({ partNumbers: [1] });
    expect(targets.status).toBe(404);
  });

  it('abandons the staged parts when the upload is cancelled', async () => {
    const { user } = await createInstructor({ email: 'cancelmp@test.dev' });
    const { course } = await createCourse({ ownerId: user.id, status: 'DRAFT' });
    const agent = await loginAs('cancelmp@test.dev');
    const file = bigMp4();

    const presign = await begin(agent, course.id, file);
    const plan = presign.body.data.multipart as MultipartPlan;
    const assetId = presign.body.data.assetId as string;
    await putPart(agent, plan.uploadId, 1, sliceOf(file, 1, plan.partSizeBytes));

    const removed = await agent.withCsrf(agent.agent.delete(`/api/v1/uploads/${assetId}`));
    expect(removed.status).toBe(204);

    expect(await prisma.mediaAsset.count({ where: { id: assetId } })).toBe(0);
    /*
     * The staged parts go with it. An abandoned multipart upload is
     * storage that no bucket listing shows and the owner still pays for,
     * so leaving it behind would be a bill nobody can see.
     */
    const provider = new LocalStorageDriver(storageDir);
    expect(await provider.listParts({ uploadId: plan.uploadId })).toEqual([]);
  });
});
