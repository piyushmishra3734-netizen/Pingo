import { useChat, useProfile, type StoryAudience, type StoryAudioDraft, type StoryDecor, type StoryDraft, type StorySticker } from '@pingo/core';
import { cn } from '@pingo/ui';
import {
  AlignCenter, AlignLeft, AlignRight, ALargeSmall, AtSign, Baseline, Brush, ChevronDown, ChevronLeft, CircleCheck, Circle,
  Download, Ellipsis, Eraser, Highlighter, Link as LinkIcon, MapPin, Music2, Pause, PenLine, Play, Search, Sparkles, Star,
  Sticker, Type, Undo2, ArrowRight, Zap, AlarmClock, Clock, Hash, Timer,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Overlay } from '../../components/Overlay.js';
import { cutToWav, decodeSound } from './story-audio.js';
import { FONTS, STYLE_COUNT, StickerView, TEXT_ANIMS, TEXT_COLORS, TextSticker, stickerStyle, type TextData } from './stickers/StickerView.js';
import './stickers/stickers.css';
import { SendTo, drawStickers, noteSends } from '../camera/snap/send-to.js';
import { Blue, ClipSheet, Field, MusicSheet, Panel, type Song } from '../music/sheets.js';

/**
 * Making one story, Instagram's way: the picture fills the frame, the tools sit
 * down the right with their names showing and then fold away, and it goes to
 * your story or your close friends from the bar at the bottom.
 *
 * ## What is kept as pixels and what as data
 *
 * A photo leaves with its filter and its drawing baked in - those are the
 * picture. Stickers leave as data (`StoryDecor`), because a poll is only a poll
 * if it can still be voted on. A video cannot be re-encoded in a browser, so its
 * filter travels as data too and drawing is offered on photos only.
 */

const W = 1080, H = 1920;
const FILTERS: [string, string][] = [
  ['Normal', ''], ['Paris', 'brightness(1.08) contrast(.94) saturate(1.1)'], ['Oslo', 'saturate(.9) brightness(1.1) hue-rotate(-6deg)'],
  ['Lagos', 'sepia(.25) saturate(1.45) contrast(1.05)'], ['Melbourne', 'sepia(.18) brightness(1.06) contrast(.95)'], ['Jakarta', 'contrast(1.25) saturate(1.25)'],
  ['Abu Dhabi', 'sepia(.35) saturate(1.2) hue-rotate(-10deg) brightness(1.05)'], ['Buenos Aires', 'saturate(1.35) contrast(1.1) hue-rotate(5deg)'],
  ['New York', 'grayscale(1) contrast(1.2)'], ['Jaipur', 'sepia(.3) saturate(1.6) hue-rotate(-15deg)'], ['Cairo', 'sepia(.5) contrast(1.05) brightness(.97)'],
  ['Tokyo', 'saturate(.75) contrast(1.15) hue-rotate(10deg) brightness(1.05)'], ['Rio de Janeiro', 'saturate(1.5) brightness(1.08) hue-rotate(-5deg)'],
];
const SLIDER_EMOJI = ['😍', '🔥', '😂', '😮', '💯', '🥳'];
const DRAW_COLORS = ['#ffffff', '#000000', '#0a84ff', '#34c759', '#ffcc00', '#ff9500', '#ff3b30', '#e0559b', '#bf5af2'];
export type Brush = 'pen' | 'marker' | 'neon' | 'eraser';
export interface Stroke { brush: Brush; color: string; size: number; p: [number, number][] }
type SheetKind = 'stickers' | 'music' | 'clip' | 'loc' | 'mention' | 'link' | 'tag' | 'countdown' | 'effects' | 'share' | 'discard' | 'more';

const uid = () => Math.random().toString(36).slice(2, 8);

export interface StoryEditorProps {
  src: string;
  kind: 'photo' | 'video';
  /** The file itself, for a video (which leaves as it came). */
  media: Blob;
  /** Stickers to start with - a shared post arrives as one. */
  initialStickers?: StorySticker[];
  /** A background behind the media, for a shared post. */
  bg?: string;
  onClose: () => void;
  onPost: (draft: StoryDraft) => Promise<void>;
  /** A song already chosen in the camera. */
  initialSong?: Song;
  /**
   * Opened from the camera: a chat gets a Ping - a picture with a view limit -
   * rather than an ordinary photo, and one chat may already be chosen.
   */
  ping?: { lockedChatId?: string };
}

