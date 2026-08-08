import { useChat } from '@pingo/core';
import { useEffect, useMemo, useRef } from 'react';

/**
 * The unread count in the browser tab: title and favicon.
 *
 * ## Conversations, not messages
 *
 * Forty messages in one group is one thing to deal with, not forty. WhatsApp
 * Web and Discord both count *places that want you*, and that is the number a
 * person can act on - "(3)" means three conversations to open, and glancing at
 * a tab should tell you how much is waiting rather than how much was said.
 *
 * Muted conversations are excluded for the same reason they are excluded from
 * the dock badge: they were muted precisely so they would stop counting.
 *
 * ## Nothing polls
 *
 * `conversations` already updates over realtime for the chat list, so this is
 * an effect on a value that is being kept fresh anyway. A timer here would ask
 * a question the app already knows the answer to, and would be wrong for up to
 * its own interval every time.
 *
 * ## The favicon is drawn, not swapped
 *
 * A set of pre-rendered icons would need one per count, and would still be
 * wrong at ten. The badge is composited onto the real icon in a canvas, which
 * also means it inherits whatever the icon becomes later.
 *
 * Safari is the graceful fallback: it ignores `href` changes on a favicon link
 * often enough that this cannot be relied on there, so the drawing simply has
 * no visible effect and the title - which every browser honours - carries the
 * count on its own. Nothing is feature-detected, because there is nothing to
 * detect: the write either shows or it does not, and no error is raised either
 * way.
 */

/**
 * Badge radius, as a fraction of the icon.
 *
 * Compared side by side at 16px and 64px before settling: 0.3 covered the P
 * entirely and 0.24 still clipped it. At 0.2 the mark stays readable and the
 * badge reads as a badge rather than as a red icon with something behind it.
 */
const BADGE_RADIUS = 0.2;
const CANVAS = 64;

/**
 * Remembered so the icon can be put back exactly as it was.
 *
 * Read once, at module scope, before anything has had a chance to overwrite it
 * - reading it later would return whatever badge was drawn last, and
 * "restoring" would then paint the count back on.
 */
let originalHref: string | undefined;
let originalTitle: string | undefined;
let baseImage: HTMLImageElement | undefined;

function faviconLink(): HTMLLinkElement | undefined {
  if (typeof document === 'undefined') return undefined;

  const existing = document.querySelector<HTMLLinkElement>(
    "link[rel~='icon']",
  );
  if (existing) return existing;

  // A page with no icon link still gets a badge: the browser is showing a
  // default, and one can be added for it to replace.
  const link = document.createElement('link');
  link.rel = 'icon';
  link.href = '/pingo-favicon.png';
  document.head.appendChild(link);
  return link;
}

async function loadBase(href: string): Promise<HTMLImageElement | undefined> {
  if (baseImage) return baseImage;

  return new Promise((resolve) => {
    const image = new Image();
    // The icon is same-origin, but the canvas is read back with `toDataURL`
    // and a tainted canvas throws - this keeps that from ever being possible.
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      baseImage = image;
      resolve(image);
    };
    image.onerror = () => resolve(undefined);
    image.src = href;
  });
}

function draw(image: HTMLImageElement, count: number): string | undefined {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS;
  canvas.height = CANVAS;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;

  ctx.drawImage(image, 0, 0, CANVAS, CANVAS);

  const r = CANVAS * BADGE_RADIUS;
  const cx = CANVAS - r - 1;
  const cy = r + 1;

  /*
   * A ring of page colour behind the dot.
   *
   * Without it the badge merges into a dark icon at 16 pixels and reads as a
   * smudge. The same trick every dock badge uses, for the same reason.
   */
  ctx.beginPath();
  ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ff3b30';
  ctx.fill();

  /*
   * "9+" past nine.
   *
   * Two digits inside a circle this small are unreadable, and the difference
   * between eleven and twelve is not what somebody is looking for - "more than
   * a few" is the whole message.
   */
  const label = count > 9 ? '9+' : String(count);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${label.length > 1 ? r * 1.05 : r * 1.35}px -apple-system, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, cy + 1);

  return canvas.toDataURL('image/png');
}

export function useBrowserBadge(): void {
  const { conversations } = useChat();

  /** Places that want you, which is not the same as how much was said. */
  const unreadChats = useMemo(
    () => conversations.filter((c) => !c.muted && c.unreadCount > 0).length,
    [conversations],
  );

  /** Set once so a restore puts back what was there before this ran. */
  const captured = useRef(false);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const link = faviconLink();
    if (!captured.current) {
      originalTitle ??= document.title;
      originalHref ??= link?.getAttribute('href') ?? '/pingo-favicon.png';
      captured.current = true;
    }

    const base = originalTitle ?? 'PINGO';

    if (unreadChats === 0) {
      document.title = base;
      if (link && originalHref) link.href = originalHref;
      return;
    }

    document.title = `(${unreadChats > 9 ? '9+' : unreadChats}) ${base}`;

    let cancelled = false;
    void loadBase(originalHref ?? '/pingo-favicon.png').then((image) => {
      if (cancelled || !image || !link) return;
      const url = draw(image, unreadChats);
      if (url) link.href = url;
    });

    return () => {
      cancelled = true;
    };
  }, [unreadChats]);

  /*
   * Put the tab back on the way out.
   *
   * Signing out unmounts this while the title still says "(3) PINGO", and a
   * tab claiming three unread conversations on a login screen is a small lie
   * that survives until the next navigation.
   */
  useEffect(() => {
    return () => {
      if (typeof document === 'undefined') return;
      if (originalTitle) document.title = originalTitle;
      const link = faviconLink();
      if (link && originalHref) link.href = originalHref;
    };
  }, []);
}
