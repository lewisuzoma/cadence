import type {
  CompleteUploadInput,
  MediaAsset,
  PresignUploadInput,
  PresignedUpload,
} from '@cadence/shared';
import { env } from '../../config/env.js';
import { ConflictError, NotFoundError, UnprocessableError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { mediaUrlForKey } from '../../lib/media-url.js';
import { assertOwnsCourse } from '../../lib/ownership.js';
import { prisma } from '../../lib/prisma.js';
import {
  acceptClientDuration,
  probeDurationFromBuffer,
} from '../../lib/storage/duration.js';
import {
  ALLOWED_LABELS,
  buildStorageKey,
  isAllowedMimeType,
  maxBytesFor,
  storage,
  verifyStoredType,
} from '../../lib/storage/index.js';
import type { AuthUser } from '../../middlewares/types.js';

/**
 * Uploads.
 *
 * The flow is: **presign → the browser PUTs the bytes → confirm.** The API
 * never carries the bytes on the S3 path, which is what makes a 2 GB video
 * upload not a problem for a single Node process.
 *
 * Both ends of that flow are checked, because the middle is not under our
 * control:
 *
 *  - **Before** issuing a target: is this person allowed to upload for this
 *    course, is the type on the allow-list, is the size within the ceiling?
 *  - **After** the bytes land: what was *actually* stored? Its real size,
 *    and its real type read from its magic bytes, not the type the client
 *    claimed. Only then does the asset become READY.
 *
 * An asset that fails the second check is marked FAILED and its object
 * deleted, so a rejected file leaves nothing behind.
 */

/** Which permission each purpose needs, and what it attaches to. */
const PURPOSE_KINDS = {
  LESSON_VIDEO: 'VIDEO',
  COURSE_THUMBNAIL: 'IMAGE',
  PROFILE_PHOTO: 'IMAGE',
} as const;

function toMediaAsset(row: {
  id: string;
  kind: 'VIDEO' | 'IMAGE';
  status: 'PENDING' | 'READY' | 'FAILED';
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  originalName: string | null;
  storageKey: string;
  createdAt: Date;
}): MediaAsset {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    durationSeconds: row.durationSeconds,
    originalName: row.originalName,
    // Images get a stable path; a video's playback URL is minted by the
    // lesson endpoint after its own access check, never here.
    url: row.kind === 'IMAGE' && row.status === 'READY' ? mediaUrlForKey(row.storageKey) : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export const uploadsService = {
  /**
   * Checks the request, reserves an asset row, and returns where to send
   * the bytes.
   *
   * The row is created PENDING *before* the upload so that an abandoned
   * upload is visible to the cleanup job rather than becoming an orphaned
   * object nobody knows about.
   */
  async presign(input: PresignUploadInput, actor: AuthUser): Promise<PresignedUpload> {
    const expectedKind = PURPOSE_KINDS[input.purpose];
    if (input.kind !== expectedKind) {
      throw new UnprocessableError(
        `A ${input.purpose.toLowerCase().replace('_', ' ')} must be ${
          expectedKind === 'VIDEO' ? 'a video' : 'an image'
        }.`,
      );
    }

    if (!isAllowedMimeType(input.kind, input.mimeType)) {
      throw new UnprocessableError(
        `Unsupported format. Use ${ALLOWED_LABELS[input.kind]}.`,
      );
    }

    const limit = maxBytesFor(input.kind);
    if (input.sizeBytes > limit) {
      const limitMb = input.kind === 'VIDEO' ? env.MAX_VIDEO_MB : env.MAX_IMAGE_MB;
      throw new UnprocessableError(
        `That file is ${formatMb(input.sizeBytes)} MB. The limit is ${limitMb} MB.`,
      );
    }

    /*
     * Ownership is checked here, not only when the asset is later attached
     * to a lesson. Otherwise anyone with an instructor account could use
     * the platform's storage as free hosting by presigning against a course
     * id they do not own.
     */
    if (input.courseId) {
      const course = await prisma.course.findUnique({
        where: { id: input.courseId },
        select: { id: true, createdById: true },
      });
      assertOwnsCourse(course, actor);
    } else if (input.purpose !== 'PROFILE_PHOTO') {
      throw new UnprocessableError('A course is required for this kind of upload.');
    }

    const storageKey = buildStorageKey({
      purpose: input.purpose,
      ownerId: actor.id,
      mimeType: input.mimeType,
    });

    const asset = await prisma.mediaAsset.create({
      data: {
        ownerId: actor.id,
        kind: input.kind,
        storageKey,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        ...(input.originalName ? { originalName: input.originalName } : {}),
        status: 'PENDING',
      },
    });

    const target = await storage().createUploadTarget({
      key: storageKey,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    });

    return {
      assetId: asset.id,
      uploadUrl: target.uploadUrl,
      method: target.method,
      headers: target.headers,
      storageKey,
      expiresInSeconds: target.expiresInSeconds,
    };
  },

  /**
   * Verifies what was actually stored and marks the asset READY.
   *
   * This is the gate everything else depends on: a lesson is only
   * publishable when its video asset is READY, so nothing a learner can
   * reach has skipped this check.
   */
  async complete(
    assetId: string,
    input: CompleteUploadInput,
    actor: AuthUser,
  ): Promise<MediaAsset> {
    const asset = await this.loadOwned(assetId, actor);

    if (asset.status === 'READY') {
      // Idempotent: a retried confirmation is not an error.
      return toMediaAsset(asset);
    }

    const stored = await storage().head(asset.storageKey);
    if (!stored) {
      await this.markFailed(asset.id);
      throw new UnprocessableError(
        'No file arrived in storage. Try the upload again.',
      );
    }

    // The real size, which may differ from the one that was declared.
    const limit = maxBytesFor(asset.kind);
    if (stored.sizeBytes > limit) {
      await this.discard(asset.id, asset.storageKey);
      const limitMb = asset.kind === 'VIDEO' ? env.MAX_VIDEO_MB : env.MAX_IMAGE_MB;
      throw new UnprocessableError(
        `The uploaded file is ${formatMb(stored.sizeBytes)} MB, over the ${limitMb} MB limit.`,
      );
    }
    if (stored.sizeBytes === 0) {
      await this.discard(asset.id, asset.storageKey);
      throw new UnprocessableError('The uploaded file is empty.');
    }

    // The real type, read from the content.
    const verdict = verifyStoredType({
      kind: asset.kind,
      declaredMimeType: asset.mimeType,
      head: stored.headBytes,
    });
    if (!verdict.ok) {
      await this.discard(asset.id, asset.storageKey);
      throw new UnprocessableError(verdict.reason);
    }

    let durationSeconds: number | null = null;
    if (asset.kind === 'VIDEO') {
      // ffprobe where it exists; the browser's figure, sanity-checked,
      // where it does not. See lib/storage/duration.ts for why the client
      // value cannot simply be trusted.
      const data = await storage().getBuffer(asset.storageKey);
      if (data) {
        durationSeconds = await probeDurationFromBuffer(
          data,
          verdict.detected.mime === 'video/webm' ? '.webm' : '.mp4',
        );
      }
      durationSeconds ??= acceptClientDuration(input.durationSeconds);

      if (durationSeconds === null) {
        // Stored, but not playable: the publish checklist will report the
        // lesson as needing a video rather than letting a course go live
        // with a duration completion can never be measured against.
        await this.markFailed(asset.id);
        throw new UnprocessableError(
          "We couldn't read this video's duration. Re-export it as MP4 (H.264) and try again.",
        );
      }
    }

    const updated = await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: {
        status: 'READY',
        sizeBytes: stored.sizeBytes,
        mimeType: verdict.detected.mime,
        ...(durationSeconds !== null ? { durationSeconds } : {}),
      },
    });

    return toMediaAsset(updated);
  },

  /** Cancels an upload and removes whatever reached storage. */
  async remove(assetId: string, actor: AuthUser): Promise<void> {
    const asset = await this.loadOwned(assetId, actor);

    const inUse = await prisma.lesson.count({ where: { videoAssetId: assetId } });
    const asThumbnail = await prisma.course.count({ where: { thumbnailAssetId: assetId } });
    if (inUse + asThumbnail > 0) {
      throw new ConflictError(
        'This file is still attached to a lesson or a course. Replace it there first.',
      );
    }

    await this.discard(asset.id, asset.storageKey);
  },

  /** The asset, if it belongs to the caller. */
  async loadOwned(assetId: string, actor: AuthUser) {
    const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
    // 404 rather than 403 for someone else's asset, as everywhere else.
    if (!asset) throw new NotFoundError('Upload');
    if (asset.ownerId !== actor.id) {
      const isAdmin = actor.role === 'ADMIN';
      if (!isAdmin) throw new NotFoundError('Upload');
    }
    return asset;
  },

  async markFailed(assetId: string): Promise<void> {
    await prisma.mediaAsset.update({ where: { id: assetId }, data: { status: 'FAILED' } });
  },

  /** Marks the row FAILED and deletes the object. */
  async discard(assetId: string, storageKey: string): Promise<void> {
    await storage()
      .delete(storageKey)
      .catch((error: unknown) => {
        // A failed delete must not turn a rejected upload into a 500; the
        // cleanup job will catch the object later.
        logger.warn({ err: error, storageKey }, 'Could not delete a rejected upload');
      });
    await prisma.mediaAsset.deleteMany({ where: { id: assetId } });
  },

  /**
   * A short-lived playback URL for a lesson video, **after** the caller's
   * access to that lesson has already been established.
   *
   * This function does not check access: it is deliberately only called
   * from `lessonsService.getDetail`, which has just done so. Putting the
   * check here as well would duplicate the rule in two places and invite
   * them to disagree.
   */
  async playbackUrlFor(asset: {
    storageKey: string;
    status: string;
  }): Promise<string | null> {
    if (asset.status !== 'READY') return null;
    const signed = await storage().createPlaybackUrl(
      asset.storageKey,
      env.SIGNED_URL_TTL_SECONDS,
    );
    // The local driver has no signed URLs, so playback goes through the
    // API's own streaming endpoint, which re-checks access itself.
    return signed;
  },

  /**
   * Deletes PENDING assets older than the cutoff.
   *
   * An upload that was started and abandoned leaves a row and possibly a
   * partial object. Without this they accumulate forever.
   */
  async cleanupOrphans(olderThanMinutes = 60 * 24): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
    const orphans = await prisma.mediaAsset.findMany({
      where: { status: { in: ['PENDING', 'FAILED'] }, createdAt: { lt: cutoff } },
      select: { id: true, storageKey: true },
    });

    for (const orphan of orphans) {
      await this.discard(orphan.id, orphan.storageKey);
    }
    if (orphans.length > 0) {
      logger.info({ count: orphans.length }, 'Cleaned up abandoned uploads');
    }
    return orphans.length;
  },
};

function formatMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}
