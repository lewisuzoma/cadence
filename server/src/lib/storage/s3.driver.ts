import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
import { env } from '../../config/env.js';
import type {
  ByteRange,
  ObjectStream,
  StorageProvider,
  UploadedPart,
  UploadTarget,
} from './types.js';

/**
 * S3-compatible object storage: MinIO in Docker Compose, S3 or R2 in
 * production.
 *
 * The browser uploads **straight to storage** with a presigned PUT, so
 * video bytes never pass through the API process. That is the difference
 * between a 2 GB upload being a streaming concern for one Node process and
 * it being someone else's problem.
 */

const HEAD_BYTES = 64;

export class S3StorageDriver implements StorageProvider {
  readonly name = 's3' as const;

  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    // The env schema already refused to start without these when
    // STORAGE_DRIVER=s3, so the assertions here are for the type checker.
    this.bucket = env.S3_BUCKET!;
    this.client = new S3Client({
      region: env.S3_REGION,
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      // MinIO needs path-style addressing; S3 tolerates it.
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY!,
        secretAccessKey: env.S3_SECRET_KEY!,
      },
    });
  }

  async createUploadTarget(params: {
    key: string;
    mimeType: string;
  }): Promise<UploadTarget> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.key,
        ContentType: params.mimeType,
      }),
      { expiresIn: env.SIGNED_URL_TTL_SECONDS },
    );

    return {
      uploadUrl: url,
      method: 'PUT',
      // The signature covers Content-Type, so the browser must send the
      // same one it asked us to sign for.
      headers: { 'Content-Type': params.mimeType },
      expiresInSeconds: env.SIGNED_URL_TTL_SECONDS,
    };
  }

  // --- multipart ----------------------------------------------------------
  //
  // S3's own multipart API. Each part is PUT straight to the bucket with
  // its own presigned URL, so a dropped connection costs one part rather
  // than the whole transfer, and the API process never carries the bytes.

  async createMultipartUpload(params: {
    key: string;
    mimeType: string;
  }): Promise<{ uploadId: string }> {
    const response = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: params.key,
        ContentType: params.mimeType,
      }),
    );
    if (!response.UploadId) {
      throw new Error('S3 did not return an upload id for the multipart upload');
    }
    return { uploadId: response.UploadId };
  }

  async createPartTarget(params: {
    key: string;
    uploadId: string;
    partNumber: number;
  }): Promise<UploadTarget> {
    const url = await getSignedUrl(
      this.client,
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: params.key,
        UploadId: params.uploadId,
        PartNumber: params.partNumber,
      }),
      { expiresIn: env.SIGNED_URL_TTL_SECONDS },
    );
    return {
      uploadUrl: url,
      method: 'PUT',
      // Deliberately no Content-Type: it is not part of the signature for
      // UploadPart, and sending one the signature did not cover is a
      // common cause of a mystifying 403 from S3.
      headers: {},
      expiresInSeconds: env.SIGNED_URL_TTL_SECONDS,
    };
  }

  /**
   * Which parts S3 already holds.
   *
   * Paginated, because `ListParts` returns at most 1000 at a time and a
   * 2 GB file at an 8 MB part size is 256 parts — comfortably inside one
   * page today, but a larger ceiling would not be.
   */
  async listParts(params: { key: string; uploadId: string }): Promise<UploadedPart[]> {
    const parts: UploadedPart[] = [];
    let marker: number | undefined;

    try {
      do {
        const response = await this.client.send(
          new ListPartsCommand({
            Bucket: this.bucket,
            Key: params.key,
            UploadId: params.uploadId,
            ...(marker !== undefined ? { PartNumberMarker: String(marker) } : {}),
          }),
        );

        for (const part of response.Parts ?? []) {
          if (part.PartNumber === undefined || !part.ETag) continue;
          parts.push({
            partNumber: part.PartNumber,
            etag: part.ETag,
            sizeBytes: part.Size ?? 0,
          });
        }

        marker = response.IsTruncated ? Number(response.NextPartNumberMarker) : undefined;
      } while (marker !== undefined);
    } catch {
      // An upload S3 has never heard of, or one already completed or
      // aborted: nothing has landed as far as the caller is concerned.
      return [];
    }

    return parts;
  }

  async completeMultipartUpload(params: {
    key: string;
    uploadId: string;
    parts: UploadedPart[];
  }): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: params.key,
        UploadId: params.uploadId,
        MultipartUpload: {
          // S3 requires ascending part numbers.
          Parts: [...params.parts]
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
        },
      }),
    );
  }

  async abortMultipartUpload(params: { key: string; uploadId: string }): Promise<void> {
    try {
      await this.client.send(
        new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: params.key,
          UploadId: params.uploadId,
        }),
      );
    } catch {
      // Aborting something already gone is success as far as callers are
      // concerned; the cleanup job will sweep anything genuinely stuck.
    }
  }

  async head(key: string): Promise<{ sizeBytes: number; headBytes: Buffer } | null> {
    try {
      const info = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );

      // A ranged GET for the first bytes: the magic-byte check needs the
      // content, and fetching a whole 2 GB video to read 64 bytes would be
      // absurd.
      const head = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: `bytes=0-${HEAD_BYTES - 1}`,
        }),
      );

      const headBytes = await streamToBuffer(head.Body as Readable);
      return { sizeBytes: info.ContentLength ?? 0, headBytes };
    } catch {
      return null;
    }
  }

  async getStream(key: string, range?: ByteRange): Promise<ObjectStream | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
        }),
      );

      const contentLength = response.ContentLength ?? 0;
      // `ContentRange` is "bytes 0-99/12345"; the tail is the real size.
      const totalSize = response.ContentRange
        ? Number(response.ContentRange.split('/')[1] ?? contentLength)
        : contentLength;

      return {
        stream: response.Body as Readable,
        contentLength,
        totalSize,
        mimeType: response.ContentType ?? 'application/octet-stream',
      };
    } catch {
      return null;
    }
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    const object = await this.getStream(key);
    if (!object) return null;
    return streamToBuffer(object.stream);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** A short-lived signed GET, minted per request and never stored. */
  async createPlaybackUrl(key: string, expiresInSeconds: number): Promise<string | null> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer));
  }
  return Buffer.concat(chunks);
}
