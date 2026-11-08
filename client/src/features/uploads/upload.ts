import type {
  CompleteUploadInput,
  MediaAsset,
  PartTargetsResponse,
  PresignUploadInput,
  PresignedPartTarget,
  PresignedUpload,
  UploadStatus,
} from '@cadence/shared';
import { API_BASE, ApiError, apiClient } from '@/lib/api-client';

/**
 * Uploading a file, with a progress bar and the ability to resume.
 *
 * `XMLHttpRequest` rather than `fetch`, for one reason: `fetch` cannot
 * report upload progress. A 400 MB video with no feedback is
 * indistinguishable from a hung browser, so the one place in the app that
 * does not use the shared fetch client is here, deliberately.
 *
 * Two paths, chosen by the server from the file's size:
 *
 *  - **single request** for a small file, where multipart's per-part
 *    round trip would be pure overhead;
 *  - **multipart** above the threshold, where the file is sliced and each
 *    part sent separately. A dropped connection then costs one part
 *    rather than the whole transfer, and a part that fails is retried
 *    with backoff without touching the parts around it.
 */

export type UploadProgress = {
  loadedBytes: number;
  totalBytes: number;
  percentage: number;
};

export type UploadPhase = 'presigning' | 'uploading' | 'processing';

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

/** How many parts travel at once. */
const PART_CONCURRENCY = 3;
/** How many times one part is retried before the upload gives up. */
const PART_ATTEMPTS = 4;

/** Where an in-flight upload is remembered, so a reload can resume it. */
const RESUME_KEY = 'cadence:resumable-uploads';

/** Reads the CSRF cookie, as the shared client does. */
function csrfToken(): string | undefined {
  const match = /(?:^|;\s*)csrf_token=([^;]*)/.exec(document.cookie);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

/**
 * Identifies a chosen file.
 *
 * A browser cannot re-read a `File` across a page reload, so resuming
 * after one means the user picks the file again. This is what lets the
 * server confirm they picked the *same* file rather than letting two
 * different videos be stitched together from each other's parts.
 */
export function fingerprintFor(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

/** Remembers that this file has an upload in flight. */
function rememberUpload(fingerprint: string, assetId: string): void {
  try {
    const stored = JSON.parse(localStorage.getItem(RESUME_KEY) ?? '{}') as Record<
      string,
      string
    >;
    stored[fingerprint] = assetId;
    localStorage.setItem(RESUME_KEY, JSON.stringify(stored));
  } catch {
    // Private mode, or a blocked store. Resuming within the session still
    // works; only resuming across a reload is lost.
  }
}

function forgetUpload(fingerprint: string): void {
  try {
    const stored = JSON.parse(localStorage.getItem(RESUME_KEY) ?? '{}') as Record<
      string,
      string
    >;
    delete stored[fingerprint];
    localStorage.setItem(RESUME_KEY, JSON.stringify(stored));
  } catch {
    // As above.
  }
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

    let settled = false;
    const finish = (value: number | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(value);
    };

    /*
     * A deadline, because this is a hint and must never be a hang.
     *
     * Nothing guarantees the browser fires either event — a codec it
     * cannot parse, a file it decides not to load, or an environment with
     * no media stack at all. Without this the upload would wait here
     * forever before it had sent a single byte. Giving up simply means
     * the server measures the duration itself, which it prefers anyway.
     */
    const timer = setTimeout(() => finish(undefined), 5000);

    video.addEventListener('loadedmetadata', () => {
      finish(Number.isFinite(video.duration) ? Math.round(video.duration) : undefined);
    });
    // An unreadable file is not an error here: the server will reject it
    // with a better message than the browser can give.
    video.addEventListener('error', () => finish(undefined));
    video.src = url;
  });
}