export function StoryEditor({ src, kind, media, initialStickers = [], bg, onClose, onPost, initialSong, ping }: StoryEditorProps) {
  const { users, service: chat } = useChat();
  const { profile } = useProfile();
  const stage = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const ink = useRef<HTMLCanvasElement>(null);
  const mediaEl = useRef<HTMLImageElement & HTMLVideoElement>(null);

  const [stickers, setStickers] = useState<StorySticker[]>(() => initialStickers.map((s) => ({ ...s })));
  const [filterI, setFilterI] = useState(0);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [caption, setCaption] = useState('');
  const [song, setSong] = useState<Song | undefined>(initialSong);
  /** A Ping's view limit: once, twice, or as often as they like. */
  const [views, setViews] = useState<1 | 2 | null>(2);
  const [mode, setMode] = useState<'none' | 'text' | 'draw'>('none');
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [rail, setRail] = useState<'labels' | 'icons' | 'open'>('labels');
  const [fname, setFname] = useState<string>();
  const [dragging, setDragging] = useState<{ hot: boolean; gv: boolean; gh: boolean }>();
  const [editingText, setEditingText] = useState<StorySticker>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const player = useRef<HTMLAudioElement | undefined>(undefined);

  // Instagram shows the tools' names first, then folds them down to icons.
  useEffect(() => { const t = window.setTimeout(() => setRail((r) => (r === 'labels' ? 'icons' : r)), 2800); return () => window.clearTimeout(t); }, []);
  useEffect(() => () => player.current?.pause(), []);
  useEffect(() => { if (!fname) return; const t = window.setTimeout(() => setFname(undefined), 900); return () => window.clearTimeout(t); }, [fname, filterI]);

  const filter = FILTERS[filterI]![1];

  // ---- stickers --------------------------------------------------------------

  /** New stickers are measured once drawn, then moved to where they cover the least. */
  const placing = useRef(new Set<string>());
  const add = useCallback((s: Omit<StorySticker, 'id' | 'x' | 'y' | 's' | 'r'> & Partial<StorySticker>) => {
    const next = { id: uid(), x: 0.5, y: 0.45, s: 1, r: 0, ...s } as StorySticker;
    if (s.y === undefined) placing.current.add(next.id);
    setStickers((prev) => [...prev, next]);
  }, []);
  useLayoutEffect(() => {
    if (!placing.current.size || !layer.current) return;
    const L = layer.current.getBoundingClientRect();
    const moves: Record<string, [number, number]> = {};
    for (const id of placing.current) {
      const el = layer.current.querySelector<HTMLElement>(`[data-stk="${id}"]`); if (!el) continue;
      const others = [...layer.current.querySelectorAll<HTMLElement>('[data-stk]')].filter((o) => o !== el).map((o) => o.getBoundingClientRect());
      const spots: [number, number][] = [[.5, .45], [.5, .25], [.5, .65], [.5, .82], [.3, .35], [.7, .35], [.3, .58], [.7, .58], [.5, .12], [.3, .8], [.7, .8]];
      let best: [number, number] = [.5, .45], bestCover = Infinity;
      for (const [x, y] of spots) {
        el.style.left = `${x * 100}%`; el.style.top = `${y * 100}%`;
        const r = el.getBoundingClientRect();
        const inside = r.left >= L.left - 4 && r.right <= L.right + 4 && r.top >= L.top + 40 && r.bottom <= L.bottom - 40;
        const cover = others.reduce((a, o) => a + Math.max(0, Math.min(r.right, o.right) - Math.max(r.left, o.left)) * Math.max(0, Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top)), 0) + (inside ? 0 : 1e6);
        if (cover < bestCover) { bestCover = cover; best = [x, y]; }
        if (cover === 0) break;
      }
      moves[id] = best;
    }
    placing.current.clear();
    setStickers((prev) => prev.map((x) => (moves[x.id] ? { ...x, x: moves[x.id]![0], y: moves[x.id]![1] } : x)));
  }, [stickers]);
  const update = (id: string, patch: Partial<StorySticker>) => setStickers((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const remove = (id: string) => setStickers((prev) => prev.filter((s) => s.id !== id));

  const tapSticker = (s: StorySticker, target: HTMLElement) => {
    if (s.type === 'text') { setEditingText(s); setMode('text'); return; }
    const n = STYLE_COUNT[s.type];
    if (n) return update(s.id, { style: ((s.style ?? 0) + 1) % n });
    if (s.type === 'slider') return update(s.id, { d: { ...s.d, emoji: SLIDER_EMOJI[(SLIDER_EMOJI.indexOf(String(s.d.emoji)) + 1) % SLIDER_EMOJI.length] } });
    if (s.type === 'quiz') { const o = target.closest('[data-i]') as HTMLElement | null; if (o && !target.closest('[contenteditable]')) update(s.id, { d: { ...s.d, right: Number(o.dataset.i) } }); return; }
    if (s.type === 'music') return setSheet('clip');
    if (s.type === 'countdown' && !target.closest('[contenteditable]')) { countdownFor.current = s; setSheet('countdown'); }
  };
  const countdownFor = useRef<StorySticker | undefined>(undefined);

  // ---- one pointer surface: drag, pinch and twist, the bin, swipe filters, tap to type ----
  const g = useRef<{
    id?: string; el?: HTMLElement; pts: Map<number, { x: number; y: number }>; x0: number; y0: number; sx: number; sy: number;
    t: number; moved: boolean; editable?: boolean; pinch?: { d: number; a: number; s: number; r: number }; hot?: boolean; dx?: number;
  } | undefined>(undefined);
  const binRef = useRef<HTMLDivElement>(null);

  const onDown = (e: React.PointerEvent) => {
    if (mode !== 'none' || sheet) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-chrome]')) return;
    const stk = target.closest('[data-stk]') as HTMLElement | null;
    const cur = g.current;
    if (cur?.id && cur.pts.size === 1) {
      // A second finger anywhere turns the drag into pinch and twist.
      cur.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...cur.pts.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const s = stickers.find((x) => x.id === cur.id)!;
      cur.pinch = { d: Math.hypot(b.x - a.x, b.y - a.y), a: Math.atan2(b.y - a.y, b.x - a.x), s: s.s, r: s.r };
      return;
    }
    if (stk) {
      const s = stickers.find((x) => x.id === stk.dataset.stk)!;
      const editable = !!target.closest('[contenteditable="true"]');
      if (!editable) e.preventDefault();
      g.current = { id: s.id, el: stk, pts: new Map([[e.pointerId, { x: e.clientX, y: e.clientY }]]), x0: e.clientX, y0: e.clientY, sx: s.x, sy: s.y, t: performance.now(), moved: false, editable };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    g.current = { pts: new Map([[e.pointerId, { x: e.clientX, y: e.clientY }]]), x0: e.clientX, y0: e.clientY, sx: 0, sy: 0, t: performance.now(), moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const cur = g.current; if (!cur || !cur.pts.has(e.pointerId)) return;
    cur.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!cur.id) { cur.dx = e.clientX - cur.x0; if (Math.abs(cur.dx) > 12) setFname(FILTERS[wrap(filterI + Math.round(-cur.dx / 90))]![0]); return; }
    const s = stickers.find((x) => x.id === cur.id); const r = stage.current?.getBoundingClientRect(); if (!s || !r) return;
    if (cur.pinch && cur.pts.size === 2) {
      const [a, b] = [...cur.pts.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const next = { s: Math.max(0.3, Math.min(4, cur.pinch.s * Math.hypot(b.x - a.x, b.y - a.y) / cur.pinch.d)), r: cur.pinch.r + ((Math.atan2(b.y - a.y, b.x - a.x) - cur.pinch.a) * 180) / Math.PI };
      cur.moved = true; update(s.id, next); return;
    }
    const dx = e.clientX - cur.x0, dy = e.clientY - cur.y0;
    if (!cur.moved && Math.hypot(dx, dy) < 6) return;
    if (!cur.moved && cur.editable) (document.activeElement as HTMLElement | null)?.blur();
    cur.moved = true;
    let x = cur.sx + dx / r.width, y = cur.sy + dy / r.height;
    const gv = Math.abs(x - 0.5) < 0.02, gh = Math.abs(y - 0.5) < 0.02;
    if (gv) x = 0.5; if (gh) y = 0.5;
    const bin = binRef.current?.getBoundingClientRect();
    const hot = !!bin && Math.hypot(e.clientX - (bin.left + bin.width / 2), e.clientY - (bin.top + bin.height / 2)) < 50;
    cur.hot = hot;
    setDragging({ hot, gv, gh });
    update(s.id, { x, y });
  };
  const onUp = (e: React.PointerEvent) => {
    const cur = g.current; if (!cur || !cur.pts.has(e.pointerId)) return;
    cur.pts.delete(e.pointerId);
    if (cur.pts.size) { cur.pinch = undefined; const [p] = [...cur.pts.values()] as [{ x: number; y: number }]; const s = stickers.find((x) => x.id === cur.id); cur.x0 = p.x; cur.y0 = p.y; cur.sx = s?.x ?? 0; cur.sy = s?.y ?? 0; return; }
    g.current = undefined; setDragging(undefined);
    if (cur.id) {
      if (cur.hot) { remove(cur.id); return; }
      const s = stickers.find((x) => x.id === cur.id);
      if (s && !cur.moved && performance.now() - cur.t < 350) tapSticker(s, e.target as HTMLElement);
      return;
    }
    if (Math.abs(cur.dx ?? 0) > 12) { setFilterI((i) => wrap(i + Math.round(-(cur.dx ?? 0) / 90))); return; }
    if (performance.now() - cur.t < 400) { setEditingText(undefined); setMode('text'); } // tap anywhere to type
  };
  const wrap = (i: number) => ((i % FILTERS.length) + FILTERS.length) % FILTERS.length;
  useEffect(() => { if (filterI) setFname(FILTERS[filterI]![0]); }, [filterI]);

  // ---- drawing (photos) --------------------------------------------------------
  const redraw = useCallback((list: Stroke[]) => {
    const c = ink.current; if (!c) return; const g2 = c.getContext('2d')!;
    g2.clearRect(0, 0, W, H);
    for (const s of list) {
      g2.save(); g2.lineJoin = 'round'; g2.lineCap = s.brush === 'marker' ? 'square' : 'round';
      g2.lineWidth = s.size * (s.brush === 'marker' ? 2.2 : 1); g2.strokeStyle = s.color;
      if (s.brush === 'marker') g2.globalAlpha = 0.5;
      if (s.brush === 'eraser') g2.globalCompositeOperation = 'destination-out';
      if (s.brush === 'neon') { g2.shadowColor = s.color; g2.shadowBlur = 40; }
      const path = () => { g2.beginPath(); s.p.forEach(([x, y], i) => (i ? g2.lineTo(x, y) : g2.moveTo(x, y))); g2.stroke(); };
      path();
      if (s.brush === 'neon') { g2.shadowBlur = 0; g2.strokeStyle = '#fff'; g2.lineWidth = s.size * 0.35; path(); }
      g2.restore();
    }
  }, []);
  useEffect(() => redraw(strokes), [strokes, redraw]);

  // ---- music: JioSaavn through PINGO's own worker ------------------------------
  const playSong = (s: Song) => {
    const a = (player.current ??= new Audio()); a.crossOrigin = 'anonymous'; a.loop = false;
    if (!a.src.endsWith(s.url)) a.src = s.url;
    a.currentTime = s.start; void a.play().catch(() => undefined);
    a.ontimeupdate = () => { if (a.currentTime > s.start + 15) a.currentTime = s.start; };
  };
  const chooseSong = (s: Song) => {
    setSong(s);
    setStickers((prev) => [...prev.filter((x) => x.type !== 'music')]);
    add({ type: 'music', y: 0.72, d: { name: s.name, artist: s.artist, img: s.img } });
    playSong(s);
    setSheet('clip');
  };

  // ---- leaving ---------------------------------------------------------------------
  const exportPhoto = async (withStickers = false): Promise<Blob> => {
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g2 = c.getContext('2d')!;
    if (bg) {
      const colours = bg.match(/rgb\([^)]*\)|#[0-9a-f]{3,8}/gi) ?? ['#3a3a40', '#1c1c1e'];
      const grad = g2.createLinearGradient(0, 0, W * 0.4, H); grad.addColorStop(0, colours[0]!); grad.addColorStop(1, colours[1] ?? colours[0]!);
      g2.fillStyle = grad; g2.fillRect(0, 0, W, H);
    } else {
      const img = mediaEl.current as HTMLImageElement;
      if ('filter' in g2 && filter) g2.filter = filter;
      const k = Math.max(W / img.naturalWidth, H / img.naturalHeight);
      g2.drawImage(img, (W - img.naturalWidth * k) / 2, (H - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
      g2.filter = 'none';
    }
    if (ink.current && strokes.length) g2.drawImage(ink.current, 0, 0);
    if (withStickers) await drawStickers(g2, stickers);
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not save the picture.'))), 'image/jpeg', 0.9));
  };

  const post = async (audience: StoryAudience, audienceUserIds?: string[]) => {
    if (busy) return;
    setBusy('Sharing…'); setError(undefined);
    try {
      player.current?.pause();
      const file = kind === 'photo' ? await exportPhoto() : media;
      let audio: StoryAudioDraft[] | undefined;
      if (song) {
        setBusy('Adding the song…');
        const bytes = await (await fetch(song.url)).blob();
        const sound = await decodeSound(new File([bytes], song.name, { type: bytes.type || 'audio/mp4' }));
        audio = [{ blob: cutToWav(sound.buffer, song.start, Math.min(sound.buffer.duration, song.start + 15)), at: 0, duration: 15, volume: 1 }];
      }
      const decor: StoryDecor = { v: 1, stickers, ...(kind === 'video' && filter ? { filter } : {}) };
      setBusy('Sharing…');
      await onPost({
        media: file, kind, audience, decor,
        ...(audienceUserIds ? { audienceUserIds } : {}),
        ...(caption.trim() ? { caption: caption.trim() } : {}),
        ...(audio ? { audio } : {}),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not share that.');
      setBusy(undefined);
    }
  };

  const sendTo = async (chatIds: string[], story: false | 'friends' | 'close') => {
    if (chatIds.length) {
      setBusy('Sending…'); setError(undefined);
      try {
        if (kind === 'photo') {
          const image = await exportPhoto(true);
          await Promise.all(chatIds.map((conversationId) => chat.sendMessage(
            ping ? { conversationId, body: 'Ping', ping: { image, views } } : { conversationId, body: '', photo: { image } },
          )));
        } else {
          const file = new File([media], `story.${media.type.includes('mp4') ? 'mp4' : 'webm'}`, { type: media.type || 'video/mp4' });
          await Promise.all(chatIds.map((conversationId) => chat.sendMessage({ conversationId, body: '', document: { file } })));
        }
        noteSends(chatIds);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That did not send.'); setBusy(undefined); return;
      }
    }
    if (story) await post(story);
    else { setBusy(undefined); player.current?.pause(); onClose(); }
  };

  const download = async () => {
    try {
      const b = kind === 'photo' ? await exportPhoto() : media;
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `pingo-story.${kind === 'photo' ? 'jpg' : 'mp4'}`; a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch { /* nothing to save */ }
  };

  const railTools: [string, ReactNode, () => void][] = [
    ['Text', <Type key="t" />, () => { setEditingText(undefined); setMode('text'); }],
    ['Stickers', <Sticker key="s" />, () => setSheet('stickers')],
    ['Audio', <Music2 key="a" />, () => setSheet('music')],
    ['Effect', <Sparkles key="e" />, () => setSheet('effects')],
  ];
  const moreTools: [string, ReactNode, () => void][] = [
    ['Mention', <AtSign key="m" />, () => setSheet('mention')],
    ...(kind === 'photo' ? [['Draw', <Brush key="d" />, () => setMode('draw')] as [string, ReactNode, () => void]] : []),
    ...(ping && kind === 'photo' ? [[views === null ? 'Views: ∞' : `Views: ${views}`, <Timer key="v" />, () => setViews((v) => (v === 1 ? 2 : v === 2 ? null : 1))] as [string, ReactNode, () => void]] : []),
    ['Download', <Download key="dl" />, () => void download()],
    ['More', <Ellipsis key="mo" />, () => setSheet('more')],
  ];

  const hideChrome = mode !== 'none' || !!dragging;

  return (
    <Overlay onDismiss={() => setSheet('discard')}>
      <div className="fixed inset-0 z-1000 flex flex-col bg-black text-white select-none" role="dialog" aria-modal="true" aria-label="Story editor"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} style={{ touchAction: 'none' }}>
        {/* the frame: 9:16, as large as the screen allows */}
        <div className="relative min-h-0 flex-1">
          <div ref={stage} className="absolute top-0 left-1/2 aspect-[9/16] max-h-full w-full max-w-[calc((100dvh-76px)*9/16)] -translate-x-1/2 overflow-hidden rounded-b-2xl" style={{ background: bg ?? '#111' }}>
            {kind === 'video'
              ? <video ref={mediaEl} src={src} className="absolute inset-0 size-full object-cover" style={{ filter }} autoPlay loop muted playsInline />
              : !bg && <img ref={mediaEl} src={src} alt="" className="absolute inset-0 size-full object-cover" style={{ filter }} draggable={false} crossOrigin="anonymous" />}
            <canvas ref={ink} width={W} height={H} className="pointer-events-none absolute inset-0 size-full" />
            <div ref={layer} className="sk-layer inset-0">
              {stickers.map((s) => (
                <div key={s.id} data-stk={s.id} className="sk" style={{ ...stickerStyle(s, dragging?.hot && g.current?.id === s.id ? s.s * 0.45 : s.s), opacity: dragging?.hot && g.current?.id === s.id ? 0.55 : 1, visibility: editingText?.id === s.id ? 'hidden' : undefined }}>
                  <StickerView sticker={s} mode="edit" onEditField={(f, text) => {
                    if (!text) return;
                    update(s.id, { d: f === 'q' ? { ...s.d, q: text } : { ...s.d, opts: ((s.d.opts as string[]) ?? []).map((o, i) => (`o${i}` === f ? text : o)) } });
                  }} />
                </div>
              ))}
            </div>
            {fname && <div className="pointer-events-none absolute inset-x-0 top-[40%] text-center text-3xl font-semibold drop-shadow-lg">{fname}</div>}
            {dragging?.gv && <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-[#3ea6ff]" />}
            {dragging?.gh && <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-[#3ea6ff]" />}
            <label data-chrome className={cn('absolute right-[70px] bottom-3.5 left-3.5 z-10 transition-opacity', hideChrome && 'pointer-events-none opacity-0')}>
              <input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={500} placeholder="Add a caption…"
                className="w-full bg-transparent text-[14px] text-white outline-none placeholder:text-white/85 [text-shadow:0_1px_4px_rgba(0,0,0,.6)]" />
            </label>
          </div>

          {/* the bin, while something is being dragged */}
          <div ref={binRef} className={cn('pointer-events-none absolute bottom-6 left-1/2 grid size-13 -translate-x-1/2 place-items-center rounded-full ring-2 ring-white/70 transition-all',
            dragging ? 'scale-100 opacity-100' : 'scale-50 opacity-0', dragging?.hot ? 'scale-125 bg-[#ff3040]' : 'bg-black/40')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
          </div>

          {/* back, and the rail */}
          <div data-chrome className={cn('absolute top-3 left-3 transition-opacity', hideChrome && 'pointer-events-none opacity-0')}>
            <button type="button" aria-label="Back" onClick={() => setSheet('discard')} className="grid size-10 place-items-center rounded-full bg-black/35"><ChevronLeft size={22} /></button>
          </div>
          <div data-chrome className={cn('absolute top-3 right-2.5 flex flex-col items-end gap-2 transition-opacity', hideChrome && 'pointer-events-none opacity-0')}>
            {[...railTools, ...(rail !== 'icons' ? moreTools : [])].map(([label, icon, act]) => (
              <button key={label} type="button" onClick={() => { act(); setRail('icons'); }} className="flex items-center gap-2.5 text-[13.5px] font-semibold [text-shadow:0_1px_3px_rgba(0,0,0,.75)]">
                <span className={cn('transition-all duration-300', rail === 'icons' ? 'translate-x-2 opacity-0' : 'opacity-100')}>{label}</span>
                <span className="grid size-[38px] place-items-center rounded-full bg-black/35 [&>svg]:size-5">{icon}</span>
              </button>
            ))}
            <button type="button" aria-label="More tools" onClick={() => setRail((r) => (r === 'icons' ? 'open' : 'icons'))} className="grid h-[22px] w-[30px] place-items-center rounded-full bg-black/35">
              <ChevronDown size={16} className={cn('transition-transform', rail !== 'icons' && 'rotate-180')} />
            </button>
          </div>

        </div>

        {/* where it goes */}
        <div data-chrome className={cn('flex h-[76px] shrink-0 items-center gap-2 px-3 pb-2 transition-opacity', hideChrome && 'pointer-events-none opacity-0')}>
          <button type="button" disabled={!!busy} onClick={() => void post('friends')} className="flex h-[46px] min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-[#262626] px-2.5 text-[14px] font-bold whitespace-nowrap">
            {profile?.avatarUrl ? <img src={profile.avatarUrl} alt="" className="size-[26px] shrink-0 rounded-full object-cover" /> : null}Your story
          </button>
          <button type="button" disabled={!!busy} onClick={() => void post('close')} className="flex h-[46px] min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-[#262626] px-2.5 text-[14px] font-bold whitespace-nowrap">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#1fc15e]"><Star size={13} fill="#fff" /></span>Close Friends
          </button>
          <button type="button" aria-label="More sharing options" disabled={!!busy} onClick={() => setSheet('share')} className="grid size-[46px] shrink-0 place-items-center rounded-full bg-white text-black"><ArrowRight size={22} /></button>
        </div>

        {busy && <div className="absolute inset-0 z-50 grid place-items-center bg-black/55"><div className="flex flex-col items-center gap-3"><span className="size-9 animate-spin rounded-full border-3 border-white/25 border-t-white" /><span className="text-[14px] font-semibold">{busy}</span></div></div>}
        {error && <p role="alert" className="absolute inset-x-4 bottom-24 z-40 rounded-xl bg-[#ff3040] px-4 py-3 text-[14px] font-semibold">{error}</p>}

        {mode === 'text' && (
          <TextMode
            initial={editingText ? (editingText.d as unknown as TextData) : undefined}
            onDone={(d) => {
              const was = editingText; setEditingText(undefined); setMode('none');
              if (was) { if (!d.text.trim()) remove(was.id); else update(was.id, { d: d as unknown as Record<string, unknown> }); return; }
              if (d.text.trim()) add({ type: 'text', y: 0.42, d: d as unknown as Record<string, unknown> });
            }}
            onLocation={() => setSheet('loc')}
          />
        )}
        {mode === 'draw' && <DrawMode ink={ink} stage={stage} strokes={strokes} setStrokes={setStrokes} onDone={() => setMode('none')} />}

        {sheet && (
          <EditorSheets
            kind={sheet} setKind={setSheet} kindOfMedia={kind} filterI={filterI} setFilterI={setFilterI} src={src}
            users={users} add={add} song={song} setSong={(s) => { setSong(s); if (s) playSong(s); }} chooseSong={chooseSong}
            ping={ping ? { views: kind === 'photo' ? views : undefined, ...(ping.lockedChatId ? { locked: ping.lockedChatId } : {}) } : undefined}
            countdown={countdownFor.current} onCountdown={(d) => { const c = countdownFor.current; countdownFor.current = undefined; if (c) update(c.id, { d }); else add({ type: 'countdown', y: 0.3, d }); }}
            onPost={post} onDiscard={() => { player.current?.pause(); onClose(); }} onSend={sendTo}
            onPreview={(s) => { if (!s) player.current?.pause(); else playSong(s); }}
          />
        )}
      </div>
    </Overlay>
  );
}

// ---------------------------------------------------------------------------------
// text (Instagram's text tool)
export function TextMode({ initial, onDone, onLocation }: { initial?: TextData; onDone: (d: TextData) => void; onLocation: () => void }) {
  const [d, setD] = useState<TextData>(initial ?? { text: '', font: 'classic', color: '#ffffff', bg: 'none', align: 'center', size: 30, anim: 'none' });
  const [colors, setColors] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const size = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current; if (!el) return;
    el.innerText = d.text;
    el.focus({ preventScroll: true });
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); getSelection()?.removeAllRanges(); getSelection()?.addRange(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const set = (p: Partial<TextData>) => { setD((x) => ({ ...x, ...p })); box.current?.focus({ preventScroll: true }); };
  const AlignIcon = d.align === 'left' ? AlignLeft : d.align === 'right' ? AlignRight : AlignCenter;
  return (
    <div data-chrome className="absolute inset-0 z-30 bg-black/50" onPointerDown={(e) => { if (e.target === e.currentTarget) onDone(d); }}>
      <div className="absolute inset-x-3 top-3 flex items-center justify-center gap-3">
        <button type="button" aria-label="Alignment" onClick={() => set({ align: d.align === 'center' ? 'left' : d.align === 'left' ? 'right' : 'center' })} className="grid size-9 place-items-center rounded-full"><AlignIcon size={20} /></button>
        <button type="button" aria-label="Colour" onClick={() => setColors((c) => !c)} className="grid size-9 place-items-center"><span className="size-7 rounded-full bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)] ring-2 ring-white" /></button>
        <button type="button" aria-label="Animate" onClick={() => set({ anim: TEXT_ANIMS[(TEXT_ANIMS.indexOf(d.anim as never) + 1) % TEXT_ANIMS.length]! })} className={cn('grid size-9 place-items-center rounded-full', d.anim !== 'none' && 'bg-white text-black')}><ALargeSmall size={20} /></button>
        <button type="button" aria-label="Background" onClick={() => set({ bg: d.bg === 'none' ? 'solid' : d.bg === 'solid' ? 'soft' : 'none' })} className={cn('grid size-9 place-items-center rounded-full', d.bg !== 'none' && 'bg-white text-black')}><Baseline size={20} /></button>
        <button type="button" onClick={() => onDone(d)} className="absolute right-0 text-[16px] font-bold">Done</button>
      </div>
      <div ref={size} className="absolute top-24 left-3.5 h-56 w-7 touch-none" onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const mv = (ev: { clientY: number }) => { const r = size.current!.getBoundingClientRect(); const k = 1 - Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)); setD((x) => ({ ...x, size: Math.round(16 + k * 56) })); };
        mv(e); e.currentTarget.onpointermove = mv; e.currentTarget.onpointerup = (ev) => { (ev.currentTarget as HTMLElement).onpointermove = null; box.current?.focus({ preventScroll: true }); };
      }}>
        <span className="absolute inset-0 rounded-sm bg-white/55 [clip-path:polygon(0_0,100%_0,58%_100%,42%_100%)]" />
        <span className="absolute left-1/2 size-[22px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow" style={{ top: `${(1 - (d.size - 16) / 56) * 100}%` }} />
      </div>
      <div className="sk-layer absolute inset-x-12 top-[36%] flex justify-center" style={{ containerType: 'normal' }}>
        <div style={{ fontSize: d.size }}>
          <TextSticker d={{ ...d, size: d.size }} editable innerRef={box} onInput={(text) => setD((x) => ({ ...x, text }))} />
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-3.5 flex flex-col gap-3">
        <p className="text-center text-[12.5px] font-semibold opacity-85">{FONTS.find((f) => f.k === d.font)?.name}{d.anim !== 'none' ? ` · ${d.anim}` : ''}</p>
        {colors ? (
          <div className="flex gap-2.5 overflow-x-auto px-3">
            {TEXT_COLORS.map((c) => <button key={c} type="button" aria-label={c} onClick={() => set({ color: c })} className="size-[30px] shrink-0 rounded-full ring-2 ring-white" style={{ background: c }} />)}
          </div>
        ) : (
          <div className="flex gap-2.5 overflow-x-auto px-3">
            {FONTS.map((f) => (
              <button key={f.k} type="button" onClick={() => set({ font: f.k })}
                className={cn('grid size-11 shrink-0 place-items-center rounded-full text-[17px] ring-1 ring-white/25', d.font === f.k ? 'bg-white text-[#e0559b]' : 'bg-black/45')}>
                <span className={`sk-f-${f.k}`} style={{ textShadow: 'none' }}>Aa</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex justify-center gap-8 text-[15px] font-semibold">
          <button type="button" onClick={() => set({ text: `${d.text}${d.text ? ' ' : ''}@` })} className="inline-flex items-center gap-1.5"><AtSign size={16} />Mention</button>
          <button type="button" onClick={() => { onDone(d); onLocation(); }} className="inline-flex items-center gap-1.5"><MapPin size={16} />Location</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------
// draw
export function DrawMode({ ink, stage, strokes, setStrokes, onDone }: {
  ink: React.RefObject<HTMLCanvasElement | null>; stage: React.RefObject<HTMLDivElement | null>;
  strokes: Stroke[]; setStrokes: React.Dispatch<React.SetStateAction<Stroke[]>>; onDone: () => void;
}) {
  const [brush, setBrush] = useState<Brush>('pen');
  const [color, setColor] = useState('#ffffff');
  const [size, setSize] = useState(10);
  const sz = useRef<HTMLDivElement>(null);
  const r = stage.current?.getBoundingClientRect();
  const cur = useRef<Stroke | undefined>(undefined);
  const at = (e: { clientX: number; clientY: number }): [number, number] => { const b = stage.current!.getBoundingClientRect(); return [((e.clientX - b.left) / b.width) * W, ((e.clientY - b.top) / b.height) * H]; };
  return (
    <div data-chrome className="absolute inset-0 z-30">
      {r && (
        <div className="absolute touch-none" style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); cur.current = { brush, color, size: size * 3, p: [at(e)] }; setStrokes((s) => [...s, cur.current!]); }}
          onPointerMove={(e) => { if (!cur.current) return; cur.current.p.push(at(e)); setStrokes((s) => [...s]); }}
          onPointerUp={() => { cur.current = undefined; }} />
      )}
      <div className="absolute inset-x-3 top-3 z-10 flex items-center justify-between">
        <button type="button" aria-label="Undo" onClick={() => setStrokes((s) => s.slice(0, -1))} disabled={!strokes.length} className="grid size-10 place-items-center rounded-full bg-black/35"><Undo2 size={20} /></button>
        <div className="flex gap-1.5">
          {([['pen', PenLine], ['marker', Highlighter], ['neon', Zap], ['eraser', Eraser]] as const).map(([k, Icon]) => (
            <button key={k} type="button" aria-label={k} onClick={() => setBrush(k)} className={cn('grid size-[38px] place-items-center rounded-full', brush === k ? 'bg-white text-black' : 'bg-black/35')}><Icon size={19} /></button>
          ))}
        </div>
        <button type="button" onClick={onDone} className="px-1 text-[16px] font-bold">Done</button>
      </div>
      <div ref={sz} className="absolute top-24 left-3.5 z-10 h-56 w-7 touch-none" onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const mv = (ev: { clientY: number }) => { const b = sz.current!.getBoundingClientRect(); setSize(Math.round(2 + (1 - Math.max(0, Math.min(1, (ev.clientY - b.top) / b.height))) * 38)); };
        mv(e); e.currentTarget.onpointermove = mv; e.currentTarget.onpointerup = (ev) => { (ev.currentTarget as HTMLElement).onpointermove = null; };
      }}>
        <span className="absolute inset-0 rounded-sm bg-white/55 [clip-path:polygon(0_0,100%_0,58%_100%,42%_100%)]" />
        <span className="absolute left-1/2 size-[22px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow" style={{ top: `${(1 - (size - 2) / 38) * 100}%` }} />
      </div>
      <div className="absolute inset-x-0 bottom-5 z-10 flex justify-center gap-2.5">
        {DRAW_COLORS.map((c) => <button key={c} type="button" aria-label={c} onClick={() => setColor(c)} className={cn('size-7 rounded-full ring-2 ring-white transition-transform', color === c && 'scale-125')} style={{ background: c }} />)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------
// the sheets
interface SheetsProps {
  kind: SheetKind; setKind: (k: SheetKind | null) => void; kindOfMedia: 'photo' | 'video';
  filterI: number; setFilterI: (i: number) => void; src: string;
  users: { id: string; name: string; handle?: string; avatarUrl?: string }[];
  add: (s: Omit<StorySticker, 'id' | 'x' | 'y' | 's' | 'r'> & Partial<StorySticker>) => void;
  song?: Song; setSong: (s: Song | undefined) => void; chooseSong: (s: Song) => void;
  countdown?: StorySticker; onCountdown: (d: Record<string, unknown>) => void;
  onPost: (a: StoryAudience, ids?: string[]) => Promise<void>; onDiscard: () => void; onPreview: (s?: Song) => void;
  onSend: (chatIds: string[], story: false | 'friends' | 'close') => Promise<void>;
  ping: { views: 1 | 2 | null | undefined; locked?: string } | undefined;
}

function EditorSheets(p: SheetsProps) {
  const close = () => p.setKind(null);
  const [q, setQ] = useState('');
  const [text, setText] = useState('');
  useEffect(() => { setQ(''); setText(''); }, [p.kind]);

  switch (p.kind) {
    case 'discard':
      return (
        <Panel title="Discard story?" onClose={close}>
          <p className="px-6 pb-3 text-center text-[13.5px] text-white/60">If you go back now, you will lose any changes you've made.</p>
          <button type="button" onClick={p.onDiscard} className="py-3.5 text-[15px] font-bold text-[#ff3040]">Discard</button>
          <button type="button" onClick={close} className="py-3.5 text-[15px]">Keep editing</button>
        </Panel>
      );
    case 'stickers':
      return <StickerTray {...p} close={close} />;
    case 'loc':
      return (
        <Panel title="Location" onClose={close}>
          <form className="flex flex-col gap-3 px-4" onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; p.add({ type: 'loc', y: 0.7, d: { text: text.trim().slice(0, 60) } }); close(); }}>
            <Field autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Where is this?" maxLength={60} enterKeyHint="done" />
            <Blue type="submit" disabled={!text.trim()}>Add</Blue>
          </form>
        </Panel>
      );
    case 'mention': {
      const people = p.users.filter((u) => !q || `${u.name} ${u.handle ?? ''}`.toLowerCase().includes(q.toLowerCase())).slice(0, 40);
      return (
        <Panel title="Mention" onClose={close}>
          <div className="px-4 pb-2.5"><Field autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" /></div>
          <div className="overflow-y-auto px-2.5">
            {people.map((u) => (
              <button key={u.id} type="button" onClick={() => { p.add({ type: 'men', d: { text: u.handle ?? u.name } }); close(); }} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left active:bg-white/5">
                {u.avatarUrl ? <img src={u.avatarUrl} alt="" className="size-11 rounded-full object-cover" /> : <span className="grid size-11 place-items-center rounded-full bg-white/10 font-bold">{u.name[0]}</span>}
                <span className="min-w-0"><b className="block truncate text-[14.5px]">{u.handle ?? u.name}</b><span className="text-[13px] text-white/55">{u.name}</span></span>
              </button>
            ))}
            {people.length === 0 && <p className="py-6 text-center text-white/50">Nobody by that name</p>}
          </div>
        </Panel>
      );
    }
    case 'link': case 'tag':
      return (
        <Panel title={p.kind === 'link' ? 'Add link' : 'Add hashtag'} onClose={close}>
          <form className="flex flex-col gap-3 px-4" onSubmit={(e) => {
            e.preventDefault(); const v = text.trim(); if (!v) return;
            p.add(p.kind === 'link' ? { type: 'link', d: { text: v.slice(0, 200) } } : { type: 'tag', d: { text: v.replace(/^#/, '').slice(0, 40) } }); close();
          }}>
            <Field autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={p.kind === 'link' ? 'https://' : 'weekend'} inputMode={p.kind === 'link' ? 'url' : 'text'} enterKeyHint="done" />
            <Blue type="submit" disabled={!text.trim()}>Done</Blue>
          </form>
        </Panel>
      );
    case 'countdown': return <CountdownSheet {...p} close={close} />;
    case 'effects':
      return (
        <Panel title="Effects" onClose={close}>
          <div className="grid grid-cols-4 gap-x-1.5 gap-y-3.5 overflow-y-auto px-3.5 pb-2">
            {FILTERS.map(([name, css], i) => (
              <button key={name} type="button" onClick={() => p.setFilterI(i)} className="flex flex-col items-center gap-1.5 text-[11.5px]">
                {p.kindOfMedia === 'photo'
                  ? <img src={p.src} alt="" className={cn('h-[84px] w-16 rounded-2xl object-cover', i === p.filterI && 'ring-3 ring-[#0a84ff]')} style={{ filter: css }} />
                  : <span className={cn('grid h-[84px] w-16 place-items-center rounded-2xl bg-gradient-to-b from-[#8b5dff] to-[#e0559b]', i === p.filterI && 'ring-3 ring-[#0a84ff]')} style={{ filter: css }}><Sparkles size={20} /></span>}
                {name}
              </button>
            ))}
          </div>
        </Panel>
      );
    case 'music': return <MusicSheet {...p} close={close} />;
    case 'clip': return <ClipSheet {...p} close={close} />;
    case 'more':
      return (
        <Panel onClose={close}>
          <button type="button" onClick={() => { close(); p.setKind('share'); }} className="px-5 py-3.5 text-left text-[15px] font-semibold">Send to…</button>
          <button type="button" onClick={() => { p.setKind('discard'); }} className="px-5 py-3.5 text-left text-[15px] font-semibold text-[#ff3040]">Discard</button>
        </Panel>
      );
    case 'share':
      return <SendTo views={p.ping?.views} {...(p.ping?.locked ? { locked: p.ping.locked } : {})} onClose={close} onSend={(ids, story) => { close(); void p.onSend(ids, story); }} />;
  }
  return null;
}

function StickerTray(p: SheetsProps & { close: () => void }) {
  const [q, setQ] = useState('');
  const [pack, setPack] = useState<{ name: string; url: string; keywords: string[] }[]>([]);
  useEffect(() => { void fetch('/stickers/fluent-3d.json').then((r) => r.json()).then((j: { stickers: typeof pack }) => setPack(j.stickers)).catch(() => undefined); }, []);
  const chips: [string, ReactNode, string, () => void][] = [
    ['loc', <><MapPin size={14} />LOCATION</>, 'text-[#8b3dff]', () => p.setKind('loc')],
    ['men', <>@MENTION</>, 'text-[#ff7a00]', () => p.setKind('mention')],
    ['music', <><Music2 size={14} />MUSIC</>, 'text-[#e0559b]', () => p.setKind('music')],
    ['question', <>QUESTIONS</>, 'bg-gradient-to-r from-[#8b5dff] to-[#e0559b] text-white', () => { p.add({ type: 'question', d: { q: 'Ask me a question' } }); p.close(); }],
    ['poll', <><b className="text-[#16a34a]">POLL</b><i className="not-italic text-[#ff3b30]">•</i></>, '', () => { p.add({ type: 'poll', d: { q: 'Ask a question…', opts: ['YES', 'NO'] } }); p.close(); }],
    ['countdown', <><AlarmClock size={14} />COUNTDOWN</>, 'text-white', () => p.setKind('countdown')],
    ['quiz', <><CircleCheck size={14} />QUIZ</>, 'text-[#8b5dff]', () => { p.add({ type: 'quiz', d: { q: 'Guess what?', opts: ['Option A', 'Option B', 'Option C'], right: 0 } }); p.close(); }],
    ['slider', <>😍 EMOJI SLIDER</>, 'text-[#ff9a5a]', () => { p.add({ type: 'slider', d: { q: 'Ask a question…', emoji: '😍', avg: 0.7 } }); p.close(); }],
    ['link', <><LinkIcon size={14} />LINK</>, 'text-[#0a84ff]', () => p.setKind('link')],
    ['tag', <><Hash size={14} />HASHTAG</>, 'text-[#e0559b]', () => p.setKind('tag')],
    ['clock', <><Clock size={14} />TIME</>, 'text-white', () => { p.add({ type: 'clock', y: 0.3, d: { at: Date.now() } }); p.close(); }],
  ];
  const term = q.trim().toLowerCase();
  return (
    <Panel onClose={p.close}>
      <label className="mx-3.5 mb-3 flex h-[38px] shrink-0 items-center gap-2 rounded-[10px] bg-[#2c2c2e] px-3 text-white/55">
        <Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none" />
      </label>
      <div className="overflow-y-auto px-3.5">
        <div className="flex flex-wrap justify-center gap-2.5 pb-3.5">
          {chips.filter(([k]) => !term || k.includes(term)).map(([k, label, cls, act]) => (
            <button key={k} type="button" onClick={act} className={cn('inline-flex items-center gap-1.5 rounded-[10px] bg-[#2c2c2e] px-3 py-2 text-[13px] font-extrabold', cls)}>{label}</button>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-2.5 pb-4">
          {pack.filter((s) => !term || `${s.name} ${s.keywords.join(' ')}`.toLowerCase().includes(term)).map((s) => (
            <button key={s.url} type="button" onClick={() => { p.add({ type: 'emoji', y: 0.35, d: { src: s.url } }); p.close(); }} className="aspect-square rounded-2xl p-1.5 active:bg-white/10">
              <img src={s.url} alt={s.name} loading="lazy" className="size-full object-contain" />
            </button>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function CountdownSheet(p: SheetsProps & { close: () => void }) {
  const initial = new Date(p.countdown ? String(p.countdown.d.to) : Date.now() + 2 * 864e5);
  const local = new Date(initial.getTime() - initial.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [name, setName] = useState(p.countdown ? String(p.countdown.d.q ?? '') : '');
  const [when, setWhen] = useState(local);
  return (
    <Panel title="Countdown" onClose={p.close}>
      <form className="flex flex-col gap-2.5 px-4" onSubmit={(e) => { e.preventDefault(); p.onCountdown({ q: name.trim() || 'Countdown', to: new Date(when).toISOString() }); p.close(); }}>
        <Field autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Countdown name" maxLength={40} />
        <Field type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={{ colorScheme: 'dark' }} />
        <Blue type="submit">Done</Blue>
      </form>
    </Panel>
  );
}
