import { formatDuration, type AudioAttachment } from '@pingo/core';
import { PauseIcon, PlayIcon, cn } from '@pingo/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Voice note player — receiver must hear audio, always.
 *
 * Failure modes we kill here:
 * 1. Empty signed URL at list time → re-sign via storagePath on play
 * 2. Expired signed URL → re-sign on play error
 * 3. CORS / range quirks on signed CDN URL → fetch → blob: URL
 * 4. HTMLAudioElement refuses file → Web Audio API decode + play
 * 5. Silent "timer" demo path for real notes → never; only fixtures without path
 */

export interface VoiceNoteProps {
  attachment: AudioAttachment;
  tone?: 'incoming' | 'outgoing';
  className?: string;
  /** Mint a fresh signed URL for `attachment.storagePath`. */
  resolveUrl?: (storagePath: string) => Promise<string | undefined>;
}

const TICK_MS = 40;

/**
 * Every mounted player, so starting one can stop the rest.
 *
 * `document.querySelectorAll('audio')` only reaches notes playing through an
 * element. A note that fell back to Web Audio — which is exactly what happens
 * on the browsers where playback is hardest — has no element to pause, so it
 * carried on underneath the next one and two people talked at once. A registry
 * covers both paths, and it is module-level because the players are siblings in
 * a list with no shared parent to hold this.
 */
const mountedPlayers = new Set<() => void>();

const FALLBACK_WAVEFORM = Array.from({ length: 32 }, (_, i) =>
  0.25 + 0.35 * Math.abs(Math.sin(i * 0.55)),
);

