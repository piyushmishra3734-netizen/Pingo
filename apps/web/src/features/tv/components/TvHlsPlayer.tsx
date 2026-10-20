import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Hls from 'hls.js';
import { Check, Settings2 } from 'lucide-react';

import { cn } from '@pingo/ui';
import type { StreamEntry, SubtitleOption } from '../sourceProbe.js';

interface TvHlsPlayerProps {
  /** A direct `.m3u8` playlist. No iframe, so no page, no pop-ups. */
  src: string;
  title: string;
  poster?: string;
  /** Called once when the stream fails in a way it will not recover from. */
  onFail?: () => void;
  /**
   * Called the first time the picture is actually moving.
   *
   * The player uses it to stop shopping for a better source: switching after
   * playback has started restarts the film from the beginning, which is the
   * "it loads, then starts over" loop.
   */
  onPlaying?: () => void;
  /** Subtitle files the provider offered, one per language. */
  subtitles?: SubtitleOption[];
  /** The other streams this provider has for the same film, and which one is on. */
  entries?: StreamEntry[];
  entryIndex?: number;
  onEntryChange?: (index: number) => void;
  /** Hindi picks the Hindi audio track when the stream carries one. */
  preferAudio?: 'hi' | 'en' | 'any';
  /** Where the audio, subtitle and quality button goes. Without one there is no menu (the mini player). */
  slot?: HTMLElement | null;
}

interface Choice {
  id: number;
  label: string;
}

/**
 * A plain `<video>`, with hls.js only where the browser needs it.
 *
 * This exists because the other sources are iframes: we hand a third party's
 * page the whole rectangle and hope. A resolver gives a playlist URL instead,
 * which means the page that served it — with its pop-unders, redirects and
 * scripts — is never loaded at all. That is the whole reason this player is
 * worth having.
 *
 * Safari plays HLS natively and gets the `src` directly. Everything else goes
 * through hls.js.
 */
