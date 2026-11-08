import type { Readable } from 'node:stream';

/**
 * The storage seam.
 *
 * Two drivers implement it: S3-compatible object storage (MinIO locally,
 * S3 or R2 in production) and a local directory on a Docker volume. The
 * local one exists so that `docker compose up` stays a one-liner for a
 * reviewer who has not configured any cloud credentials — uploads have to
 * work out of the box or the feature cannot be evaluated.
 *
 * Nothing above this interface knows which driver is in use. That is what
 * lets the tests run against the local driver with a temp directory while
 * production runs against S3, with the same code path either side.
 */

export type StoredObject = {
  key: string;
  sizeBytes: number;
  mimeType: string;
};

/** A range request, as the video player's seek bar produces. */
export type ByteRange = { start: number; end: number };

export type ObjectStream = {
  stream: Readable;
  /** Bytes in this response — the whole object, or the slice requested. */
  contentLength: number;
  /** The whole object's size, for the Content-Range header. */
  totalSize: number;
  mimeType: string;
};

/**
 * How the browser should send the bytes.
 *
 * `PUT` with a signed URL for S3; `POST` to our own endpoint for local
 * disk. Returning the method and headers rather than assuming them keeps
 * the uploader component driver-agnostic: it reads what to do from the
 * response instead of knowing which driver is configured.
 */
export type UploadTarget = {
  uploadUrl: string;
  method: 'PUT' | 'POST';
  headers: Record<string, string>;
  expiresInSeconds: number;
};

/**
 * One part of a multipart upload that has already landed.
 *
 * The *provider* is the source of truth for this, not our database.
 * With S3 the browser PUTs parts straight to storage and the API never
 * sees them, so asking S3 which parts exist is the only answer that
 * cannot be stale — and it means there is no parts table to drift out of
 * step with the bucket.
 */
export type UploadedPart = {
  partNumber: number;
  /** The provider's identifier for the part's content. */
  etag: string;
  sizeBytes: number;
};

/** A multipart upload in flight. */
export type MultipartUpload = {
  /** The provider's id, which every later call quotes back. */
  uploadId: string;
};

export type StorageProvider = {
  readonly name: 'local' | 's3';

  // --- multipart ---------------------------------------------------------
  //
  // Large files are uploaded in parts so that a dropped connection costs
  // one part rather than the whole transfer. Both drivers implement it:
  // S3 natively, and the local driver by staging part files and
  // concatenating them on completion.

  /** Begins a multipart upload and returns the provider's id for it. */
  createMultipartUpload(params: {
    key: string;
    mimeType: string;
  }): Promise<MultipartUpload>;

  /** Where the client should send one part's bytes. */
  createPartTarget(params: {
    key: string;
    uploadId: string;
    partNumber: number;
  }): Promise<UploadTarget>;

  /**
   * Which parts have already arrived.
   *
   * This is what makes resuming possible: the client asks, and uploads
   * only what is missing.
   */
  listParts(params: { key: string; uploadId: string }): Promise<UploadedPart[]>;

  /** Assembles the parts into the final object. */
  completeMultipartUpload(params: {
    key: string;
    uploadId: string;
    parts: UploadedPart[];
  }): Promise<void>;

  /** Throws the parts away. Safe to call on an upload that never started. */
  abortMultipartUpload(params: { key: string; uploadId: string }): Promise<void>;

  /** Where the client should send the bytes for this key. */
  createUploadTarget(params: {
    key: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<UploadTarget>;

  /**
   * The object's size and the first bytes of its content.
   *
   * The head is what the magic-byte check reads: the declared MIME type and
   * the file extension are both attacker-controlled, and only the content
   * itself says what a file really is.
   */
  head(key: string): Promise<{ sizeBytes: number; headBytes: Buffer } | null>;

  /** Streams an object, optionally a byte range, so seeking works. */
  getStream(key: string, range?: ByteRange): Promise<ObjectStream | null>;

  /** Reads a whole object into memory. Only for small files. */
  getBuffer(key: string): Promise<Buffer | null>;

  delete(key: string): Promise<void>;

  /**
   * A short-lived URL for playback, or `null` when the driver has no
   * concept of one and the API must stream the bytes itself.
   */
  createPlaybackUrl(key: string, expiresInSeconds: number): Promise<string | null>;
};