/** One PUT, with progress. Resolves with the response's ETag if it sent one. */
function putBlob(
  target: { uploadUrl: string; method: 'PUT' | 'POST'; headers: Record<string, string> },
  body: Blob,
  onProgress: (loadedBytes: number) => void,
  register: (abort: () => void) => void,
): Promise<string | null> {
  const request = new XMLHttpRequest();
  register(() => request.abort());

  return new Promise<string | null>((resolve, reject) => {
    request.open(target.method, target.uploadUrl, true);

    for (const [header, value] of Object.entries(target.headers)) {
      request.setRequestHeader(header, value);
    }

    // Our own endpoints need the session cookie and the CSRF header. A
    // presigned S3 URL needs neither, and sending credentials
    // cross-origin would break the signature.
    if (target.uploadUrl.startsWith('/')) {
      request.withCredentials = true;
      const token = csrfToken();
      if (token) request.setRequestHeader('X-CSRF-Token', token);
    }

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded);
    });

    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        // S3 returns the part's ETag in a header; our own endpoint echoes
        // one in the same shape so the caller need not care which served it.
        resolve(request.getResponseHeader('ETag'));
      } else {
        reject(
          new ApiError(
            request.status,
            'INTERNAL_ERROR',
            `The upload failed (${request.status}).`,
          ),
        );
      }
    });

    request.addEventListener('error', () => {
      reject(new ApiError(0, 'INTERNAL_ERROR', 'The connection dropped while uploading.'));
    });

    request.addEventListener('abort', () => reject(new UploadCancelled()));

    request.send(body);
  });
}

/** Exponential backoff between attempts at one part. */
function backoff(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.min(8000, 2 ** attempt * 250)));
}

/**
 * Sends the parts that are not already in storage.
 *
 * Runs a small pool rather than all parts at once: an unbounded fan-out
 * of 256 requests would be throttled by the browser anyway, and would
 * make the progress bar meaningless.
 */
async function uploadParts(params: {
  assetId: string;
  file: File;
  partSizeBytes: number;
  totalParts: number;
  alreadyUploaded: number[];
  onProgress: (loadedBytes: number) => void;
  registerAbort: (abort: () => void) => void;
  isCancelled: () => boolean;
}): Promise<void> {
  const done = new Set(params.alreadyUploaded);
  const pending = Array.from({ length: params.totalParts }, (_, index) => index + 1).filter(
    (partNumber) => !done.has(partNumber),
  );

  // Bytes already in storage count towards the bar from the start, so a
  // resumed upload does not appear to begin again at zero.
  const baseBytes = params.alreadyUploaded.length * params.partSizeBytes;
  const inFlight = new Map<number, number>();
  const completed = new Set<number>();

  const report = () => {
    const sent =
      baseBytes +
      completed.size * params.partSizeBytes +
      [...inFlight.values()].reduce((sum, value) => sum + value, 0);
    params.onProgress(Math.min(sent, params.file.size));
  };

  /** Signs a batch of parts in one request. */
  const targetsFor = async (
    partNumbers: number[],
  ): Promise<Map<number, PresignedPartTarget>> => {
    const response = await apiClient.post<PartTargetsResponse>(
      `/uploads/${params.assetId}/parts`,
      { partNumbers },
    );
    return new Map(response.parts.map((entry) => [entry.partNumber, entry.target]));
  };

  const queue = [...pending];
  let failure: unknown = null;

  const worker = async () => {
    while (queue.length > 0 && !failure) {
      if (params.isCancelled()) throw new UploadCancelled();

      const partNumber = queue.shift();
      if (partNumber === undefined) return;

      const start = (partNumber - 1) * params.partSizeBytes;
      const slice = params.file.slice(start, start + params.partSizeBytes);

      let attempt = 0;
      for (;;) {
        try {
          const targets = await targetsFor([partNumber]);
          const target = targets.get(partNumber);
          if (!target) throw new Error(`No upload target for part ${partNumber}`);

          await putBlob(
            target,
            slice,
            (loaded) => {
              inFlight.set(partNumber, loaded);
              report();
            },
            params.registerAbort,
          );

          inFlight.delete(partNumber);
          completed.add(partNumber);
          report();
          break;
        } catch (error) {
          inFlight.delete(partNumber);
          if (error instanceof UploadCancelled) throw error;

          attempt += 1;
          if (attempt >= PART_ATTEMPTS) {
            // The part is beyond saving, but everything already sent
            // stays in storage — which is what makes the next attempt a
            // resume rather than a restart.
            failure = error;
            throw error;
          }
          await backoff(attempt);
        }
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(PART_CONCURRENCY, Math.max(1, queue.length)) }, worker),
  );
}

