import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Captions,
  CaptionsOff,
  Check,
  Gauge,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { formatTimecode, RESUME_MIN_POSITION_SECONDS } from '@cadence/shared';
import { toast } from 'sonner';
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
 * A native `<video>` with custom controls, on the design's one dark surface
 * ("Dark only for video. The player card is the single dark surface, so focus
 * lands there.").
 *
 * Behaviour that matters:
 *  - resume: on `loadedmetadata`, seek to the saved position when it is worth
 *    resuming from, and say so with an undo ("Start over")
 *  - progress: every `timeupdate` is reported to the tracker, which throttles
 *  - completion: `ended` calls `onEnded`; the component never decides that a
 *    lesson is complete, because only the server may
 *  - keyboard: Space/K, arrows, M, F, C — on the player container, not the
 *    document, so typing elsewhere is unaffected
 *  - every control has an `aria-label` and a tooltip
 */

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const SEEK_STEP_SECONDS = 5;
const VOLUME_STEP = 0.1;

export type LessonVideoPlayerProps = {
  videoUrl: string;
  captionsUrl?: string | null;
  title: string;
  /** Where to resume from, in seconds. 0 starts at the beginning. */
  resumeFromSeconds?: number;
  durationSeconds: number;
  isCompleted?: boolean;
  /** Called on every timeupdate; the tracker throttles the writes. */
  onPositionChange?: (positionSeconds: number) => void;
  /** Pause, seek — the moments worth an immediate save. */
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

  // Resume must happen once per lesson, not on every metadata event (which
  // fires again after a source change or a track toggle on some browsers).
  const hasResumedRef = useRef(false);
  useEffect(() => {
    hasResumedRef.current = false;
    setHasEnded(false);
    setPosition(0);
  }, [videoUrl]);

  const seekTo = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    const target = Math.max(0, Math.min(seconds, video.duration || durationSeconds));
    video.currentTime = target;
    setPosition(target);
  }, [durationSeconds]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => {
        // Autoplay restrictions, or a missing/blocked source. The error state
        // below covers an unplayable source; nothing useful to do here.
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

    // Only resume somewhere meaningful: a few seconds in is not worth a jump,
    // and a finished lesson should start from the top on a rewatch.
    const shouldResume =
      resumeFromSeconds > RESUME_MIN_POSITION_SECONDS &&
      !isCompleted &&
      resumeFromSeconds < (video.duration || durationSeconds) - 1;

    if (shouldResume) {
      video.currentTime = resumeFromSeconds;
      setPosition(resumeFromSeconds);
      toast(`Resumed from ${formatTimecode(resumeFromSeconds)}`, {
        action: {
          label: 'Start over',
          onClick: () => seekTo(0),
        },
      });
    }
  }, [durationSeconds, isCompleted, resumeFromSeconds, seekTo]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setPosition(video.currentTime);
    onPositionChange?.(video.currentTime);

    // Buffered ahead of the playhead, for the scrubber's second track.
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
        /* fullscreen can be blocked by permissions policy; ignore */
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

  /**
   * Keyboard shortcuts, scoped to the player. Ignored while focus is in a
   * text field so typing a note never scrubs the video.
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      // Let the slider handle its own arrow keys.
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
          seekTo(position + SEEK_STEP_SECONDS);
          onFlush?.('seeked');
          break;
        case 'ArrowLeft':
          event.preventDefault();
          seekTo(position - SEEK_STEP_SECONDS);
          onFlush?.('seeked');
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
      onFlush,
      position,
      seekTo,
      toggleCaptions,
      toggleFullscreen,
      toggleMute,
      togglePlay,
      volume,
    ],
  );

  const total = duration || durationSeconds;

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
            const video = videoRef.current;
            onEnded?.(video?.duration ?? total);
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
            <track kind="captions" src={captionsUrl} srcLang="en" label="English" default={false} />
          ) : null}
          Your browser does not support embedded video.
        </video>

        {/* The completion overlay from the design: a confirmation and a way on. */}
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

        {/* Controls */}
        <div className="flex flex-col gap-2 bg-night px-4 pb-4 pt-2">
          <Slider
            tone="night"
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

          <div className="flex flex-wrap items-center gap-1.5">
            <IconTooltip label={isPlaying ? 'Pause (K)' : 'Play (K)'}>
              <Button
                variant="ghost"
                size="icon"
                onClick={togglePlay}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="text-night-foreground hover:bg-white/15 hover:text-night-foreground"
              >
                {isPlaying ? <Pause /> : <Play />}
              </Button>
            </IconTooltip>

            <span className="ml-1 font-mono text-timecode tabular text-night-foreground">
              {formatTimecode(position)}
              <span className="text-night-muted"> / {formatTimecode(total)}</span>
            </span>

            <div className="ml-auto flex items-center gap-1.5">
              <div className="flex items-center gap-1">
                <IconTooltip label={isMuted ? 'Unmute (M)' : 'Mute (M)'}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={toggleMute}
                    aria-label={isMuted ? 'Unmute' : 'Mute'}
                    className="text-night-foreground hover:bg-white/15 hover:text-night-foreground"
                  >
                    {isMuted || volume === 0 ? <VolumeX /> : <Volume2 />}
                  </Button>
                </IconTooltip>
                <Slider
                  tone="night"
                  className="hidden w-24 sm:flex"
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

              <DropdownMenu>
                <IconTooltip label="Playback speed">
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Playback speed, currently ${rate} times`}
                      className="gap-1 px-2 text-night-foreground hover:bg-white/15 hover:text-night-foreground"
                    >
                      <Gauge />
                      <span className="font-mono text-caption">{rate}x</span>
                    </Button>
                  </DropdownMenuTrigger>
                </IconTooltip>
                <DropdownMenuContent align="end">
                  {PLAYBACK_RATES.map((option) => (
                    <DropdownMenuItem
                      key={option}
                      onClick={() => changeRate(option)}
                      aria-current={option === rate}
                    >
                      {option === rate ? <Check /> : <span className="size-4" />}
                      {option}x{option === 1 ? ' (normal)' : ''}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {captionsUrl ? (
                <IconTooltip label={captionsOn ? 'Hide captions (C)' : 'Show captions (C)'}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={toggleCaptions}
                    aria-label={captionsOn ? 'Hide captions' : 'Show captions'}
                    aria-pressed={captionsOn}
                    className="text-night-foreground hover:bg-white/15 hover:text-night-foreground"
                  >
                    {captionsOn ? <Captions /> : <CaptionsOff />}
                  </Button>
                </IconTooltip>
              ) : null}

              <IconTooltip label={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={toggleFullscreen}
                  aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                  className="text-night-foreground hover:bg-white/15 hover:text-night-foreground"
                >
                  {isFullscreen ? <Minimize /> : <Maximize />}
                </Button>
              </IconTooltip>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
