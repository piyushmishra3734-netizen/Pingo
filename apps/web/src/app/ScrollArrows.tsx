import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Up and down arrows for whatever is scrolling on screen, for a mouse and a
 * keyboard. The screens scroll inside their own panels, not the page, and on a
 * laptop that has two ways to fail: a mouse with no wheel has nothing to
 * scroll with, and the arrow, Page and Space keys only move a panel that has
 * focus, which a click on the page's background does not give it.
 *
 * So this finds the panel the person is looking at (the topmost one that
 * actually overflows) and offers arrows for it, and it answers the scrolling
 * keys itself when nothing else is using them. Touch screens scroll by
 * hand, so there it stays out of the way. In a chat the arrows sit higher, clear
 * of the composer and the jump to the latest message.
 */

const FINE_POINTER = '(hover: hover) and (pointer: fine)';

function scrollable(el: Element): boolean {
  const { overflowY } = getComputedStyle(el);
  return (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 40;
}

/** The overflowing panel in front: the last one in the page that is big enough to be "the" content. */
function findTarget(): HTMLElement | null {
  const minHeight = window.innerHeight * 0.35;
  const minWidth = Math.min(280, window.innerWidth * 0.6);
  let found: HTMLElement | null = null;
  for (const el of document.querySelectorAll<HTMLElement>('*')) {
    if (el.clientHeight < minHeight || el.clientWidth < minWidth || !scrollable(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) continue;
    found = el;
  }
  return found;
}

const TYPING = /^(INPUT|TEXTAREA|SELECT|IFRAME|VIDEO|AUDIO)$/;

export function ScrollArrows() {
  const { pathname } = useLocation();
  const [state, setState] = useState({ up: false, down: false });
  const target = useRef<HTMLElement | null>(null);
  const fine = typeof window !== 'undefined' && window.matchMedia?.(FINE_POINTER).matches;
  const inChat = /^\/chats\/[^/]+/.test(pathname);

  useEffect(() => {
    if (!fine) return;
    const measure = () => {
      let el = target.current;
      if (!el || !el.isConnected || !scrollable(el)) el = target.current = findTarget();
      const next = el
        ? { up: el.scrollTop > 24, down: el.scrollTop + el.clientHeight < el.scrollHeight - 24 }
        : { up: false, down: false };
      setState((was) => (was.up === next.up && was.down === next.down ? was : next));
    };
    measure();
    // A panel comes and goes as screens and sheets open; scrolling inside it is heard in the capture phase.
    const timer = setInterval(() => {
      const front = findTarget();
      if (front !== target.current) target.current = front;
      measure();
    }, 500);
    document.addEventListener('scroll', measure, { capture: true, passive: true });
    return () => {
      clearInterval(timer);
      document.removeEventListener('scroll', measure, true);
    };
  }, [fine, pathname]);

  useEffect(() => {
    if (!fine) return;
    const onKey = (e: KeyboardEvent) => {
      const el = target.current ?? findTarget();
      if (!el || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (TYPING.test(t.tagName) || t.isContentEditable || t.closest('[role=dialog] iframe'))) return;
      // A focused panel or control already scrolls itself.
      if (t && t !== document.body && t !== document.documentElement && (t.matches('button, a, [role=button], [role=tab], [role=slider]') || el.contains(t) === false)) return;
      const page = el.clientHeight * 0.85;
      let to: number | undefined;
      if (e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) to = el.scrollTop + page;
      else if (e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) to = el.scrollTop - page;
      else if (e.key === 'ArrowDown') to = el.scrollTop + 80;
      else if (e.key === 'ArrowUp') to = el.scrollTop - 80;
      else if (e.key === 'Home') to = 0;
      else if (e.key === 'End') to = el.scrollHeight;
      if (to === undefined) return;
      e.preventDefault();
      el.scrollTo({ top: to, behavior: e.key.startsWith('Arrow') ? 'auto' : 'smooth' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fine]);

  if (!fine || (!state.up && !state.down)) return null;

  const go = (dir: -1 | 1) => {
    const el = target.current;
    if (el) el.scrollBy({ top: dir * el.clientHeight * 0.8, behavior: 'smooth' });
  };

  const btn =
    'grid size-10 place-items-center rounded-full border border-white/15 bg-black/65 text-white shadow-lg backdrop-blur-md transition hover:bg-black/85 active:scale-95 disabled:pointer-events-none disabled:opacity-0';
  return (
    <div className={`pointer-events-none fixed right-4 z-[300] flex flex-col gap-2 ${inChat ? 'bottom-[150px]' : 'bottom-[96px]'}`}>
      <button type="button" aria-label="Scroll up" disabled={!state.up} onClick={() => go(-1)} className={`pointer-events-auto ${btn}`}>
        <ChevronUp className="size-5" />
      </button>
      <button type="button" aria-label="Scroll down" disabled={!state.down} onClick={() => go(1)} className={`pointer-events-auto ${btn}`}>
        <ChevronDown className="size-5" />
      </button>
    </div>
  );
}