export function VoiceNote({
  attachment,
  tone = 'incoming',
  className,
  resolveUrl,
}: VoiceNoteProps) {
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(false);
  const outgoing = tone === 'outgoing';

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const webAudioRef = useRef<{
    context: AudioContext;
    source: AudioBufferSourceNode;
    startedAt: number;
    offset: number;
  } | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const [playSrc, setPlaySrc] = useState('');
  const [duration, setDuration] = useState(attachment.duration || 0);

  const elapsedRef = useRef(0);
  elapsedRef.current = elapsed;

  const storagePath = attachment.storagePath?.trim() || '';
  const initialUrl = attachment.url?.trim() || '';
  const isFixture = !storagePath && !initialUrl;

  const waveform =
    attachment.waveform && attachment.waveform.length > 0
      ? attachment.waveform
      : FALLBACK_WAVEFORM;

  const revokeObjectUrl = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  const stopWebAudio = useCallback(() => {
    const wa = webAudioRef.current;
    if (!wa) return;
    try {
      wa.source.stop();
    } catch {
      // already stopped
    }
    void wa.context.close().catch(() => undefined);
    webAudioRef.current = null;
  }, []);

  /**
   * Stop this one, whichever way it happens to be playing.
   *
   * Held in a ref so the registry entry is stable for the life of the
   * component — a new function each render would leave stale stoppers behind
   * and stop nothing.
   */
  const stopSelfRef = useRef<() => void>(() => undefined);
  stopSelfRef.current = () => {
    audioRef.current?.pause();
    stopWebAudio();
    setPlaying(false);
  };

  /** The exact function in the registry, so "everyone but me" can mean it. */
  const registeredRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const stop = () => stopSelfRef.current();
    registeredRef.current = stop;
    mountedPlayers.add(stop);
    return () => {
      mountedPlayers.delete(stop);
    };
  }, []);

  /** Load bytes from a remote URL into a typed blob + object URL. */
  const materialize = useCallback(async (remote: string): Promise<string> => {
    const response = await fetch(remote);
    if (!response.ok) throw new Error(`voice fetch ${response.status}`);
    const raw = await response.blob();
    const mime =
      raw.type && raw.type !== 'application/octet-stream'
        ? raw.type
        : guessMimeFromUrl(remote);
    const typed = raw.type === mime ? raw : new Blob([raw], { type: mime });
    blobRef.current = typed;
    revokeObjectUrl();
    const objectUrl = URL.createObjectURL(typed);
    objectUrlRef.current = objectUrl;
    return objectUrl;
  }, []);

  /** Resolve a playable src: attachment url → re-sign → blob. */
  const ensurePlayableSrc = useCallback(async (): Promise<string> => {
    if (playSrc && !loadError) return playSrc;

    setLoading(true);
    setLoadError(false);
    try {
      let remote = initialUrl;

      // Prefer a fresh signature when we can — expired URLs are a common silent fail.
      if (storagePath && resolveUrl) {
        const fresh = await resolveUrl(storagePath);
        if (fresh) remote = fresh;
      }

      if (!remote) {
        throw new Error('no voice url');
      }

      try {
        const src = await materialize(remote);
        setPlaySrc(src);
        return src;
      } catch {
        // Direct stream as last resort (some environments block fetch CORS).
        setPlaySrc(remote);
        return remote;
      }
    } catch {
      setLoadError(true);
      throw new Error('voice unavailable');
    } finally {
      setLoading(false);
    }
  }, [playSrc, loadError, initialUrl, storagePath, resolveUrl, materialize]);

  /*
   * Reset when the note this component is showing changes.
   *
   * This used to prefetch as well — mint a signed URL and download the audio —
   * "so the first tap is snappy". Every voice note in the thread does that on
   * mount, so opening a conversation with twenty of them fired twenty signature
   * requests and downloaded twenty files nobody had asked to hear, on whatever
   * connection the phone happened to be on, and held twenty blobs in memory.
   *
   * `ensurePlayableSrc` already does the whole job on tap, including re-signing
   * and falling back. The cost of removing the prefetch is a moment on the
   * first tap of a note; the saving is every byte of every note never played.
   */
  useEffect(() => {
    setLoadError(false);
    setElapsed(0);
    setPlaying(false);
    stopWebAudio();
    blobRef.current = null;
    revokeObjectUrl();
    setPlaySrc('');

    return () => {
      stopWebAudio();
      revokeObjectUrl();
    };
    // Only re-run when the note identity / path changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment.id, storagePath, initialUrl]);

  // Fixture timer (styleguide only).
  useEffect(() => {
    if (!playing || !isFixture) return;
    const id = setInterval(() => {
      const next = elapsedRef.current + TICK_MS / 1000;
      if (next >= duration) {
        setElapsed(0);
        setPlaying(false);
      } else {
        setElapsed(next);
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, isFixture, duration]);

  // Progress while Web Audio plays.
  useEffect(() => {
    if (!playing || !webAudioRef.current) return;
    const id = setInterval(() => {
      const wa = webAudioRef.current;
      if (!wa) return;
      const t = wa.offset + (wa.context.currentTime - wa.startedAt);
      if (t >= duration && duration > 0) {
        setElapsed(0);
        setPlaying(false);
        stopWebAudio();
      } else {
        setElapsed(t);
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, duration, stopWebAudio]);

  const stopOthers = () => {
    for (const stop of mountedPlayers) {
      if (stop !== registeredRef.current) stop();
    }
  };

  const playViaWebAudio = async (from = 0): Promise<boolean> => {
    const blob = blobRef.current;
    if (!blob) return false;
    try {
      stopWebAudio();
      const context = new AudioContext();
      if (context.state === 'suspended') await context.resume();
      const copy = await blob.arrayBuffer();
      const buffer = await context.decodeAudioData(copy.slice(0));
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const offset = Math.max(0, Math.min(from, buffer.duration - 0.01));
      source.start(0, offset);
      source.onended = () => {
        setPlaying(false);
        setElapsed(0);
        stopWebAudio();
      };
      webAudioRef.current = {
        context,
        source,
        startedAt: context.currentTime,
        offset,
      };
      if (Number.isFinite(buffer.duration) && buffer.duration > 0) {
        setDuration(buffer.duration);
      }
      setPlaying(true);
      return true;
    } catch {
      stopWebAudio();
      return false;
    }
  };

  const toggle = async () => {
    if (isFixture) {
      setPlaying((p) => !p);
      return;
    }

    // Pause paths
    if (playing) {
      audioRef.current?.pause();
      stopWebAudio();
      setPlaying(false);
      return;
    }

    stopOthers();
    setLoadError(false);

    try {
      const src = await ensurePlayableSrc();
      const audio = audioRef.current;

      // Prefer element when we have a src bound.
      if (audio && src) {
        if (audio.src !== src && !src.startsWith('blob:')) {
          audio.src = src;
        }
        // When src is blob we already set via state → re-render may lag one tick.
        if (!audio.src || audio.src === window.location.href) {
          audio.src = src;
        }
        audio.volume = 1;
        audio.muted = false;
        try {
          await audio.play();
          setPlaying(true);
          return;
        } catch {
          // Fall through to Web Audio.
        }
      }

      const ok = await playViaWebAudio(elapsed);
      if (!ok) {
        // One more re-sign attempt then Web Audio.
        if (storagePath && resolveUrl) {
          const fresh = await resolveUrl(storagePath);
          if (fresh) {
            try {
              const src2 = await materialize(fresh);
              setPlaySrc(src2);
              if (audioRef.current) {
                audioRef.current.src = src2;
                audioRef.current.volume = 1;
                audioRef.current.muted = false;
                await audioRef.current.play();
                setPlaying(true);
                return;
              }
            } catch {
              // continue
            }
            if (await playViaWebAudio(elapsed)) return;
          }
        }
        setLoadError(true);
        setPlaying(false);
      }
    } catch {
      setLoadError(true);
      setPlaying(false);
    }
  };

  const progress = duration > 0 ? elapsed / duration : 0;

  const seekTo = (ratio: number) => {
    const at = Math.max(0, Math.min(1, ratio)) * duration;
    setElapsed(at);
    if (audioRef.current && Number.isFinite(at)) {
      try {
        audioRef.current.currentTime = at;
      } catch {
        // ignore
      }
    }
    if (playing && webAudioRef.current) {
      void playViaWebAudio(at);
    }
  };

  const hasAudio = Boolean(playSrc) || Boolean(storagePath) || Boolean(initialUrl);

  return (
    <div className={cn('flex items-center gap-3', className)}>
      {/* Keep element mounted so play() can attach without a second click. */}
      <audio
        ref={audioRef}
        src={playSrc || undefined}
        preload="auto"
        playsInline
        onPlay={() => setPlaying(true)}
        onPause={() => {
          if (!webAudioRef.current) setPlaying(false);
        }}
        onTimeUpdate={(event) => {
          if (!webAudioRef.current) setElapsed(event.currentTarget.currentTime);
        }}
        onLoadedMetadata={(event) => {
          const real = event.currentTarget.duration;
          if (Number.isFinite(real) && real > 0) setDuration(real);
          event.currentTarget.volume = 1;
          event.currentTarget.muted = false;
        }}
        onError={() => {
          // Do not hard-fail — toggle will try Web Audio / re-sign.
        }}
        onEnded={() => {
          if (!webAudioRef.current) {
            setPlaying(false);
            setElapsed(0);
            if (audioRef.current) audioRef.current.currentTime = 0;
          }
        }}
      />
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={loading}
        aria-label={
          loadError
            ? 'Voice message unavailable'
            : playing
              ? 'Pause voice message'
              : 'Play voice message'
        }
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-full',
          'focus-ring transition-all duration-instant ease-standard active:scale-[0.94]',
          'disabled:opacity-50',
          outgoing
            ? 'bg-white/20 text-white hover:bg-white/30'
            : 'bg-brand-gradient text-on-brand shadow-brand hover:shadow-lg',
        )}
      >
        {playing ? (
          <PauseIcon size={16} />
        ) : (
          <PlayIcon size={16} className="translate-x-px" />
        )}
      </button>

      <div
        role="slider"
        tabIndex={0}
        aria-label="Seek voice message"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(elapsed)}
        aria-valuetext={
          loadError
            ? 'Unavailable'
            : `${formatDuration(elapsed)} of ${formatDuration(duration)}`
        }
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          seekTo((event.clientX - bounds.left) / bounds.width);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') seekTo((elapsed + 1) / duration);
          if (event.key === 'ArrowLeft') seekTo((elapsed - 1) / duration);
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            void toggle();
          }
        }}
        className="focus-ring flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-[2px] rounded-sm"
      >
        {waveform.map((amplitude, index) => {
          const played = index / waveform.length <= progress;
          return (
            <span
              key={index}
              className={cn(
                'min-w-[2px] max-w-[3px] flex-1 rounded-full',
                'transition-colors duration-instant ease-standard',
                outgoing
                  ? played
                    ? 'bg-white'
                    : 'bg-white/35'
                  : played
                    ? 'bg-brand'
                    : 'bg-line-strong',
              )}
              style={{ height: `${Math.max(3, amplitude * 26)}px` }}
            />
          );
        })}
      </div>

      <span
        className={cn(
          'shrink-0 text-caption tabular-nums',
          outgoing ? 'text-white/80' : 'text-text-secondary',
        )}
      >
        {loadError
          ? '—'
          : loading
            ? '…'
            : formatDuration(playing || elapsed > 0 ? elapsed : duration)}
      </span>
      {/* Silence dead-code warning for hasAudio in future a11y. */}
      <span className="sr-only">{hasAudio ? 'has audio' : 'no audio'}</span>
    </div>
  );
}

function guessMimeFromUrl(url: string): string {
  const path = url.split('?')[0]?.toLowerCase() ?? '';
  if (path.endsWith('.wav')) return 'audio/wav';
  if (path.endsWith('.mp3')) return 'audio/mpeg';
  if (path.endsWith('.m4a') || path.endsWith('.mp4')) return 'audio/mp4';
  if (path.endsWith('.ogg')) return 'audio/ogg';
  return 'audio/wav';
}
