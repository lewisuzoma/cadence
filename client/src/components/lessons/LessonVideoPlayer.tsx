import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Captions,
  CaptionsOff,
  Check,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { formatTimecode, RESUME_MIN_POSITION_SECONDS } from '@cadence/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Slider } from '@/components/ui/slider';
import { IconTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * The lesson player.
 *
 * A native `<video>` with custom controls on the design's one dark surface
 * ("Dark only for video. The player card is the single dark surface, so focus
 * lands there.").
 *
 * Details taken from the artifact rather than invented:
 *  - the scrubber is **amber** with an amber thumb on a dark track; cobalt
 *    would disappear against Night, which is why the design moves to amber
 *  - resume is announced by a chip pinned to the top-left of the video —
 *    "Resumed from 08:42 · Start over" — not by a toast that floats away
 *  - the control row is: play · back 10 · forward 10 · restart · `08:42 /
 *    14:20`, then speed in a bordered box, captions, volume, fullscreen
 *  - mobile adds a compact row beneath the scrubber showing elapsed, the
 *    speed box and the **remaining** time as `-05:38`
 *
 * Behaviour: `onEnded` asks the server to complete; this component never
 * decides that a lesson is finished.
 */

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const SKIP_SECONDS = 10;
const SEEK_STEP_SECONDS = 5;
const VOLUME_STEP = 0.1;

export type LessonVideoPlayerProps = {
  videoUrl: string;
  captionsUrl?: string | null;
  title: string;
  resumeFromSeconds?: number;
  durationSeconds: number;
  isCompleted?: boolean;
  onPositionChange?: (positionSeconds: number) => void;
  onFlush?: (reason: 'pause' | 'seeked') => void;
  onEnded?: (positionSeconds: number) => void;
  onNext?: () => void;
  hasNext?: boolean;
  className?: string;
};

export function LessonVideoPlayer({
  videoUrl,
  captionsUrl,
  title,
  resumeFromSeconds = 0,
  durationSeconds,
  isCompleted = false,
  onPositionChange,
  onFlush,
  onEnded,
  onNext,
  hasNext = false,
  className,
}: LessonVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(durationSeconds);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [rate, setRate] = useState<number>(1);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasEnded, setHasEnded] = useState(false);
  /** Drives the "Resumed from …" chip. */
  const [resumedFrom, setResumedFrom] = useState<number | null>(null);

  const hasResumedRef = useRef(false);
  useEffect(() => {
    hasResumedRef.current = false;
    setHasEnded(false);
    setPosition(0);
    setResumedFrom(null);
  }, [videoUrl]);

  const seekTo = useCallback(
    (seconds: number) => {
      const video = videoRef.current;
      if (!video) return;
      const target = Math.max(0, Math.min(seconds, video.duration || durationSeconds));
      video.currentTime = target;
      setPosition(target);
    },
    [durationSeconds],
  );

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => {
        // Autoplay restrictions, or an unplayable source: nothing useful to
        // do here, and the controls stay in their paused state.
      });
    } else {
      video.pause();
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(Number.isFinite(video.duration) ? video.duration : durationSeconds);

    if (hasResumedRef.current) return;
    hasResumedRef.current = true;

    const shouldResume =
      resumeFromSeconds > RESUME_MIN_POSITION_SECONDS &&
      !isCompleted &&
      resumeFromSeconds < (video.duration || durationSeconds) - 1;

    if (shouldResume) {
      video.currentTime = resumeFromSeconds;
      setPosition(resumeFromSeconds);
      setResumedFrom(resumeFromSeconds);
    }
  }, [durationSeconds, isCompleted, resumeFromSeconds]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setPosition(video.currentTime);
    onPositionChange?.(video.currentTime);

    if (video.buffered.length > 0) {
      const end = video.buffered.end(video.buffered.length - 1);
      const total = video.duration || durationSeconds;
      setBuffered(total > 0 ? (end / total) * 100 : 0);
    }
  }, [durationSeconds, onPositionChange]);

  const changeVolume = useCallback((next: number) => {
    const video = videoRef.current;
    if (!video) return;
    const clamped = Math.max(0, Math.min(1, next));
    video.volume = clamped;
    video.muted = clamped === 0;
    setVolume(clamped);
    setIsMuted(clamped === 0);
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const next = !video.muted;
    video.muted = next;
    setIsMuted(next);
  }, []);

  const toggleCaptions = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.textTracks.length === 0) return;
    const track = video.textTracks[0]!;
    const next = track.mode !== 'showing';
    track.mode = next ? 'showing' : 'disabled';
    setCaptionsOn(next);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void container.requestFullscreen?.().catch(() => {
        /* fullscreen can be blocked by permissions policy */
      });
    }
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const changeRate = useCallback((next: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = next;
    setRate(next);
  }, []);

  const skip = useCallback(
    (seconds: number) => {
      seekTo(position + seconds);
      onFlush?.('seeked');
    },
    [onFlush, position, seekTo],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (target.getAttribute('role') === 'slider' && event.key.startsWith('Arrow')) return;

      switch (event.key) {
        case ' ':
        case 'k':
        case 'K':
          event.preventDefault();
          togglePlay();
          break;
        case 'ArrowRight':
          event.preventDefault();
          skip(SEEK_STEP_SECONDS);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          skip(-SEEK_STEP_SECONDS);
          break;
        case 'ArrowUp':
          event.preventDefault();
          changeVolume(volume + VOLUME_STEP);
          break;
        case 'ArrowDown':
          event.preventDefault();
          changeVolume(volume - VOLUME_STEP);
          break;
        case 'm':
        case 'M':
          event.preventDefault();
          toggleMute();
          break;
        case 'f':
        case 'F':
          event.preventDefault();
          toggleFullscreen();
          break;
        case 'c':
        case 'C':
          if (captionsUrl) {
            event.preventDefault();
            toggleCaptions();
          }
          break;
        default:
          break;
      }
    },
    [
      captionsUrl,
      changeVolume,
      skip,
      toggleCaptions,
      toggleFullscreen,
      toggleMute,
      togglePlay,
      volume,
    ],
  );

  const total = duration || durationSeconds;
  const remaining = Math.max(0, Math.round(total - position));

  const controlButton =
    'text-night-foreground hover:bg-white/15 hover:text-night-foreground';

  return (
    <Card variant="night" className={cn('overflow-hidden', className)}>
      <div
        ref={containerRef}
        className="group relative bg-night focus-visible:outline-none"
        onKeyDown={handleKeyDown}
        tabIndex={-1}
        role="region"
        aria-label={`Video player: ${title}`}
      >
        <div className="relative">
          <video
            ref={videoRef}
            src={videoUrl}
            className="aspect-video w-full bg-night"
            preload="metadata"
            playsInline
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onPlay={() => {
              setIsPlaying(true);
              setHasEnded(false);
            }}
            onPause={() => {
              setIsPlaying(false);
              onFlush?.('pause');
            }}
            onSeeked={() => onFlush?.('seeked')}
            onEnded={() => {
              setIsPlaying(false);
              setHasEnded(true);
              onEnded?.(videoRef.current?.duration ?? total);
            }}
            onVolumeChange={() => {
              const video = videoRef.current;
              if (video) {
                setVolume(video.volume);
                setIsMuted(video.muted);
              }
            }}
          >
            {captionsUrl ? (
              <track kind="captions" src={captionsUrl} srcLang="en" label="English" />
            ) : null}
            Your browser does not support embedded video.
          </video>

          {/*
            The resume chip from the artifact, pinned over the video. It stays
            until dismissed or until the learner starts over, so the undo does
            not time out the way a toast would.
          */}
          {resumedFrom !== null && !hasEnded ? (
            <div
              className="absolute left-4 top-4 flex items-center gap-2 rounded-md bg-card/95 py-1.5 pl-3 pr-1.5 shadow-overlay backdrop-blur"
              role="status"
            >
              <span className="text-caption text-secondary-foreground">Resumed from</span>
              <span className="font-mono text-caption font-semibold tabular">
                {formatTimecode(resumedFrom)}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-caption"
                onClick={() => {
                  seekTo(0);
                  setResumedFrom(null);
                }}
              >
                Start over
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                className="size-7"
                aria-label="Dismiss resume notice"
                onClick={() => setResumedFrom(null)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ) : null}

          {/* Completion overlay: a confirmation and a way onward. */}
          {hasEnded ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-night/85 text-night-foreground">
              <span className="flex size-14 items-center justify-center rounded-pill bg-success">
                <Check className="size-7" aria-hidden="true" strokeWidth={3} />
              </span>
              <p className="font-heading text-heading-sm">Lesson complete</p>
              <div className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  onClick={() => {
                    seekTo(0);
                    togglePlay();
                  }}
                >
                  <RotateCcw aria-hidden="true" />
                  Replay
                </Button>
                {hasNext && onNext ? <Button onClick={onNext}>Next lesson</Button> : null}
              </div>
            </div>
          ) : null}
        </div>

        {/* Scrubber — amber on a dark track, as the artifact specifies. */}
        <div className="px-4 pt-3">
          <Slider
            tone="video"
            value={[Math.min(position, total)]}
            max={total || 1}
            step={1}
            buffered={buffered}
            aria-label="Seek"
            aria-valuetext={`${formatTimecode(position)} of ${formatTimecode(total)}`}
            onValueChange={([next]) => {
              if (next !== undefined) seekTo(next);
            }}
            onValueCommit={() => onFlush?.('seeked')}
          />
        </div>

        {/* Compact row for phone width: elapsed · speed · remaining. */}
        <div className="flex items-center justify-between gap-3 px-4 pb-3 sm:hidden">
          <span className="font-mono text-timecode tabular text-night-foreground">
            {formatTimecode(position)}
          </span>
          <SpeedMenu rate={rate} onChange={changeRate} />
          <span className="font-mono text-timecode tabular text-night-muted">
            -{formatTimecode(remaining)}
          </span>
        </div>

        {/* Full control row from tablet width up. */}
        <div className="hidden flex-wrap items-center gap-1.5 px-4 pb-4 sm:flex">
          <IconTooltip label={isPlaying ? 'Pause (K)' : 'Play (K)'}>
            <Button
              variant="ghost"
              size="icon"
              onClick={togglePlay}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className={controlButton}
            >
              {isPlaying ? <Pause /> : <Play />}
            </Button>
          </IconTooltip>

          <IconTooltip label={`Back ${SKIP_SECONDS} seconds`}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => skip(-SKIP_SECONDS)}
              aria-label={`Rewind ${SKIP_SECONDS} seconds`}
              className={controlButton}
            >
              <RotateCcw />
            </Button>
          </IconTooltip>

          <IconTooltip label={`Forward ${SKIP_SECONDS} seconds`}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => skip(SKIP_SECONDS)}
              aria-label={`Forward ${SKIP_SECONDS} seconds`}
              className={controlButton}
            >
              <RotateCw />
            </Button>
          </IconTooltip>

          <span className="ml-2 font-mono text-timecode tabular text-night-foreground">
            {formatTimecode(position)}
            <span className="text-night-muted"> / {formatTimecode(total)}</span>
          </span>

          <div className="ml-auto flex items-center gap-1.5">
            <SpeedMenu rate={rate} onChange={changeRate} />

            {captionsUrl ? (
              <IconTooltip label={captionsOn ? 'Hide captions (C)' : 'Show captions (C)'}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={toggleCaptions}
                  aria-label={captionsOn ? 'Hide captions' : 'Show captions'}
                  aria-pressed={captionsOn}
                  className={controlButton}
                >
                  {captionsOn ? <Captions /> : <CaptionsOff />}
                </Button>
              </IconTooltip>
            ) : null}

            <div className="flex items-center gap-1">
              <IconTooltip label={isMuted ? 'Unmute (M)' : 'Mute (M)'}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={toggleMute}
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                  className={controlButton}
                >
                  {isMuted || volume === 0 ? <VolumeX /> : <Volume2 />}
                </Button>
              </IconTooltip>
              <Slider
                tone="video"
                className="hidden w-24 lg:flex"
                value={[isMuted ? 0 : volume * 100]}
                max={100}
                step={5}
                aria-label="Volume"
                aria-valuetext={`${Math.round((isMuted ? 0 : volume) * 100)} percent`}
                onValueChange={([next]) => {
                  if (next !== undefined) changeVolume(next / 100);
                }}
              />
            </div>

            <IconTooltip label={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                className={controlButton}
              >
                {isFullscreen ? <Minimize /> : <Maximize />}
              </Button>
            </IconTooltip>
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Playback speed in a bordered box, the way the artifact draws it. */
function SpeedMenu({ rate, onChange }: { rate: number; onChange: (rate: number) => void }) {
  return (
    <DropdownMenu>
      <IconTooltip label="Playback speed">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Playback speed, currently ${rate} times`}
            className="flex h-8 min-w-11 items-center justify-center rounded-sm border border-white/30 px-2 font-mono text-caption text-night-foreground transition-colors hover:bg-white/15"
          >
            {rate}×
          </button>
        </DropdownMenuTrigger>
      </IconTooltip>
      <DropdownMenuContent align="end">
        {PLAYBACK_RATES.map((option) => (
          <DropdownMenuItem
            key={option}
            onClick={() => onChange(option)}
            aria-current={option === rate}
          >
            {option === rate ? <Check /> : <span className="size-4" />}
            {option}×{option === 1 ? ' (normal)' : ''}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
