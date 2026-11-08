import { createReadStream, createWriteStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, open, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { env } from '../../config/env.js';
import type {
  ByteRange,
  ObjectStream,
  StorageProvider,
  UploadedPart,
  UploadTarget,
} from './types.js';

/**
 * Local-disk storage.
 *
 * The default driver, so a reviewer gets working uploads from
 * `docker compose up` with no cloud account and no credentials. The
 * directory is a named Docker volume in Compose, so uploads survive a
 * restart but are not baked into the image.
 *
 * It has no presigned URLs, so `createUploadTarget` points the browser at
 * our own `PUT /api/v1/uploads/:id/bytes` endpoint. That endpoint is
 * authenticated and ownership-checked exactly as the presign call was, so
 * the security properties match the S3 path rather than being relaxed for
 * convenience.
 */

/** How much of a file the magic-byte check needs. */
const HEAD_BYTES = 64;

export class LocalStorageDriver implements StorageProvider {
  readonly name = 'local' as const;

  private readonly root: string;

  constructor(root: string = env.STORAGE_LOCAL_DIR) {
    this.root = path.resolve(root);
  }

  /**
   * Resolves a key to a path inside the storage root, refusing anything
   * that escapes it.
   *
   * Keys are generated server-side today, but a path-traversal hole that
   * only a future change could open is still a hole. `..` in a key would
   * otherwise let a write land anywhere the process can reach.
   */
  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (!full.startsWith(rootWithSep)) {
      throw new Error(`Refusing a storage key that escapes the root: ${key}`);
    }
    return full;
  }

  async createUploadTarget(params: { key: string }): Promise<UploadTarget> {
    await mkdir(path.dirname(this.resolve(params.key)), { recursive: true });
    return {
      // Relative, so it works behind nginx, behind the Vite proxy and in
      // the single-process deployment without any of them being configured.
      uploadUrl: `/api/v1/uploads/by-key/${encodeURIComponent(params.key)}/bytes`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      expiresInSeconds: env.SIGNED_URL_TTL_SECONDS,
    };
  }

  /** Writes bytes for a key. Used by the API's own upload endpoint. */
  async write(key: string, data: Buffer): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  // --- multipart ----------------------------------------------------------
  //
  // Parts are staged as individual files under `.multipart/<uploadId>/`
  // and concatenated on completion. Staging beside the storage root
  // rather than in the OS temp directory matters: a part written before a
  // container restart is still there afterwards, which is the whole point
  // of being able to resume.

  /** The staging directory for one multipart upload. */
  private stagingDir(uploadId: string): string {
    // `uploadId` is generated here and is a UUID, but it still goes
    // through `resolve` so a future caller cannot walk out of the root.
    return this.resolve(path.join('.multipart', uploadId));
  }

  private partPath(uploadId: string, partNumber: number): string {
    // Zero-padded so a lexical directory listing is also numeric order.
    return path.join(this.stagingDir(uploadId), String(partNumber).padStart(6, '0'));
  }

  async createMultipartUpload(): Promise<{ uploadId: string }> {
    const uploadId = randomUUID();
    await mkdir(this.stagingDir(uploadId), { recursive: true });
    return { uploadId };
  }

  async createPartTarget(params: {
    uploadId: string;
    partNumber: number;
  }): Promise<UploadTarget> {
    await mkdir(this.stagingDir(params.uploadId), { recursive: true });
    return {
      uploadUrl: `/api/v1/uploads/multipart/${params.uploadId}/parts/${params.partNumber}`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      expiresInSeconds: env.SIGNED_URL_TTL_SECONDS,
    };
  }

  /** Stages one part. Called by the API's own receiving endpoint. */
  async writePart(uploadId: string, partNumber: number, data: Buffer): Promise<string> {
    await mkdir(this.stagingDir(uploadId), { recursive: true });
    await writeFile(this.partPath(uploadId, partNumber), data);
    // An MD5 of the content, which is what S3's ETag is for a single
    // part — so both drivers hand the client the same kind of token.
    return createHash('md5').update(data).digest('hex');
  }

  async listParts(params: { uploadId: string }): Promise<UploadedPart[]> {
    let names: string[];
    try {
      names = await readdir(this.stagingDir(params.uploadId));
    } catch {
      // No staging directory means nothing has landed yet.
      return [];
    }

    const parts: UploadedPart[] = [];
    for (const name of names.sort()) {
      const partNumber = Number(name);
      if (!Number.isInteger(partNumber)) continue;
      const full = path.join(this.stagingDir(params.uploadId), name);
      const info = await stat(full);
      parts.push({
        partNumber,
        etag: createHash('md5').update(await readFile(full)).digest('hex'),
        sizeBytes: info.size,
      });
    }
    return parts;
  }

  /**
   * Concatenates the staged parts into the final object.
   *
   * Streamed rather than read into one Buffer: a 2 GB video assembled in
   * memory would be a 2 GB allocation in the API process, which is
   * exactly what multipart exists to avoid.
   */
  async completeMultipartUpload(params: {
    key: string;
    uploadId: string;
    parts: UploadedPart[];
  }): Promise<void> {
    const destination = this.resolve(params.key);
    await mkdir(path.dirname(destination), { recursive: true });

    const ordered = [...params.parts].sort((a, b) => a.partNumber - b.partNumber);
    const output = createWriteStream(destination);

    try {
      for (const part of ordered) {
        await pipeline(createReadStream(this.partPath(params.uploadId, part.partNumber)), output, {
          end: false,
        });
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        output.end((error?: Error | null) => (error ? reject(error) : resolve()));
      });
    }

    await this.abortMultipartUpload({ uploadId: params.uploadId });
  }

  /** Removes the staging directory. A no-op if it was never created. */
  async abortMultipartUpload(params: { uploadId: string }): Promise<void> {
    await rm(this.stagingDir(params.uploadId), { recursive: true, force: true });
  }

  async head(key: string): Promise<{ sizeBytes: number; headBytes: Buffer } | null> {
    const full = this.resolve(key);
    try {
      const info = await stat(full);
      const handle = await open(full, 'r');
      try {
        const buffer = Buffer.alloc(Math.min(HEAD_BYTES, info.size));
        await handle.read(buffer, 0, buffer.length, 0);
        return { sizeBytes: info.size, headBytes: buffer };
      } finally {
        await handle.close();
      }
    } catch {
      return null;
    }
  }

  async getStream(key: string, range?: ByteRange): Promise<ObjectStream | null> {
    const full = this.resolve(key);
    let info;
    try {
      info = await stat(full);
    } catch {
      return null;
    }

    const start = range ? Math.max(0, range.start) : 0;
    const end = range ? Math.min(range.end, info.size - 1) : info.size - 1;

    return {
      stream: createReadStream(full, { start, end }),
      contentLength: end - start + 1,
      totalSize: info.size,
      mimeType: 'application/octet-stream',
    };
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolve(key));
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    // `force` so deleting an object that was never written is a no-op, which
    // is what the cleanup job wants.
    await rm(this.resolve(key), { force: true });
  }

  /**
   * No signed URLs on local disk.
   *
   * Returning `null` tells the caller to stream the bytes through the API
   * instead, which is where the access check already lives.
   */
  createPlaybackUrl(): Promise<string | null> {
    return Promise.resolve(null);
  }
}
