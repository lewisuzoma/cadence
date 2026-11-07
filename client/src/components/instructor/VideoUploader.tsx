import { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Link2, Upload, X } from 'lucide-react';
import { formatTimecode } from '@cadence/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  UploadCancelled,
  readVideoDuration,
  uploadFile,
  type UploadHandle,
} from '@/features/uploads/upload';
import { cn } from '@/lib/utils';

/**
 * The lesson video uploader — desktop artifact page 9's five states.
 *
 *   1 EMPTY       drop zone
 *   2 UPLOADING   filename, "264 of 412 MB · 64%", a bar, Cancel
 *   3 PROCESSING  "Checking file type & reading duration"
 *   4 READY       "Duration detected: 16:48", Replace
 *   5 FAILED      the reason, Choose another / Retry
 *
 * The states are driven by the real request, not simulated: PROCESSING is
 * the window in which the server is reading the magic bytes and the
 * duration, which is genuinely where the time goes on a large file.
 *
 * "Paste a video URL" is the other tab, because an external https:// URL
 * stays supported for development and demos where no storage is
 * configured.
 */

export type VideoValue = {
  /** Set when the video is an upload. */
  assetId?: string | null;
  /** Set when the video is an external URL. */
  url?: string;
  durationSeconds?: number;
};

type Phase =
  | { kind: 'empty' }
  | { kind: 'uploading'; name: string; loaded: number; total: number; percentage: number }
  | { kind: 'processing'; name: string }
  | { kind: 'ready'; name: string; sizeBytes: number; durationSeconds: number | null }
  | { kind: 'failed'; name: string; reason: string };

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(0);
}

