import type { StoryBoom } from '@pingo/core';
import { cn } from '@pingo/ui';
import { Ban, Gauge, Infinity as InfinityIcon, Repeat2, Target } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Boomerang, the stories sample's: a clip plays forwards and then back within
 * its trim. The way back is stepped by hand, frame by frame - a browser cannot
 * play a video in reverse - so no second, reversed file is needed.
 */
export const BOOMS: [StoryBoom, string, typeof Ban][] = [
  ['off', 'Off', Ban], ['echo', 'Echo', Target], ['classic', 'Classic', InfinityIcon], ['slowmo', 'Slowmo', Gauge], ['duo', 'Duo', Repeat2],
];

/**
 * Plays `video` as a Boomerang between `from` and `to` (fractions of the clip).
 * `echo`, when given, is a second copy that trails the first. Nothing happens
 * for `off`, or while `paused`.
 */
export function useBoomerang(video: RefObject<HTMLVideoElement | null>, boom: StoryBoom | undefined, from = 0, to = 1, paused = false, echo?: RefObject<HTMLVideoElement | null>) {
  useEffect(() => {
    const v = video.current;
    if (!v || !boom || boom === 'off' || paused) return;
    let back = false, raf = 0;
    const looped = v.loop;
    v.loop = false;
    v.playbackRate = boom === 'slowmo' ? 0.5 : 1;
    const loop = () => {
      const d = v.duration;
      if (d) {
        const a = from * d, b = to * d;
        if (boom === 'duo') v.playbackRate = 0.4 + 1.6 * Math.abs(Math.sin(performance.now() / 700));
        if (!back && v.currentTime >= b - 0.03) { back = true; v.pause(); }
        if (back) {
          v.currentTime = Math.max(a, v.currentTime - (boom === 'slowmo' ? 0.017 : 0.034));
          if (v.currentTime <= a + 0.02) { back = false; void v.play().catch(() => undefined); }
        } else if (v.currentTime < a) v.currentTime = a;
        const e = echo?.current;
        if (e && boom === 'echo') e.currentTime = Math.max(0, v.currentTime - 0.16);
      }
      raf = requestAnimationFrame(loop);
    };
    if (v.paused && !back) void v.play().catch(() => undefined);
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); v.playbackRate = 1; v.loop = looped; };
  }, [video, echo, boom, from, to, paused]);
}

/**
 * The editor's Boomerang screen: the clip, the five modes, and the trim bar
 * with frames along it. Opens on Classic, as Instagram's does.
 */
