import type { Request, Response } from 'express';
import { completeUploadSchema, presignUploadSchema } from '@cadence/shared';
import { env } from '../../config/env.js';
import { ForbiddenError, NotFoundError, UnprocessableError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { created, noContent, ok } from '../../lib/response.js';
import { LocalStorageDriver, maxBytesFor, storage } from '../../lib/storage/index.js';
import { uploadsService } from './uploads.service.js';

/**
 * HTTP for uploads, including the two endpoints the local driver needs:
 * one to receive bytes, and one to stream them back with Range support.
 */
export const uploadsController = {
  async presign(req: Request, res: Response): Promise<void> {
    const input = presignUploadSchema.parse(req.body);
    const target = await uploadsService.presign(input, req.user!);
    created(res, 'Upload authorized', target);
  },

  async complete(req: Request, res: Response): Promise<void> {
    const input = completeUploadSchema.parse(req.body ?? {});
    const asset = await uploadsService.complete(req.params.id!, input, req.user!);
    ok(res, 'Upload complete', asset);
  },

  async remove(req: Request, res: Response): Promise<void> {
    await uploadsService.remove(req.params.id!, req.user!);
    noContent(res);
  },

  /**
   * Receives bytes for the local driver.
   *
   * The S3 path does not use this — the browser PUTs straight to storage
   * there. Here the API is the storage endpoint, so it repeats the checks
   * a presigned URL would have carried in its signature: the key must
   * belong to a PENDING asset owned by the caller, and the body must be
   * within the size ceiling.
   */
  async putBytes(req: Request, res: Response): Promise<void> {
    const provider = storage();
    if (!(provider instanceof LocalStorageDriver)) {
      throw new NotFoundError('Upload endpoint');
    }

    const key = decodeURIComponent(req.params.key!);
    const asset = await prisma.mediaAsset.findUnique({ where: { storageKey: key } });
    if (!asset) throw new NotFoundError('Upload');
    if (asset.ownerId !== req.user!.id) throw new NotFoundError('Upload');
    if (asset.status !== 'PENDING') {
      throw new UnprocessableError('This upload has already been completed.');
    }

    const chunks: Buffer[] = [];
    let total = 0;
    const limit = maxBytesFor(asset.kind);

    await new Promise<void>((resolve, reject) => {
      req.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > limit) {
          // Stop reading the moment the ceiling is passed, rather than
          // buffering a whole oversized file and rejecting it afterwards.
          reject(
            new UnprocessableError(
              `That file is larger than the ${
                asset.kind === 'VIDEO' ? env.MAX_VIDEO_MB : env.MAX_IMAGE_MB
              } MB limit.`,
            ),
          );
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', resolve);
      req.on('error', reject);
    });

    await provider.write(key, Buffer.concat(chunks));
    ok(res, 'Bytes received', { storageKey: key, sizeBytes: total });
  },

  /**
   * Streams a stored image.
   *
   * Images are public by nature — course thumbnails appear in the catalog
   * to signed-out visitors — so this needs no session. Videos are refused
   * here and go through the lesson endpoint, which checks enrollment.
   */
  async serveMedia(req: Request, res: Response): Promise<void> {
    const key = (req.params[0] ?? '')
      .split('/')
      .map((part) => decodeURIComponent(part))
      .join('/');
    if (!key) throw new NotFoundError('Media');

    const asset = await prisma.mediaAsset.findUnique({
      where: { storageKey: key },
      select: { kind: true, status: true, mimeType: true },
    });
    if (!asset || asset.status !== 'READY') throw new NotFoundError('Media');
    if (asset.kind !== 'IMAGE') {
      // A video is never public; the lesson endpoint serves it.
      throw new ForbiddenError('Video is served through the lesson endpoint');
    }

    const object = await storage().getStream(key);
    if (!object) throw new NotFoundError('Media');

    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Content-Length', String(object.contentLength));
    // Hashed-by-uuid keys never change contents, so they cache hard.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    // Belt and braces: never let a stored file be sniffed into something
    // executable on our own origin.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    object.stream.pipe(res);
  },

  /**
   * Streams a lesson's video, with HTTP Range support so seeking works.
   *
   * Used by the local driver, where there is no signed URL to redirect to.
   * The access check is the lesson's own — the same one that decides
   * whether the player may be shown at all — so there is exactly one place
   * that decides who may watch what.
   */
  async streamLessonVideo(req: Request, res: Response): Promise<void> {
    const { lessonsService } = await import('../lessons/lessons.service.js');
    // Throws 403 or 404 for anyone without access, before a byte is read.
    const key = await lessonsService.resolveVideoKey(req.params.id!, req.user);
    if (!key) throw new NotFoundError('Video');

    /*
     * The range is parsed against the real object size, so a client asking
     * for "bytes=0-" or a suffix range gets the right slice. The size is
     * only known after the head, hence the two steps.
     */
    const head = await storage().head(key);
    if (!head) throw new NotFoundError('Video');

    const range = parseRange(req.headers.range, head.sizeBytes);
    const object = await storage().getStream(key, range ?? undefined);
    if (!object) throw new NotFoundError('Video');

    res.setHeader('Content-Type', object.mimeType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (range) {
      const end = Math.min(range.end, object.totalSize - 1);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${end}/${object.totalSize}`);
      res.setHeader('Content-Length', String(end - range.start + 1));
    } else {
      res.setHeader('Content-Length', String(object.contentLength));
    }

    object.stream.pipe(res);
  },
};

/**
 * Parses a `Range: bytes=start-end` header.
 *
 * Only the single-range form is handled, which is the only one browsers
 * send for media. Anything else returns `null` and the whole object is
 * served, which is a valid response to a Range request.
 */
export function parseRange(
  header: string | undefined,
  totalSize: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  // "bytes=-500" means the last 500 bytes.
  if (rawStart === '') {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, totalSize - suffix), end: totalSize - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isFinite(start) || start < 0) return null;
  const end = rawEnd === '' ? totalSize - 1 : Number(rawEnd);
  if (!Number.isFinite(end) || end < start) return null;

  return { start, end };
}
