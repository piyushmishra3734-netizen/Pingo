import { useAuth } from '@pingo/core';
import { cn } from '@pingo/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
  guestAuthPath,
  hasIntroSeen,
  markIntroSeen,
} from '../features/auth/intro-seen.js';
import { hasOnboarded } from '../features/auth/onboarded.js';
import { useT } from '../features/i18n/useT.js';
import { loadIntroSlideUrls, SLIDE_COUNT } from '../lib/supabase/onboarding-slides.js';

/**
 * Pre-auth intro carousel — five full-bleed artworks after splash.
 *
 * Images are the content (no copy blocks). First-time users cannot skip;
 * returning users (intro already seen, or this device has had an account)
 * get a gentle Skip. Completing or skipping marks `pingo:intro_seen` and
 * routes to Welcome or Log In.
 */

const SWIPE_THRESHOLD_PX = 48;

export function IntroSlidesScreen() {
  const navigate = useNavigate();
  const { status } = useAuth();
  const t = useT();
  const [params] = useSearchParams();
  const replay = params.get('replay') === '1';

  // First-time funnel: no Skip. Returning / logout / operator preview: Skip.
  const allowSkip = replay || hasIntroSeen() || hasOnboarded() || status === 'authenticated';

  const [index, setIndex] = useState(0);
  const [desktop, setDesktop] = useState<string[]>([]);
  const [mobile, setMobile] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);

  const touchStartX = useRef<number | null>(null);
  const mouseStartX = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadIntroSlideUrls().then((urls) => {
      if (cancelled) return;
      setDesktop(urls.desktop);
      setMobile(urls.mobile);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const finish = useCallback(() => {
    markIntroSeen();
    if (status === 'authenticated') {
      navigate(replay ? '/settings/controlling' : '/chats', { replace: true });
      return;
    }
    navigate(guestAuthPath(), { replace: true });
  }, [navigate, replay, status]);

  const goNext = useCallback(() => {
    if (index >= SLIDE_COUNT - 1) {
      finish();
      return;
    }
    setIndex((i) => Math.min(i + 1, SLIDE_COUNT - 1));
  }, [finish, index]);

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(i - 1, 0));
  }, []);

  // Hardware / browser back: previous slide, not leave the funnel early on first run.
  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      event.preventDefault();
      if (index > 0) {
        setIndex((i) => i - 1);
        window.history.pushState({ intro: true }, '');
      } else if (allowSkip) {
        finish();
      } else {
        window.history.pushState({ intro: true }, '');
      }
    };
    window.history.pushState({ intro: true }, '');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [allowSkip, finish, index]);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
    setDragging(true);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return;
    const x = e.touches[0]?.clientX ?? touchStartX.current;
    setDragX(x - touchStartX.current);
  };
  const onTouchEnd = () => {
    if (touchStartX.current == null) return;
    const dx = dragX;
    touchStartX.current = null;
    setDragging(false);
    setDragX(0);
    if (dx <= -SWIPE_THRESHOLD_PX) goNext();
    else if (dx >= SWIPE_THRESHOLD_PX) goPrev();
  };

  const onMouseDown = (e: React.MouseEvent) => {
    mouseStartX.current = e.clientX;
    setDragging(true);
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (mouseStartX.current == null) return;
    setDragX(e.clientX - mouseStartX.current);
  };
  const endMouse = () => {
    if (mouseStartX.current == null) return;
    const dx = dragX;
    mouseStartX.current = null;
    setDragging(false);
    setDragX(0);
    if (dx <= -SWIPE_THRESHOLD_PX) goNext();
    else if (dx >= SWIPE_THRESHOLD_PX) goPrev();
  };

  const isLast = index === SLIDE_COUNT - 1;

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0b0b12] text-white select-none">
      {/* Track — each pane is full viewport width; swipe/drag shifts by index. */}
      <div
        className={cn(
          'flex h-full',
          !dragging && 'transition-transform duration-300 ease-out',
        )}
        style={{
          transform: `translate3d(calc(${-index * 100}% + ${dragX}px), 0, 0)`,
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endMouse}
        onMouseLeave={() => {
          if (mouseStartX.current != null) endMouse();
        }}
        role="region"
        aria-roledescription="carousel"
        aria-label="PINGO introduction"
      >
        {Array.from({ length: SLIDE_COUNT }, (_, i) => (
          <div
            key={i}
            className="relative h-full w-full min-w-full shrink-0 grow-0"
            aria-hidden={i !== index}
          >
            {ready ? (
              <picture className="block h-full w-full">
                <source media="(max-width: 767px)" srcSet={mobile[i]} />
                <img
                  src={desktop[i]}
                  alt=""
                  draggable={false}
                  decoding={i === index ? 'sync' : 'async'}
                  fetchPriority={i === index ? 'high' : 'low'}
                  className="h-full w-full object-cover object-center"
                />
              </picture>
            ) : (
              <div className="grid h-full w-full place-items-center bg-[#0b0b12]">
                <div className="size-10 animate-pulse rounded-full bg-white/10" />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Chrome: indicators + next + optional skip */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/55 via-black/20 to-transparent px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-16">
        <div className="pointer-events-auto mx-auto flex w-full max-w-lg flex-col items-center gap-4">
          <div className="flex items-center gap-2" aria-label={`Slide ${index + 1} of ${SLIDE_COUNT}`}>
            {Array.from({ length: SLIDE_COUNT }, (_, i) => (
              <span
                key={i}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-300',
                  i === index ? 'w-6 bg-white' : 'w-1.5 bg-white/35',
                )}
              />
            ))}
          </div>

          <div className="flex w-full items-center justify-between gap-3">
            {allowSkip ? (
              <button
                type="button"
                onClick={finish}
                className={cn(
                  'rounded-full px-4 py-2.5 text-sm font-medium text-white/85',
                  'bg-white/10 backdrop-blur-md ring-1 ring-white/15',
                  'transition hover:bg-white/15 active:scale-[0.98]',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60',
                )}
              >
                {t('intro.skip')}
              </button>
            ) : (
              <span className="w-[4.5rem]" aria-hidden />
            )}

            <button
              type="button"
              onClick={goNext}
              className={cn(
                'min-w-[8.5rem] rounded-full px-6 py-3 text-sm font-semibold text-[#0b0b12]',
                'bg-white shadow-lg shadow-black/25',
                'transition hover:bg-white/95 active:scale-[0.98]',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
              )}
            >
              {isLast ? t('intro.continue') : t('intro.next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
