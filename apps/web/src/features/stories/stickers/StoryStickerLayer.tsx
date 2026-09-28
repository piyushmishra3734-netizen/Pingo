import { useChat, type StickerAnswer, type StickerResult, type Story, type StorySticker } from '@pingo/core';
import { AtSign, ExternalLink, Hash, Image as ImageIcon, MapPin, Music2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { useStories } from '../StoryContext.js';
import { StickerView, stickerStyle } from './StickerView.js';

/** Stickers that only decorate: a tap on them is a tap on the story. */
const DECORATIVE = new Set<StorySticker['type']>(['text', 'emoji', 'clock']);
const ASKS = new Set<StorySticker['type']>(['poll', 'quiz', 'slider', 'countdown', 'question']);

/**
 * A story's stickers, drawn over its picture and alive.
 *
 * Placed in fractions of the frame and sized in its width, as the editor
 * places them, so a sticker lands where it was put. Taps on the interactive
 * ones are theirs; they never also advance the story.
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
  const { users } = useChat();
  const stickers = story.decor?.stickers ?? [];
  const host = useRef<HTMLDivElement>(null);
  const [results, setResults] = useState<StickerResult[]>([]);
  const [mine, setMine] = useState<Record<string, StickerAnswer>>({});
  /** Instagram's white bubble over a tapped sticker; `go` is what tapping it does. */
  const [tip, setTip] = useState<{ text: string; icon: ReactNode; x: number; y: number; go?: () => void }>();
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
      case 'men': {
        const who = users.find((u) => u.handle === d.text);
        const face = who?.avatarUrl ? <img src={who.avatarUrl} alt="" className="size-[22px] rounded-full object-cover" /> : <AtSign size={16} />;
        return setTip({ text: 'View profile', icon: face, go: () => onOpenProfile(d.text ?? ''), ...at });
      }
      case 'link': {
        const url = /^https?:\/\//.test(d.text ?? '') ? d.text! : `https://${d.text}`;
        return setTip({ text: `Open ${d.text}`, icon: <ExternalLink size={16} />, go: () => window.open(url, '_blank', 'noopener'), ...at });
      }
      case 'question': setReply(''); return setAsking(s);
      case 'loc': return setTip({ text: `See ${d.text} on the map`, icon: <MapPin size={16} />, go: () => window.open(`https://www.google.com/maps/search/${encodeURIComponent(d.text ?? '')}`, '_blank', 'noopener'), ...at });
      case 'tag': return setTip({ text: `See #${d.text}`, icon: <Hash size={16} />, ...at });
      case 'music': return setTip({ text: `${d.name} · Play full song`, icon: <Music2 size={16} />, ...at });
      case 'post': return setTip({ text: 'View post', icon: <ImageIcon size={16} />, ...(d.user ? { go: () => onOpenProfile(d.user!) } : {}), ...at });
    }
  };

  return (
    <div ref={host} className="pointer-events-none absolute inset-0 z-10">
      <div className="sk-layer" style={{ inset: 0 }}>
        {stickers.map((s) => (
          <div
            key={s.id}
            className="sk"
            style={{ ...stickerStyle(s), pointerEvents: DECORATIVE.has(s.type) ? 'none' : 'auto' }}
            // A tap here is the sticker's; the viewer does not also advance (see StoryViewer).
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

      {tip && (
        <button type="button"
          className={`absolute z-20 flex -translate-x-1/2 -translate-y-full items-center gap-1.5 rounded-[12px] bg-white px-3.5 py-[9px] text-[13.5px] font-bold whitespace-nowrap text-[#111] shadow-[0_8px_24px_-8px_rgba(0,0,0,.4)] ${tip.go ? 'pointer-events-auto' : 'pointer-events-none'}`}
          style={{ left: tip.x, top: tip.y, animation: 'sk-tip-pop .3s' }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={() => { const go = tip.go; setTip(undefined); go?.(); }}
        >{tip.icon}{tip.text}</button>
      )}

      {burst && <Confetti key={burst.at} x={burst.x} y={burst.y} />}

      {asking && (
        <div className="pointer-events-auto absolute inset-0 z-30 grid place-items-center bg-black/60 px-6"
          onPointerDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) setAsking(undefined); }}
          onPointerUp={(e) => e.stopPropagation()}>
          <form
            className="w-full max-w-xs overflow-hidden rounded-[16px] bg-sweep p-3 text-center text-white"
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
              className="w-full rounded-[12px] bg-white px-3 py-3 text-center text-[15px] text-black outline-none"
            />
            <button type="submit" className="mt-3 w-full rounded-[12px] bg-white/20 py-2.5 font-bold">Send</button>
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
