import type { VideoPreview } from '@pingo/core';
import { ExternalLink, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Overlay } from '../../components/Overlay.js';
import { canResolveMedia, resolveMedia } from '../../lib/video/resolve-media.js';

/**
 * A linked video or post, full screen - tapping one in a chat goes into it, the
 * way a reel opens on Instagram or a Short on YouTube.
 *
 * ## It opens on the tap, not after it
 *
 * The card used to ask the media resolver first and wait - up to twenty
 * seconds - with a spinner on the card, then play the video inside the small
 * card, and only open this screen if that failed. Every tap was a wait, and
 * the good outcome was the smaller one. Now the tap opens this at once, and
 * the waiting happens here, behind the cover picture, full screen.
 *
 * ## The real video when there is one
 *
 * A resolved file plays in the phone's own player: no YouTube chrome, no
 * second tap, sound on - the thing that makes it feel like the app it came
 * from. The platform's embed is the fallback, loaded as soon as it is clear
 * no file is coming quickly.
 *
 * ## Growing out of the card without stretching
 *
 * One uniform scale plus a clip to the card's shape, animated together. Scaling
 * width and height separately squashed the cover for the whole transition,
 * which is most of what made it feel cheap.
 */

const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const OPEN_MS = 380;
const CLOSE_MS = 300;
/** How long to hold out for the real file before loading the platform's player. */
const RESOLVE_WAIT_MS = 2500;

type Phase = 'waiting' | 'native' | 'embed';