/**
 * Runs the whole flow and returns a handle so the caller can cancel.
 *
 * For a large file this resumes automatically: the server recognises the
 * fingerprint, tells us which parts it already holds, and only the rest
 * are sent.
 */
export function uploadFile(params: {
  file: File;
  kind: 'VIDEO' | 'IMAGE';
  purpose: PresignUploadInput['purpose'];
  courseId?: string | undefined;
  durationSeconds?: number | undefined;
  onProgress?: (progress: UploadProgress) => void;
  onPhase?: (phase: UploadPhase) => void;
  /** Told whether the server picked up an upload already in progress. */
  onResumed?: (uploadedParts: number, totalParts: number) => void;
}): UploadHandle {
  let cancelled = false;
  const aborts = new Set<() => void>();
  const registerAbort = (abort: () => void) => {
    aborts.add(abort);
  };

  const report = (loadedBytes: number) => {
    params.onProgress?.({
      loadedBytes,
      totalBytes: params.file.size,
      percentage:
        params.file.size === 0 ? 0 : Math.round((loadedBytes / params.file.size) * 100),
    });
  };

  const done = (async (): Promise<MediaAsset> => {
    const fingerprint = fingerprintFor(params.file);
    params.onPhase?.('presigning');

    const plan = await apiClient.post<PresignedUpload>('/uploads/presign', {
      kind: params.kind,
      purpose: params.purpose,
      mimeType: params.file.type,
      sizeBytes: params.file.size,
      originalName: params.file.name,
      fingerprint,
      ...(params.courseId ? { courseId: params.courseId } : {}),
    } satisfies PresignUploadInput);

    if (cancelled) throw new UploadCancelled();
    params.onPhase?.('uploading');

    if (plan.multipart) {
      rememberUpload(fingerprint, plan.assetId);

      if (plan.multipart.resumed && plan.multipart.uploadedParts.length > 0) {
        params.onResumed?.(
          plan.multipart.uploadedParts.length,
          plan.multipart.totalParts,
        );
      }

      await uploadParts({
        assetId: plan.assetId,
        file: params.file,
        partSizeBytes: plan.multipart.partSizeBytes,
        totalParts: plan.multipart.totalParts,
        alreadyUploaded: plan.multipart.uploadedParts,
        onProgress: report,
        registerAbort,
        isCancelled: () => cancelled,
      });
    } else {
      if (!plan.uploadUrl) throw new Error('The server issued no upload target');
      await putBlob(
        { uploadUrl: plan.uploadUrl, method: plan.method, headers: plan.headers },
        params.file,
        report,
        registerAbort,
      );
    }

    // "Checking file type & reading duration" — the server is assembling
    // the parts, verifying the magic bytes and extracting the duration.
    params.onPhase?.('processing');
    const asset = await apiClient.post<MediaAsset>(`/uploads/${plan.assetId}/complete`, {
      ...(params.durationSeconds !== undefined
        ? { durationSeconds: params.durationSeconds }
        : {}),
    } satisfies CompleteUploadInput);

    forgetUpload(fingerprint);
    return asset;
  })();

  return {
    done,
    cancel: () => {
      cancelled = true;
      for (const abort of aborts) abort();
    },
  };
}

/** How much of a previously started upload is already in storage. */
export function uploadStatus(assetId: string): Promise<UploadStatus> {
  return apiClient.get<UploadStatus>(`/uploads/${assetId}/status`);
}

/** Removes an upload the user cancelled or replaced. */
export function deleteUpload(assetId: string): Promise<unknown> {
  return apiClient.delete(`/uploads/${assetId}`);
}

export { API_BASE };