export function TvHlsPlayer({
  src,
  title,
  poster,
  onFail,
  onPlaying,
  subtitles = [],
  entries = [],
  entryIndex = 0,
  onEntryChange,
  preferAudio,
  slot,
}: TvHlsPlayerProps) {
  const hlsRef = useRef<Hls | null>(null);
  const preferRef = useRef(preferAudio);
  const [audioTracks, setAudioTracks] = useState<Choice[]>([]);
  const [audioId, setAudioId] = useState(0);
  const [levels, setLevels] = useState<Choice[]>([]);
  /** -1 is "Best": the H.264 level the player pinned on its own. */
  const [levelId, setLevelId] = useState(-1);
  const [subLabel, setSubLabel] = useState<string | null>(null);
  const [subSrc, setSubSrc] = useState<string | null>(null);
  const [subBusy, setSubBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const failRef = useRef(onFail);
  const playingRef = useRef(onPlaying);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    failRef.current = onFail;
    playingRef.current = onPlaying;
    preferRef.current = preferAudio;
  }, [onFail, onPlaying, preferAudio]);

  // A new stream starts from its own defaults, whatever the last one was set to.
  useEffect(() => {
    setAudioTracks([]);
    setLevels([]);
    setLevelId(-1);
    setAudioId(0);
  }, [src]);

  // Subtitle files are fetched as text and played from a local blob, so the
  // track needs no CORS header on the video element (which would break hosts
  // that send none for the video itself).
  useEffect(() => {
    if (!subLabel) {
      setSubSrc(null);
      return;
    }
    const chosen = subtitles.find((s) => s.label === subLabel);
    if (!chosen) {
      setSubSrc(null);
      return;
    }
    let live = true;
    let blobUrl: string | undefined;
    setSubBusy(true);
    void fetch(chosen.url)
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error('subtitle'))))
      .then((text) => {
        if (!live) return;
        blobUrl = URL.createObjectURL(new Blob([text], { type: 'text/vtt' }));
        setSubSrc(blobUrl);
      })
      .catch(() => {
        if (live) setSubLabel(null);
      })
      .finally(() => live && setSubBusy(false));
    return () => {
      live = false;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [subLabel, subtitles]);

  // Show the track as soon as the element exists.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const apply = () => {
      for (const track of Array.from(video.textTracks)) track.mode = subSrc ? 'showing' : 'disabled';
    };
    const timer = window.setTimeout(apply, 50);
    return () => window.clearTimeout(timer);
  }, [subSrc]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let announced = false;
    const announce = () => {
      if (announced) return;
      announced = true;
      playingRef.current?.();
    };

    video.addEventListener('playing', announce);
    return () => video.removeEventListener('playing', announce);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    setError(null);

    /*
     * Start it, and start it muted.
     *
     * Browsers refuse an unmuted `play()` without a user gesture and do it
     * silently — the manifest parses, the duration appears in the timeline, the
     * element stays paused at 0:00, which is exactly the "it shows the length
     * but the film never plays" report. A muted `play()` is always allowed, so
     * it starts muted and the first tap unmutes it.
     */
    const startPlayback = () => {
      if (!video.paused) return;
      const attempt = video.play();
      if (!attempt) return;
      void attempt.catch(() => {
        // No gesture yet and the policy refused even muted: the controls are
        // there, and a tap will unmute and go.
        video.muted = true;
        void video.play().catch(() => undefined);
      });
    };

    const onCanPlay = () => startPlayback();
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('loadeddata', onCanPlay);

    const unmute = () => {
      video.muted = false;
    };
    video.addEventListener('pointerdown', unmute, { once: true });
    video.addEventListener('keydown', unmute, { once: true });

    /*
     * hls.js first, and this order matters more than it looks.
     *
     * `canPlayType('application/vnd.apple.mpegurl')` answers "maybe" in Chrome
     * on Windows — a famously useless answer — so the previous order handed the
     * playlist to the native player, which has no HLS support on this platform.
     * The element then reported MEDIA_ERR_SRC_NOT_SUPPORTED (code 4) and every
     * resolver source looked broken while the API was answering perfectly.
     *
     * Native playback is now only for browsers without MediaSource — Safari —
     * which is who it was ever meant for.
     */
    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hlsRef.current = hls;

      const readAudio = () => {
        const tracks = (hls.audioTracks ?? []).map((track, index) => ({ id: index, label: track.name || track.lang || `Track ${index + 1}` }));
        setAudioTracks(tracks);
        const wantsHindi = preferRef.current === 'hi';
        const hindi = tracks.find((track) => /hindi|\bhin\b/i.test(track.label));
        if (wantsHindi && hindi && hls.audioTrack !== hindi.id) hls.audioTrack = hindi.id;
        setAudioId(hls.audioTrack);
      };
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, readAudio);
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, () => setAudioId(hls.audioTrack));

      /*
       * Some of these servers publish the same film twice: a 4K variant in HEVC
       * and lower ones in H.264. Chrome on Windows has no HEVC decoder, and
       * hls.js's adaptive picker will happily choose the HEVC variant on
       * bandwidth, so the level is pinned to the best H.264 variant instead.
       */
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const levels = hls.levels ?? [];
        if (levels.length) {
          const isH264 = (level: (typeof levels)[number]) =>
            /avc1/i.test(level.codecSet ?? level.videoCodec ?? '');

          const playable = levels
            .map((level, index) => ({ level, index }))
            .filter(({ level }) => isH264(level))
            .sort((a, b) => b.level.bitrate - a.level.bitrate);

          if (!playable.length) {
            setError('This source streams a format this browser cannot decode.');
            failRef.current?.();
            return;
          }

          hls.currentLevel = playable[0]!.index;

          // One entry per height, the sharpest of each, so the menu is a short list.
          const byHeight = new Map<number, { index: number; bitrate: number }>();
          for (const { level, index } of playable) {
            const known = byHeight.get(level.height);
            if (!known || level.bitrate > known.bitrate) byHeight.set(level.height, { index, bitrate: level.bitrate });
          }
          setLevels(
            [...byHeight.entries()]
              .sort((a, b) => b[0] - a[0])
              .map(([height, { index }]) => ({ id: index, label: height ? `${height}p` : `Level ${index + 1}` })),
          );
        }

        startPlayback();
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        const message =
          data.type === Hls.ErrorTypes.NETWORK_ERROR
            ? 'This source did not load.'
            : 'This source stopped playing.';
        setError(message);
        failRef.current?.();
      });

      hls.loadSource(src);
      hls.attachMedia(video);

      return () => {
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('loadeddata', onCanPlay);
        video.removeEventListener('pointerdown', unmute);
        video.removeEventListener('keydown', unmute);
        hlsRef.current = null;
        hls.destroy();
      };
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      startPlayback();
      return () => {
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('loadeddata', onCanPlay);
        video.removeEventListener('pointerdown', unmute);
        video.removeEventListener('keydown', unmute);
      };
    }

    return () => {
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('loadeddata', onCanPlay);
      video.removeEventListener('pointerdown', unmute);
      video.removeEventListener('keydown', unmute);
    };
  }, [src]);

  return (
    <div className="relative h-full w-full bg-black">
      <video
        ref={videoRef}
        controls
        playsInline
        autoPlay
        muted
        preload="metadata"
        poster={poster}
        aria-label={`${title} stream`}
        title={title}
        className="h-full w-full bg-black"
      >
        {subSrc && <track key={subSrc} kind="subtitles" src={subSrc} label={subLabel ?? 'Subtitles'} default />}
      </video>

      {slot &&
        createPortal(
          <TrackMenu
            audio={audioTracks}
            audioId={audioId}
            onAudio={(id) => {
              if (hlsRef.current) hlsRef.current.audioTrack = id;
              setAudioId(id);
            }}
            subtitles={subtitles}
            subLabel={subLabel}
            subBusy={subBusy}
            onSubtitle={setSubLabel}
            levels={levels}
            levelId={levelId}
            onLevel={(id) => {
              if (hlsRef.current) hlsRef.current.currentLevel = id;
              setLevelId(id);
            }}
            entries={entries}
            entryIndex={entryIndex}
            onEntry={onEntryChange}
          />,
          slot,
        )}

      {error && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/80 px-6">
          <p className="max-w-sm text-center text-sm text-white/80">{error}</p>
        </div>
      )}
    </div>
  );
}