export function VideoLinkViewer({ preview, from, title, author, label, poster, onClose }: {
  preview: VideoPreview;
  /** The card's rectangle, to grow out of and shrink back into. */
  from?: DOMRect;
  title?: string;
  author?: string;
  label: string;
  /** The cover, shown until the video has drawn. */
  poster?: string;
  onClose: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [shown, setShown] = useState(false);
  const [drag, setDrag] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [phase, setPhase] = useState<Phase>(() => (canResolveMedia() ? 'waiting' : 'embed'));
  const [file, setFile] = useState<string>();
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const start = useRef<number | undefined>(undefined);
  const aspect = preview.aspect ?? 16 / 9;
  const upright = aspect < 1;
  // Instagram's embed carries its own header and caption: a phone-wide column that may scroll.
  const instagramEmbed = preview.platform === 'instagram' && phase === 'embed';

  // The real file if it comes quickly; the platform's player if not.
  useEffect(() => {
    if (phase !== 'waiting') return;
    let settled = false;
    const timer = window.setTimeout(() => { if (!settled) { settled = true; setPhase('embed'); } }, RESOLVE_WAIT_MS);
    void resolveMedia(preview.canonicalUrl).then((url) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (url) { setFile(url); setPhase('native'); } else setPhase('embed');
    });
    return () => { settled = true; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  /** Where the stage has to be, relative to its full-screen place, to sit exactly over the card. */
  const onCard = (el: HTMLElement) => {
    if (!from) return undefined;
    // Layout box, not the drawn one: offsets ignore the transform a drag has put on it.
    const to = { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
    if (!to.width || !to.height) return undefined;
    const s = Math.max(from.width / to.width, from.height / to.height);
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const ix = Math.max(0, (to.width - from.width / s) / 2);
    const iy = Math.max(0, (to.height - from.height / s) / 2);
    return {
      transform: `translate(${dx}px, ${dy}px) scale(${s})`,
      clip: `inset(${iy}px ${ix}px round ${18 / s}px)`,
    };
  };

  // From the card to the screen: placed over the card, then let go.
  useLayoutEffect(() => {
    const el = stage.current;
    const at = el && onCard(el);
    if (!el || !at) { setShown(true); return; }
    el.style.transition = 'none';
    el.style.transformOrigin = 'center';
    el.style.transform = at.transform;
    el.style.clipPath = at.clip;
    requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  useEffect(() => {
    const el = stage.current; if (!el || !shown || drag) return;
    el.style.transition = `transform ${OPEN_MS}ms ${EASE}, clip-path ${OPEN_MS}ms ${EASE}`;
    el.style.transform = 'none';
    el.style.clipPath = 'inset(0px 0px round 0px)';
  }, [shown, drag]);

  const close = () => {
    video.current?.pause();
    const el = stage.current;
    const at = el && onCard(el);
    setShown(false);
    if (!el || !at) { window.setTimeout(onClose, 180); return; }
    el.style.transition = `transform ${CLOSE_MS}ms ${EASE}, clip-path ${CLOSE_MS}ms ${EASE}`;
    el.style.transform = at.transform;
    el.style.clipPath = at.clip;
    window.setTimeout(onClose, CLOSE_MS - 20);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sound on, as the app it came from would. A phone that refuses starts it muted, with a way to turn it up.
  useEffect(() => {
    const v = video.current; if (phase !== 'native' || !v) return;
    v.muted = false;
    void v.play().catch(() => { v.muted = true; setMuted(true); void v.play().catch(() => setPaused(true)); });
  }, [phase, file]);

  // Swipe down on the black to leave. An embedded player keeps its own touches.
  const onDown = (e: React.PointerEvent) => { start.current = e.clientY; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
  const onMove = (e: React.PointerEvent) => {
    if (start.current === undefined) return;
    const dy = Math.max(0, e.clientY - start.current);
    setDrag(dy);
    const el = stage.current; if (el) { el.style.transition = 'none'; el.style.transform = `translateY(${dy}px) scale(${1 - Math.min(dy, 400) / 1600})`; el.style.clipPath = `inset(0px 0px round ${Math.min(dy / 6, 18)}px)`; }
  };
  const onUp = () => {
    if (start.current === undefined) return;
    start.current = undefined;
    if (drag > 110) close();
    else setDrag(0);
  };

  const togglePlay = () => {
    const v = video.current; if (!v) return;
    if (v.paused) { void v.play(); setPaused(false); } else { v.pause(); setPaused(true); }
  };

  const src = preview.embedUrl;
  const frame = phase === 'embed' && src ? (
    <iframe
      src={src}
      title={title ?? label}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      onLoad={() => setLoaded(true)}
      className={`relative size-full border-0 transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
    />
  ) : phase === 'embed' ? (
    // No file came back and the platform lets nothing be framed: say so, with the way out.
    <p className="absolute inset-x-6 top-1/2 -translate-y-1/2 text-center text-[14px] text-white/80">
      This one only plays on {label}. Use Open in {label} above.
    </p>
  ) : null;

  const native = phase === 'native' && file ? (
    <video
      ref={video}
      src={file}
      playsInline
      loop
      preload="auto"
      onLoadedData={() => setLoaded(true)}
      onTimeUpdate={(e) => { const v = e.currentTarget; if (v.duration) setProgress(v.currentTime / v.duration); }}
      onClick={togglePlay}
      className={`absolute inset-0 size-full object-contain transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
    />
  ) : null;

  const chrome = shown && !drag ? 1 : 0;

  return (
    <Overlay onDismiss={close}>
      <div
        className="fixed inset-0 z-600 select-none bg-black"
        style={{ opacity: shown ? Math.max(0.35, 1 - drag / 500) : 0, transition: `opacity ${shown ? OPEN_MS : CLOSE_MS}ms ${EASE}`, touchAction: 'none' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? `${label} video`}
      />
      <div className="pointer-events-none fixed inset-0 z-600 flex items-center justify-center">
        <div
          ref={stage}
          className="pointer-events-auto relative overflow-hidden bg-black will-change-transform"
          style={
            instagramEmbed
              ? { width: 'min(100vw, 480px)', height: '100dvh' }
              : upright
                ? { height: '100dvh', width: `min(100vw, calc(100dvh * ${aspect}))` }
                : { width: '100vw', maxWidth: `calc(100dvh * ${aspect})`, aspectRatio: String(aspect) }
          }
        >
          {/* The card's own picture, cropped as the card crops it, so the grow is one continuous image. */}
          {poster && !loaded && !posterFailed && <img src={poster} alt="" onError={() => setPosterFailed(true)} className="absolute inset-0 size-full object-cover" />}
          {!loaded && shown && !(phase === 'embed' && !src) && <span aria-hidden className="absolute top-1/2 left-1/2 size-9 -translate-1/2 animate-spin rounded-full border-[3px] border-white/30 border-t-white" />}
          {native}
          {instagramEmbed ? <div className={`relative size-full overflow-y-auto ${loaded ? 'bg-white' : ''}`}>{frame}</div> : frame}
          {native && paused && <span aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 grid size-16 -translate-1/2 place-items-center rounded-full bg-black/45 text-white"><svg viewBox="0 0 24 24" className="ml-1 size-7 fill-current"><path d="M8 5v14l11-7z" /></svg></span>}
          {native && <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-white/20"><span className="block h-full bg-white" style={{ width: `${progress * 100}%` }} /></span>}
        </div>
      </div>

      {/* Chrome over the video: close, where it is from, sound, open in the app */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-610 flex items-center justify-between gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 text-white"
        style={{ opacity: chrome, transition: `opacity ${shown ? 220 : 120}ms ease-out ${shown ? OPEN_MS - 120 : 0}ms` }}
      >
        <button type="button" aria-label="Close" onClick={close} className="pointer-events-auto grid size-10 place-items-center rounded-full bg-black/45"><X size={20} /></button>
        <span className="flex items-center gap-2">
          {native && (
            <button
              type="button"
              aria-label={muted ? 'Sound on' : 'Sound off'}
              onClick={() => { const v = video.current; if (v) { v.muted = !muted; setMuted(!muted); } }}
              className="pointer-events-auto grid size-10 place-items-center rounded-full bg-black/45"
            >
              {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
          )}
          <a href={preview.canonicalUrl} target="_blank" rel="noopener noreferrer" className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-black/45 px-3.5 py-2 text-[13px] font-semibold">
            Open in {label}<ExternalLink size={14} />
          </a>
        </span>
      </div>
      {!instagramEmbed && (title || author) && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-0 z-610 bg-gradient-to-t from-black/80 to-transparent px-4 pt-10 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-white"
          style={{ opacity: upright && phase === 'embed' ? 0 : chrome, transition: `opacity ${shown ? 220 : 120}ms ease-out ${shown ? OPEN_MS - 120 : 0}ms` }}
        >
          {author && <p className="text-[13px] font-semibold">{author}</p>}
          {title && <p className="mt-0.5 line-clamp-2 text-[14px] text-white/85">{title}</p>}
        </div>
      )}
    </Overlay>
  );
}
