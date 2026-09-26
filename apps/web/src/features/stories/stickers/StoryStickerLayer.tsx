import type { StickerAnswer, StickerResult, Story, StorySticker } from '@pingo/core';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useContainBox } from '../../camera/VideoOverlay.js';
import { useStories } from '../StoryContext.js';
import { StickerView, stickerStyle } from './StickerView.js';

/** Stickers that only decorate: a tap on them is a tap on the story. */
const DECORATIVE = new Set<StorySticker['type']>(['text', 'emoji', 'clock']);
const ASKS = new Set<StorySticker['type']>(['poll', 'quiz', 'slider', 'countdown', 'question']);

/**
 * A story's stickers, drawn over its picture and alive.
 *
 * The frame is 9:16 - the shape the editor exports - fitted into whatever room
 * the viewer has, so a sticker lands where it was put on every screen. Taps on
 * the interactive ones are theirs; they never also advance the story.
 */
export function StoryStickerLayer({
  story,
  hold,
  onOpenProfile,
}: {
  story: Story;
  /** The player's counted pause, held while somebody is answering. */
  hold: () => () => void;
  onOpenProfile: (username: string) => void;
}) {
  const { service } = useStories();
  const stickers = story.decor?.stickers ?? [];
  const host = useRef<HTMLDivElement>(null);
  const box = useContainBox(host, 9 / 16);
  const [results, setResults] = useState<StickerResult[]>([]);
  const [mine, setMine] = useState<Record<string, StickerAnswer>>({});
  const [tip, setTip] = useState<{ text: string; x: number; y: number }>();
  const [asking, setAsking] = useState<StorySticker>();
  const [reply, setReply] = useState('');
  const [burst, setBurst] = useState<{ at: number; x: number; y: number }>();

  const interactive = stickers.some((s) => ASKS.has(s.type));
  const reload = useCallback(async () => {
    try {
      const got = await service.stickerResults(story.id);
      setResults(got.results);
      setMine(got.mine);
    } catch {
      // Results are a nicety over the story itself; the story plays regardless.
    }
  }, [service, story.id]);

  useEffect(() => {
    setResults([]); setMine({}); setTip(undefined); setAsking(undefined);
    if (interactive) void reload();
  }, [story.id, interactive, reload]);

  // Holding still while somebody is typing an answer.
  useEffect(() => (asking ? hold() : undefined), [asking, hold]);
  useEffect(() => {
    if (!tip) return;
    const t = window.setTimeout(() => setTip(undefined), 2400);
    return () => window.clearTimeout(t);
  }, [tip]);

  if (stickers.length === 0) return null;

  const answer = async (s: StorySticker, a: StickerAnswer, el?: HTMLElement) => {
    setMine((m) => ({ ...m, [s.id]: a }));
    if (s.type === 'quiz' && a.choice === s.d.right && el && host.current) {
      const r = el.getBoundingClientRect(), h = host.current.getBoundingClientRect();
      setBurst({ at: Date.now(), x: r.left - h.left + r.width / 2, y: r.top - h.top });
    }
    try { await service.answerSticker(story.id, s.id, a); } catch { /* shown as answered either way */ }
    void reload();
  };

  const tapped = (s: StorySticker, el: HTMLElement) => {
    const h = host.current?.getBoundingClientRect(); const r = el.getBoundingClientRect();
    const at = h ? { x: r.left - h.left + r.width / 2, y: r.top - h.top - 8 } : { x: 0, y: 0 };
    const d = s.d as Record<string, string>;
    switch (s.type) {
      case 'men': return onOpenProfile(d.text ?? '');
      case 'link': {
        const url = /^https?:\/\//.test(d.text ?? '') ? d.text! : `https://${d.text}`;
        window.open(url, '_blank', 'noopener');
        return;
      }
      case 'question': setReply(''); return setAsking(s);
      case 'loc': return setTip({ text: d.text ?? '', ...at });
      case 'tag': return setTip({ text: `#${d.text}`, ...at });
      case 'music': return setTip({ text: `${d.name} · ${d.artist}`, ...at });
      case 'post': return setTip({ text: `Post by ${d.user}`, ...at });
    }
  };

  return (
    <div ref={host} className="pointer-events-none absolute inset-0 z-10">
      {box && (
        <div className="sk-layer" style={{ width: box.width, height: box.height, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
          {stickers.map((s) => (
            <div
              key={s.id}
              className="sk"
              style={{ ...stickerStyle(s), pointerEvents: DECORATIVE.has(s.type) ? 'none' : 'auto' }}
              // Its own taps: the story must not also advance or pause.
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
            >
              <StickerView
                sticker={s}
                mode="view"
                {...(mine[s.id] ? { answer: mine[s.id]! } : {})}
                results={results.filter((r) => r.stickerId === s.id)}
                onAnswer={(a, el) => void answer(s, a, el)}
                onTap={(el) => tapped(s, el)}
                onBusy={(b) => { if (b) { const release = hold(); window.addEventListener('pointerup', release, { once: true }); } }}
              />
            </div>
          ))}
        </div>
      )}

      {tip && (
        <div className="animate-fade-in pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-xl bg-white px-3.5 py-2 text-[13.5px] font-bold whitespace-nowrap text-black shadow-lg"
          style={{ left: tip.x, top: tip.y }}>{tip.text}</div>
      )}

      {burst && <Confetti key={burst.at} x={burst.x} y={burst.y} />}

      {asking && (
        <div className="pointer-events-auto absolute inset-0 z-30 grid place-items-center bg-black/60 px-6"
          onPointerDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) setAsking(undefined); }}
          onPointerUp={(e) => e.stopPropagation()}>
          <form
            className="w-full max-w-xs overflow-hidden rounded-2xl bg-gradient-to-br from-[#8b5dff] to-[#e0559b] p-3 text-center text-white"
            onSubmit={(e) => {
              e.preventDefault();
              const text = reply.trim();
              if (!text) return;
              void answer(asking, { text });
              setAsking(undefined);
            }}
          >
            <p className="px-2 pt-1 pb-3 text-[16px] font-extrabold">{String(asking.d.q ?? 'Ask me a question')}</p>
            <input
              autoFocus
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              maxLength={200}
              placeholder="Type something…"
              className="w-full rounded-xl bg-white px-3 py-3 text-center text-[15px] text-black outline-none"
            />
            <button type="submit" className="mt-3 w-full rounded-xl bg-white/20 py-2.5 font-bold">Send</button>
          </form>
        </div>
      )}
    </div>
  );
}

/** A quiz answered right: a small shower of paper. */
function Confetti({ x, y }: { x: number; y: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current; if (!host) return;
    for (let i = 0; i < 26; i++) {
      const c = document.createElement('span');
      c.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:8px;height:12px;border-radius:2px;background:hsl(${Math.random() * 360} 90% 60%)`;
      host.append(c);
      void c.animate(
        [{ transform: 'translate(0,0) rotate(0)' }, { transform: `translate(${(Math.random() - 0.5) * 320}px, ${-120 - Math.random() * 200}px) rotate(${Math.random() * 720}deg)`, opacity: 0 }],
        { duration: 1100 + Math.random() * 500, easing: 'cubic-bezier(.2,.8,.3,1)' },
      ).finished.then(() => c.remove());
    }
  }, [x, y]);
  return <div ref={ref} className="pointer-events-none absolute inset-0 z-20" />;
}