export function BoomerangMode({ src, boom, trim, onChange, onDone }: {
  src: string;
  boom: StoryBoom;
  trim: [number, number];
  onChange: (boom: StoryBoom, trim: [number, number]) => void;
  onDone: () => void;
}) {
  const v = useRef<HTMLVideoElement>(null);
  const echo = useRef<HTMLVideoElement>(null);
  const frames = useRef<HTMLDivElement>(null);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [name, setName] = useState<string>();
  const [head, setHead] = useState(0);
  useBoomerang(v, boom, trim[0], trim[1], false, echo);

  useEffect(() => {
    setName(BOOMS.find((b) => b[0] === boom)?.[1]);
    const t = window.setTimeout(() => setName(undefined), 1100);
    return () => window.clearTimeout(t);
  }, [boom]);

  // The play head, along the frames.
  useEffect(() => {
    let raf = 0;
    const tick = () => { const el = v.current; if (el?.duration) setHead(el.currentTime / el.duration); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Eight frames from the clip, for the bar.
  useEffect(() => {
    let dead = false;
    void (async () => {
      const t = document.createElement('video'); t.src = src; t.muted = true; t.preload = 'auto';
      await new Promise((r) => { t.onloadeddata = r; t.onerror = r; });
      const out: string[] = [];
      for (let i = 0; i < 8 && t.duration; i += 1) {
        t.currentTime = ((i + 0.5) / 8) * t.duration;
        await new Promise((r) => { t.onseeked = r; });
        const c = document.createElement('canvas'); c.width = 60; c.height = 100;
        c.getContext('2d')!.drawImage(t, 0, 0, 60, 100); out.push(c.toDataURL('image/jpeg', 0.6));
      }
      if (!dead) setThumbs(out);
    })();
    return () => { dead = true; };
  }, [src]);

  const drag = (k: 0 | 1) => (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = frames.current!.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
      const next: [number, number] = k ? [trim[0], Math.max(trim[0] + 0.15, f)] : [Math.min(trim[1] - 0.15, f), trim[1]];
      onChange(boom, next);
      if (v.current?.duration) v.current.currentTime = next[k] * v.current.duration;
    };
    const el = e.currentTarget as HTMLElement;
    el.onpointermove = move;
    el.onpointerup = () => { el.onpointermove = null; };
  };

  return (
    <div data-chrome className="absolute inset-0 z-40 text-white" style={{ background: 'linear-gradient(#b7c4cf, #6c757d)', animation: 'bm-fade .2s' }}
      onPointerDown={(e) => e.stopPropagation()} onPointerMove={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
      <style>{'@keyframes bm-fade { from { opacity: 0 } }'}</style>
      <button type="button" onClick={onDone} className="absolute top-4 right-4 z-[2] text-[17px] font-bold">Done</button>
      <div className="absolute inset-x-0 top-[22%] h-[38%] overflow-hidden">
        <video ref={v} src={src} muted playsInline autoPlay className="absolute inset-0 size-full object-cover" />
        {boom === 'echo' && <video ref={echo} src={src} muted playsInline autoPlay className="absolute inset-0 size-full object-cover opacity-45 mix-blend-screen" />}
      </div>
      <div className={cn('absolute inset-x-0 top-[40%] z-[2] text-center text-[30px] font-light transition-opacity duration-300 [text-shadow:0_1px_8px_rgba(0,0,0,.25)]', name ? 'opacity-100' : 'opacity-0')}>{name}</div>
      <div className="absolute inset-x-0 bottom-[110px] flex justify-center gap-[18px]">
        {BOOMS.map(([k, label, Icon]) => (
          <button key={k} type="button" aria-label={label} onClick={() => onChange(k, trim)}
            className={cn('grid size-[52px] place-items-center rounded-full transition-transform duration-200 [&>svg]:size-[22px]', k === boom ? 'scale-[1.08] bg-white text-[#e0559b]' : 'bg-[rgba(40,40,44,.75)]')}>
            <Icon />
          </button>
        ))}
      </div>
      <div className="absolute inset-x-3.5 bottom-[26px] h-16 rounded-[10px] bg-white px-4 py-1">
        <div ref={frames} className="relative flex h-full overflow-hidden rounded-[4px]">
          {thumbs.map((t, i) => <img key={i} src={t} alt="" className="h-full min-w-0 flex-1 object-cover" />)}
          <span className="pointer-events-none absolute inset-y-0 left-0 bg-white/75" style={{ width: `${trim[0] * 100}%` }} />
          <span className="pointer-events-none absolute inset-y-0 right-0 bg-white/75" style={{ width: `${(1 - trim[1]) * 100}%` }} />
          <span className="pointer-events-none absolute inset-y-[-4px] w-1 -ml-0.5 rounded-sm bg-white shadow-[0_0_4px_rgba(0,0,0,.5)]" style={{ left: `${head * 100}%` }} />
        </div>
        {([0, 1] as const).map((k) => (
          <span key={k} onPointerDown={drag(k)} className="absolute inset-y-1 grid w-4 cursor-ew-resize touch-none place-items-center after:h-[22px] after:w-[3px] after:rounded-sm after:bg-[#111] after:content-['']"
            // The bar's frames sit inside 16px of padding; each handle hugs its end of the kept part.
            style={{ left: `calc(${k ? 16 : 0}px + (100% - 32px) * ${trim[k]})` }} />
        ))}
      </div>
    </div>
  );
}