export function TrackMenu({
  audio,
  audioId,
  onAudio,
  subtitles,
  subLabel,
  subBusy,
  onSubtitle,
  levels,
  levelId,
  onLevel,
  entries,
  entryIndex,
  onEntry,
}: {
  audio: Choice[];
  audioId: number;
  onAudio: (id: number) => void;
  subtitles: SubtitleOption[];
  subLabel: string | null;
  subBusy: boolean;
  onSubtitle: (label: string | null) => void;
  levels: Choice[];
  levelId: number;
  onLevel: (id: number) => void;
  entries: StreamEntry[];
  entryIndex: number;
  onEntry: ((index: number) => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc, true);
    };
  }, [open]);

  const hasAudio = audio.length > 1;
  const hasSubs = subtitles.length > 0;
  const hasQuality = levels.length > 1;
  const hasEntries = entries.length > 1;
  if (!hasAudio && !hasSubs && !hasQuality && !hasEntries) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Audio, subtitles and quality"
        title="Audio, subtitles and quality"
        onClick={() => setOpen((o) => !o)}
        className="grid size-8 place-items-center rounded-lg bg-black/60 text-white shadow-lg ring-1 ring-white/15 backdrop-blur-md transition hover:bg-black/75 active:scale-95"
      >
        <Settings2 className="size-4" />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 mt-2 max-h-[min(60dvh,420px)] w-60 max-w-[80vw] space-y-1 overflow-y-auto rounded-xl bg-[#14161d]/95 p-1.5 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl [scrollbar-width:thin] animate-fadeIn">
          {hasAudio && (
            <Section title="Audio">
              {audio.map((track) => (
                <Row key={track.id} on={track.id === audioId} label={track.label} onClick={() => onAudio(track.id)} />
              ))}
            </Section>
          )}
          {hasSubs && (
            <Section title="Subtitles">
              <Row on={subLabel === null} label="Off" onClick={() => onSubtitle(null)} />
              {subtitles.map((sub) => (
                <Row key={sub.label} on={subLabel === sub.label} label={sub.label} hint={subLabel === sub.label && subBusy ? 'Loading' : undefined} onClick={() => onSubtitle(sub.label)} />
              ))}
            </Section>
          )}
          {hasQuality && (
            <Section title="Quality">
              <Row on={levelId === -1} label="Best" onClick={() => onLevel(levels[0]?.id ?? -1)} />
              {levels.map((level) => (
                <Row key={level.id} on={levelId === level.id} label={level.label} onClick={() => onLevel(level.id)} />
              ))}
            </Section>
          )}
          {hasEntries && onEntry && (
            <Section title="Version">
              {entries.map((entry, index) => (
                <Row
                  key={entry.url}
                  on={index === entryIndex}
                  label={entry.label}
                  hint={[entry.quality, ...entry.audio.slice(0, 2)].filter(Boolean).join(' · ')}
                  onClick={() => onEntry(index)}
                />
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="px-3 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-wider text-white/45">{title}</p>
      {children}
    </div>
  );
}

function Row({ on, label, hint, onClick }: { on: boolean; label: string; hint?: string | undefined; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={on}
      onClick={onClick}
      className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition hover:bg-white/10', on ? 'font-semibold text-white' : 'text-white/80')}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 text-[11px] text-white/45">{hint}</span>}
      {on && <Check className="size-4 shrink-0" />}
    </button>
  );
}

export default TvHlsPlayer;
