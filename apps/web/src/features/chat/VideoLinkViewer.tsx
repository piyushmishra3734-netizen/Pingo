import type { VideoPreview } from '@pingo/core';
import { ExternalLink, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Overlay } from '../../components/Overlay.js';

/**
 * A linked video, full screen - tapping one in a chat goes into it, the way a
 * reel opens on Instagram or a Short on YouTube.
 *
 * The frame grows out of the card that was tapped (its rectangle, animated to
 * the screen) and the video starts at once. Swipe down on the black, or the
 * cross, and it shrinks back into the card. Upright videos fill the height;
 * wide ones sit across the middle.
 */

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

export function VideoLinkViewer({ preview, from, title, author, label, onClose }: {
  preview: VideoPreview;
  /** The card's rectangle, to grow out of and shrink back into. */
  from?: DOMRect;
  title?: string;
  author?: string;
  label: string;
  onClose: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const [drag, setDrag] = useState(0);
  const start = useRef<number>();
  const aspect = preview.aspect ?? 16 / 9;
  const upright = aspect < 1;
  // Instagram's player carries its own header and caption, so it gets a phone-wide column and may scroll.
  const instagram = preview.platform === 'instagram';

  // From the card to the screen: start where the card is, then let go.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el || !from) { setShown(true); return; }
    const to = el.getBoundingClientRect();
    const sx = from.width / to.width, sy = from.height / to.height;
    el.style.transition = 'none';
    el.style.transformOrigin = 'top left';
    el.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${sx}, ${sy})`;
    el.style.borderRadius = '18px';
    requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
  }, [from]);

  const close = () => {
    const el = stage.current;
    if (!el || !from) { onClose(); return; }
    const to = el.getBoundingClientRect();
    el.style.transition = `transform 280ms ${EASE}, border-radius 280ms ${EASE}`;
    el.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
    el.style.borderRadius = '18px';
    setShown(false);
    window.setTimeout(onClose, 260);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = stage.current; if (!el || !shown || drag) return;
    el.style.transition = `transform 380ms ${EASE}, border-radius 380ms ${EASE}`;
    el.style.transform = 'none';
    el.style.borderRadius = '0px';
  }, [shown, drag]);

  // Swipe down on the black to leave. The video itself keeps its own touches.
  const onDown = (e: React.PointerEvent) => { start.current = e.clientY; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
  const onMove = (e: React.PointerEvent) => {
    if (start.current === undefined) return;
    const dy = Math.max(0, e.clientY - start.current);
    setDrag(dy);
    const el = stage.current; if (el) { el.style.transition = 'none'; el.style.transform = `translateY(${dy}px) scale(${1 - Math.min(dy, 400) / 1600})`; el.style.borderRadius = `${Math.min(dy / 6, 18)}px`; }
  };
  const onUp = () => {
    if (start.current === undefined) return;
    start.current = undefined;
    if (drag > 110) close();
    else setDrag(0);
  };

  const src = preview.embedUrl;
  const frame = src ? (
    <iframe
      src={src}
      title={title ?? label}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      className="size-full border-0"
    />
  ) : null;

  return (
    <Overlay onDismiss={close}>
      <div
        className="fixed inset-0 z-600 select-none bg-black transition-opacity duration-300"
        style={{ opacity: shown ? Math.max(0.35, 1 - drag / 500) : 0, touchAction: 'none' }}
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
          className="pointer-events-auto relative overflow-hidden bg-black"
          style={
            instagram
              ? { width: 'min(100vw, 480px)', height: '100dvh' }
              : upright
                ? { height: '100dvh', width: `min(100vw, calc(100dvh * ${aspect}))` }
                : { width: '100vw', maxWidth: `calc(100dvh * ${aspect})`, aspectRatio: String(aspect) }
          }
        >
          {instagram ? <div className="size-full overflow-y-auto bg-white">{frame}</div> : frame}
        </div>
      </div>

      {/* Chrome over the video: close, where it is from, open in the app */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-610 flex items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 text-white transition-opacity duration-300"
        style={{ opacity: shown && !drag ? 1 : 0 }}
      >
        <button type="button" aria-label="Close" onClick={close} className="pointer-events-auto grid size-10 place-items-center rounded-full bg-black/45 backdrop-blur-md"><X size={20} /></button>
        <a href={preview.canonicalUrl} target="_blank" rel="noopener noreferrer" className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-black/45 px-3.5 py-2 text-[13px] font-semibold backdrop-blur-md">
          Open in {label}<ExternalLink size={14} />
        </a>
      </div>
      {!instagram && !upright && (title || author) && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-0 z-610 bg-gradient-to-t from-black/80 to-transparent px-4 pt-10 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-white transition-opacity duration-300"
          style={{ opacity: shown && !drag ? 1 : 0 }}
        >
          {author && <p className="text-[13px] font-semibold">{author}</p>}
          {title && <p className="mt-0.5 line-clamp-2 text-[14px] text-white/85">{title}</p>}
        </div>
      )}
    </Overlay>
  );
}
