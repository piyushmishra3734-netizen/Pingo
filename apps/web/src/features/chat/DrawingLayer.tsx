import type { Message } from '@pingo/core';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * Drawings lying on the conversation itself.
 *
 * A drawing is not a row in the thread: it is laid over it, pinned to the
 * message it was made beside, so it stays on that spot of the page when
 * either person scrolls and is there again whenever the thread is reopened.
 * Positions are measured from the live message element, so a bubble that
 * grows or an image that loads moves its drawing with it.
 */

interface Placed {
  id: string;
  url: string;
  left: number;
  top: number;
  width: number;
}

export function DrawingLayer({
  messages,
  contentRef,
}: {
  messages: Message[];
  contentRef: RefObject<HTMLDivElement | null>;
}) {
  const [placed, setPlaced] = useState<Placed[]>([]);

  /*
   * What each drawing is currently showing, kept until its replacement has loaded.
   *
   * A drawing you just sent is first drawn from the copy on your phone, then the
   * message is confirmed and its address becomes the server's. Switching the
   * image straight to the new address blanks it until that downloads, which is
   * the flicker a sender sees. So the new address is fetched in the background
   * and swapped in only once it is ready; the old picture stays on screen until then.
   */
  const shownUrls = useRef(new Map<string, string>());
  const [, bump] = useState(0);
  useEffect(() => {
    let live = true;
    for (const message of messages) {
      const url = message.photo?.drawing ? message.photo.url : undefined;
      if (!url) continue;
      const have = shownUrls.current.get(message.id);
      if (have === url) continue;
      if (!have) {
        shownUrls.current.set(message.id, url);
        bump((n) => n + 1);
        continue;
      }
      const image = new Image();
      image.onload = image.onerror = () => {
        if (!live) return;
        shownUrls.current.set(message.id, url);
        bump((n) => n + 1);
      };
      image.src = url;
    }
    return () => {
      live = false;
    };
  }, [messages]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const drawings = messages.filter((m) => m.photo?.drawing && m.photo.url);

    const place = () => {
      const base = content.getBoundingClientRect();
      if (base.width === 0) return;
      const next: Placed[] = [];
      for (const message of drawings) {
        const anchor = message.photo!.drawing!;
        const target = content.querySelector<HTMLElement>(`[id="message-${CSS.escape(anchor.messageId)}"]`);
        if (!target) continue;
        const rect = target.getBoundingClientRect();
        next.push({
          id: message.id,
          url: shownUrls.current.get(message.id) ?? message.photo!.url!,
          left: anchor.x * base.width,
          top: rect.top - base.top + anchor.y * base.width,
          width: anchor.w * base.width,
        });
      }
      setPlaced((old) =>
        old.length === next.length && old.every((o, i) => o.id === next[i]!.id && o.url === next[i]!.url && o.top === next[i]!.top && o.left === next[i]!.left && o.width === next[i]!.width)
          ? old
          : next,
      );
    };

    place();
    const observer = new ResizeObserver(place);
    observer.observe(content);
    // Pictures settling in change heights without resizing the content box's width.
    content.addEventListener('load', place, true);
    return () => {
      observer.disconnect();
      content.removeEventListener('load', place, true);
    };
  }, [messages, contentRef, shownUrls.current.size]);

  if (placed.length === 0) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {placed.map((drawing) => (
        <img
          key={drawing.id}
          src={drawing.url}
          alt=""
          draggable={false}
          className="absolute h-auto select-none"
          style={{ left: drawing.left, top: drawing.top, width: drawing.width }}
        />
      ))}
    </div>
  );
}
