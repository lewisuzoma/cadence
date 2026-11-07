import type {
  CompleteUploadInput,
  MediaAsset,
  PresignUploadInput,
  PresignedUpload,
} from '@cadence/shared';
import { API_BASE, ApiError, apiClient } from '@/lib/api-client';

/**
 * Uploading a file, with a progress bar.
 *
 * `XMLHttpRequest` rather than `fetch`, for one reason: `fetch` cannot
 * report upload progress. A 400 MB video with no feedback is
 * indistinguishable from a hung browser, so the one place in the app that
 * does not use the shared fetch client is here, deliberately.
 *
 * The flow mirrors the server's:
 *   presign  → the API checks ownership, type and size, and reserves a row
 *   PUT      → straight to storage (S3) or to the API (local driver)
 *   complete → the server verifies what actually landed and marks it READY
 */

export type UploadProgress = {
  loadedBytes: number;
  totalBytes: number;
  percentage: number;
};

export type UploadHandle = {
  /** Resolves with the verified asset, or rejects. */
  done: Promise<MediaAsset>;
  /** Aborts the transfer. `done` rejects with an `UploadCancelled`. */
  cancel: () => void;
};

export class UploadCancelled extends Error {
  constructor() {
    super('Upload cancelled');
    this.name = 'UploadCancelled';
  }
}

/** Reads the CSRF cookie, as the shared client does. */
function csrfToken(): string | undefined {
  const match = /(?:^|;\s*)csrf_token=([^;]*)/.exec(document.cookie);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

/**
 * Reads a video's duration in the browser.
 *
 * Offered to the server as a hint only — it re-derives the duration with
 * ffprobe where it can, and sanity-checks this value where it cannot,
 * because completion tracking divides by it.
 */
export function readVideoDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';

    const finish = (value: number | undefined) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };

    video.addEventListener('loadedmetadata', () => {
      finish(Number.isFinite(video.duration) ? Math.round(video.duration) : undefined);
    });
    // An unreadable file is not an error here: the server will reject it
    // with a better message than the browser can give.
    video.addEventListener('error', () => finish(undefined));
    video.src = url;
  });
}

/** Sends the bytes, reporting progress. */
function putBytes(
  target: PresignedUpload,
  file: File,
  onProgress: (progress: UploadProgress) => void,
): { promise: Promise<void>; abort: () => void } {
  const request = new XMLHttpRequest();

  const promise = new Promise<void>((resolve, reject) => {
    request.open(target.method, target.uploadUrl, true);

    for (const [header, value] of Object.entries(target.headers)) {
      request.setRequestHeader(header, value);
    }

    // The local driver's endpoint is our own API, so it needs the session
    // cookie and the CSRF header. A presigned S3 URL needs neither, and
    // sending credentials cross-origin would break the signature.
    const sameOrigin = target.uploadUrl.startsWith('/');
    if (sameOrigin) {
      request.withCredentials = true;
      const token = csrfToken();
      if (token) request.setRequestHeader('X-CSRF-Token', token);
    }

    request.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      onProgress({
        loadedBytes: event.loaded,
        totalBytes: event.total,
        percentage: Math.round((event.loaded / event.total) * 100),
      });
    });

    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
      } else {
        reject(
          new ApiError(
            request.status,
            'INTERNAL_ERROR',
            request.status === 0
              ? 'The connection dropped while uploading. Nothing was saved; retrying starts again from the beginning.'
              : `The upload failed (${request.status}).`,
          ),
        );
      }
    });

    request.addEventListener('error', () => {
      reject(
        new ApiError(
          0,
          'INTERNAL_ERROR',
          'The connection dropped while uploading. Nothing was saved; retrying starts again from the beginning.',
        ),
      );
    });

    request.addEventListener('abort', () => reject(new UploadCancelled()));

    request.send(file);
  });

  return { promise, abort: () => request.abort() };
}

/**
 * Runs the whole flow and returns a handle so the caller can cancel.
 *
 * Each call is a fresh attempt: there is no resume, and the UI says so
 * ("retrying continues from the start"). Resumable uploads would need
 * multipart and a lot more machinery than this feature justifies.
 */
export function uploadFile(params: {
  file: File;
  kind: 'VIDEO' | 'IMAGE';
  purpose: PresignUploadInput['purpose'];
  courseId?: string | undefined;
  durationSeconds?: number | undefined;
  onProgress?: (progress: UploadProgress) => void;
  onPhase?: (phase: 'presigning' | 'uploading' | 'processing') => void;
}): UploadHandle {
  let abort: (() => void) | undefined;
  let cancelled = false;

  const done = (async (): Promise<MediaAsset> => {
    params.onPhase?.('presigning');

    const target = await apiClient.post<PresignedUpload>('/uploads/presign', {
      kind: params.kind,
      purpose: params.purpose,
      mimeType: params.file.type,
      sizeBytes: params.file.size,
      originalName: params.file.name,
      ...(params.courseId ? { courseId: params.courseId } : {}),
    } satisfies PresignUploadInput);

    if (cancelled) throw new UploadCancelled();

    params.onPhase?.('uploading');
    const transfer = putBytes(target, params.file, params.onProgress ?? (() => {}));
    abort = transfer.abort;
    await transfer.promise;

    // "Checking file type & reading duration" — the server is verifying
    // the magic bytes and extracting the duration here.
    params.onPhase?.('processing');
    return apiClient.post<MediaAsset>(`/uploads/${target.assetId}/complete`, {
      ...(params.durationSeconds !== undefined
        ? { durationSeconds: params.durationSeconds }
        : {}),
    } satisfies CompleteUploadInput);
  })();

  return {
    done,
    cancel: () => {
      cancelled = true;
      abort?.();
    },
  };
}

/** Removes an upload the user cancelled or replaced. */
export function deleteUpload(assetId: string): Promise<unknown> {
  return apiClient.delete(`/uploads/${assetId}`);
}

export { API_BASE };