export function VideoUploader({
  courseId,
  value,
  onChange,
  existingLabel,
}: {
  courseId: string;
  value: VideoValue;
  onChange: (next: VideoValue) => void;
  /** What the lesson already has, shown before anything is touched. */
  existingLabel?: string | null;
}) {
  const [tab, setTab] = useState<'upload' | 'url'>(value.url ? 'url' : 'upload');
  const [phase, setPhase] = useState<Phase>({ kind: 'empty' });
  const [lastFile, setLastFile] = useState<File | null>(null);
  const handleRef = useRef<UploadHandle | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const start = async (file: File) => {
    setLastFile(file);
    setPhase({
      kind: 'uploading',
      name: file.name,
      loaded: 0,
      total: file.size,
      percentage: 0,
    });

    // Read the duration before sending: the server prefers ffprobe but
    // falls back to this, sanity-checked, when the binary is absent.
    const durationSeconds = await readVideoDuration(file);

    const handle = uploadFile({
      file,
      kind: 'VIDEO',
      purpose: 'LESSON_VIDEO',
      courseId,
      ...(durationSeconds !== undefined ? { durationSeconds } : {}),
      onProgress: (progress) =>
        setPhase({
          kind: 'uploading',
          name: file.name,
          loaded: progress.loadedBytes,
          total: progress.totalBytes,
          percentage: progress.percentage,
        }),
      onPhase: (next) => {
        if (next === 'processing') setPhase({ kind: 'processing', name: file.name });
      },
    });
    handleRef.current = handle;

    try {
      const asset = await handle.done;
      setPhase({
        kind: 'ready',
        name: asset.originalName ?? file.name,
        sizeBytes: asset.sizeBytes,
        durationSeconds: asset.durationSeconds,
      });
      onChange({
        assetId: asset.id,
        ...(asset.durationSeconds ? { durationSeconds: asset.durationSeconds } : {}),
      });
    } catch (error) {
      if (error instanceof UploadCancelled) {
        setPhase({ kind: 'empty' });
        return;
      }
      setPhase({
        kind: 'failed',
        name: file.name,
        reason:
          error instanceof Error
            ? error.message
            : 'The upload failed. Nothing was saved.',
      });
    } finally {
      handleRef.current = null;
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-small font-semibold text-foreground">Video</span>
        <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="Video source">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'upload'}
            onClick={() => setTab('upload')}
            className={cn(
              'min-h-9 rounded-md px-3 text-caption font-semibold transition-colors max-sm:min-h-11',
              tab === 'upload'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-secondary-foreground hover:text-foreground',
            )}
          >
            Upload file
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'url'}
            onClick={() => setTab('url')}
            className={cn(
              'min-h-9 rounded-md px-3 text-caption font-semibold transition-colors max-sm:min-h-11',
              tab === 'url'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-secondary-foreground hover:text-foreground',
            )}
          >
            Paste a video URL
          </button>
        </div>
      </div>

      {tab === 'url' ? (
        <div className="flex flex-col gap-1.5">
          <div className="relative">
            <Link2
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={value.url ?? ''}
              onChange={(event) =>
                onChange({ url: event.target.value, assetId: null })
              }
              placeholder="https://example.com/lesson.mp4"
              aria-label="Video URL"
              inputMode="url"
              className="pl-9"
            />
          </div>
          <p className="text-caption text-muted-foreground">
            Must start with https://. Enter the duration below — it cannot be measured
            for a video we do not host.
          </p>
        </div>
      ) : (
        <>
          {/* --- 1 · EMPTY -------------------------------------------- */}
          {phase.kind === 'empty' ? (
            <div
              className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const file = event.dataTransfer.files[0];
                if (file) void start(file);
              }}
            >
              {existingLabel ? (
                <p className="text-small font-semibold text-foreground">{existingLabel}</p>
              ) : null}
              <Upload className="size-5 text-primary" aria-hidden="true" />
              <p className="text-small font-semibold text-foreground">
                Drop a video or choose a file
              </p>
              <p className="text-caption text-muted-foreground">MP4 or WebM · up to 2 GB</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
              >
                Choose a file
              </Button>
            </div>
          ) : null}

          {/* --- 2 · UPLOADING ---------------------------------------- */}
          {phase.kind === 'uploading' ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
              <p className="truncate text-small font-semibold text-foreground">
                {phase.name}
              </p>
              <p className="font-mono text-caption text-muted-foreground">
                {megabytes(phase.loaded)} of {megabytes(phase.total)} MB ·{' '}
                {phase.percentage}%
              </p>
              <Progress
                value={phase.percentage}
                label={`Uploading ${phase.name}`}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => handleRef.current?.cancel()}
              >
                <X aria-hidden="true" />
                Cancel
              </Button>
            </div>
          ) : null}

          {/* --- 3 · PROCESSING --------------------------------------- */}
          {phase.kind === 'processing' ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
              <span className="inline-flex w-fit items-center gap-2 rounded-pill bg-warning-tint px-2.5 py-0.5 text-caption font-semibold text-warning">
                <span
                  className="size-3 animate-spin rounded-full border-2 border-warning/30 border-t-warning"
                  aria-hidden="true"
                />
                Processing
              </span>
              <p className="text-small font-semibold text-foreground">
                Checking file type &amp; reading duration
              </p>
              <p className="text-caption text-muted-foreground">
                Usually under a minute. Safe to close this dialog.
              </p>
            </div>
          ) : null}

          {/* --- 4 · READY -------------------------------------------- */}
          {phase.kind === 'ready' ? (
            <div className="flex flex-col gap-2 rounded-lg border border-success/40 bg-success-tint/40 p-4">
              <span className="inline-flex w-fit items-center gap-1.5 rounded-pill bg-success-tint px-2.5 py-0.5 text-caption font-semibold text-success">
                <CheckCircle2 className="size-3.5" aria-hidden="true" />
                Ready
              </span>
              <p className="text-small font-semibold text-foreground">
                {phase.durationSeconds
                  ? `Duration detected: ${formatTimecode(phase.durationSeconds)}`
                  : 'Upload complete'}
              </p>
              <p className="font-mono text-caption text-muted-foreground">
                {megabytes(phase.sizeBytes)} MB · {phase.name}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => {
                  setPhase({ kind: 'empty' });
                  onChange({ assetId: null });
                }}
              >
                Replace
              </Button>
            </div>
          ) : null}

          {/* --- 5 · FAILED ------------------------------------------- */}
          {phase.kind === 'failed' ? (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-lg border border-destructive bg-destructive-tint/50 p-4"
            >
              <span className="inline-flex w-fit items-center gap-1.5 rounded-pill bg-destructive-tint px-2.5 py-0.5 text-caption font-semibold text-destructive">
                <AlertCircle className="size-3.5" aria-hidden="true" />
                Failed
              </span>
              <p className="text-small font-semibold text-destructive">{phase.reason}</p>
              <p className="text-caption text-muted-foreground">
                Nothing was saved; retrying continues from the start.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                >
                  Choose another
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    if (lastFile) void start(lastFile);
                  }}
                  disabled={!lastFile}
                >
                  Retry upload
                </Button>
              </div>
            </div>
          ) : null}

          <input
            ref={fileRef}
            type="file"
            accept="video/mp4,video/webm"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void start(file);
              // Reset so choosing the same file twice still fires.
              event.target.value = '';
            }}
          />
        </>
      )}
    </div>
  );
}
