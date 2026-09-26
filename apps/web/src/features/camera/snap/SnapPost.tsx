import { useChat, useProfile, type StoryAudioDraft, type StorySticker } from '@pingo/core';
import { cn } from '@pingo/ui';
import { ChevronDown, CircleCheck, CircleOff, Circle, Download, Link as LinkIcon, Music2, PenLine, Search, Send, Star, Sticker, Timer, Type, UsersRound, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Blue, ClipSheet, Field, MusicSheet, Panel, type Song } from '../../music/sheets.js';
import { cutToWav, decodeSound } from '../../stories/story-audio.js';
import { DrawMode, TextMode, type Stroke } from '../../stories/StoryEditor.js';
import { StickerView, stickerStyle, type TextData } from '../../stories/stickers/StickerView.js';
import { useStories } from '../../stories/StoryContext.js';
import type { SnapShot } from './SnapCamera.js';

/**
 * After the shutter, Snapchat's way: the tools down the right, filters to swipe
 * along the bottom (the time and the day among them), and Save, My story or
 * Send to.
 *
 * A Ping is a picture, so everything on it is flattened into the photo before
 * it goes. A story keeps its stickers as data, the same as one made in the
 * story editor.
 */

const W = 1080, H = 1920;
const VIEWS: (1 | 2 | null)[] = [1, 2, null];
const FILTER_CIRCLES: { k: string; css?: string }[] = [
  { k: 'none' }, { k: 'time' }, { k: 'day' },
  { k: 'vivid', css: 'saturate(1.5) contrast(1.08)' }, { k: 'warm', css: 'sepia(.3) saturate(1.3) hue-rotate(-12deg)' },
  { k: 'mono', css: 'grayscale(1) contrast(1.2)' }, { k: 'fade', css: 'contrast(.82) brightness(1.08) saturate(.8)' },
];
const uid = () => Math.random().toString(36).slice(2, 8);

export function SnapPost({ shot, lockedChatId, onRetake, onSent }: {
  shot: SnapShot;
  /** Opened from a chat: that chat is already chosen. */
  lockedChatId?: string;
  onRetake: () => void;
  /** Where to go once it has gone somewhere. */
  onSent: (where: { conversationId?: string }) => void;
}) {
  const { service: chat } = useChat();
  const { service: stories, refresh } = useStories();
  const url = useMemo(() => URL.createObjectURL(shot.blob), [shot.blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const stage = useRef<HTMLDivElement>(null);
  const ink = useRef<HTMLCanvasElement>(null);
  const media = useRef<HTMLImageElement & HTMLVideoElement>(null);

  const [stickers, setStickers] = useState<StorySticker[]>([]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [circle, setCircle] = useState(0);
  const [views, setViews] = useState<1 | 2 | null>(2);
  const [mode, setMode] = useState<'none' | 'text' | 'draw'>('none');
  const [editing, setEditing] = useState<StorySticker>();
  const [sheet, setSheet] = useState<'stickers' | 'music' | 'clip' | 'link' | 'send' | null>(null);
  const [song, setSong] = useState<Song | undefined>(shot.song);
  const [busy, setBusy] = useState<string>();
  const [toast, setToast] = useState<string>();
  const player = useRef<HTMLAudioElement | undefined>(undefined);

  const css = FILTER_CIRCLES[circle]!.css ?? '';
  const say = (t: string) => { setToast(t); window.setTimeout(() => setToast((x) => (x === t ? undefined : x)), 1800); };
  useEffect(() => {
    if (!ink.current) return; const g = ink.current.getContext('2d')!; g.clearRect(0, 0, W, H);
    for (const s of strokes) {
      g.save(); g.lineJoin = 'round'; g.lineCap = 'round'; g.lineWidth = s.size * (s.brush === 'marker' ? 2.2 : 1); g.strokeStyle = s.color;
      if (s.brush === 'marker') g.globalAlpha = 0.5; if (s.brush === 'eraser') g.globalCompositeOperation = 'destination-out';
      if (s.brush === 'neon') { g.shadowColor = s.color; g.shadowBlur = 40; }
      g.beginPath(); s.p.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); g.restore();
    }
  }, [strokes]);

  // A photo's song plays over it while it is being made; a video carries its own.
  useEffect(() => {
    if (shot.kind !== 'photo' || !song) { player.current?.pause(); return; }
    const a = (player.current ??= new Audio()); a.crossOrigin = 'anonymous';
    if (!a.src.endsWith(song.url)) a.src = song.url;
    a.currentTime = song.start; void a.play().catch(() => undefined);
    a.ontimeupdate = () => { if (a.currentTime > song.start + 15) a.currentTime = song.start; };
    return () => a.pause();
  }, [song, shot.kind]);

  const add = (s: Omit<StorySticker, 'id' | 's' | 'r' | 'x'> & Partial<StorySticker>) => setStickers((p) => [...p, { id: uid(), x: 0.5, s: 1, r: 0, ...s } as StorySticker]);
  const update = (id: string, patch: Partial<StorySticker>) => setStickers((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  // the time or the day, as a sticker that comes with the filter circle
  const stamp = FILTER_CIRCLES[circle]!.k;
  const all: StorySticker[] = useMemo(() => {
    if (stamp === 'time') return [...stickers, { id: 'stamp', type: 'clock', x: 0.5, y: 0.46, s: 1.4, r: 0, d: { at: Date.now() } }];
    if (stamp === 'day') return [...stickers, { id: 'stamp', type: 'clock', x: 0.5, y: 0.46, s: 1.1, r: 0, style: 1, d: { at: Date.now() } }];
    return stickers;
  }, [stickers, stamp]);

  // drag a sticker; a double tap removes it
  const drag = useRef<{ id: string; x0: number; y0: number; sx: number; sy: number } | undefined>(undefined);
  const onDown = (e: React.PointerEvent, s: StorySticker) => {
    if (s.id === 'stamp') return;
    e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: s.id, x0: e.clientX, y0: e.clientY, sx: s.x, sy: s.y };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; const r = stage.current?.getBoundingClientRect(); if (!d || !r) return;
    update(d.id, { x: d.sx + (e.clientX - d.x0) / r.width, y: d.sy + (e.clientY - d.y0) / r.height });
  };
  const onUp = (e: React.PointerEvent, s: StorySticker) => {
    const d = drag.current; drag.current = undefined;
    if (d && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6 && s.type === 'text') { setEditing(s); setMode('text'); }
  };

  // ---- the picture as it will leave ------------------------------------------------
  const flatten = async (withStickers: boolean): Promise<Blob> => {
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d')!;
    const img = media.current as HTMLImageElement;
    g.filter = css || 'none';
    const k = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    g.drawImage(img, (W - img.naturalWidth * k) / 2, (H - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
    g.filter = 'none';
    if (strokes.length && ink.current) g.drawImage(ink.current, 0, 0);
    if (withStickers) await drawStickers(g, all);
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not make the picture.'))), 'image/jpeg', 0.9));
  };

  const save = async () => {
    try {
      const b = shot.kind === 'photo' ? await flatten(true) : shot.blob;
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `pingo-snap.${shot.kind === 'photo' ? 'jpg' : shot.blob.type.includes('mp4') ? 'mp4' : 'webm'}`; a.click();
      say('Saved');
    } catch { say('Could not save'); }
  };

  const songPiece = async (): Promise<StoryAudioDraft[] | undefined> => {
    if (!song || shot.kind !== 'photo') return undefined;
    const bytes = await (await fetch(song.url)).blob();
    const sound = await decodeSound(new File([bytes], song.name, { type: bytes.type || 'audio/mp4' }));
    return [{ blob: cutToWav(sound.buffer, song.start, Math.min(sound.buffer.duration, song.start + 15)), at: 0, duration: 15, volume: 1 }];
  };

  const toStory = async (audience: 'friends' | 'close') => {
    setBusy('Posting…');
    try {
      const audio = await songPiece();
      const decorStickers = [...stickers, ...(stamp === 'time' || stamp === 'day' ? all.filter((s) => s.id === 'stamp').map((s) => ({ ...s, id: 'stamp' })) : [])];
      await stories.post({
        media: shot.kind === 'photo' ? await flatten(false) : shot.blob,
        kind: shot.kind, audience,
        decor: { v: 1, stickers: decorStickers, ...(shot.kind === 'video' && css ? { filter: css } : {}) },
        ...(audio ? { audio } : {}),
      });
      await refresh();
      setBusy(undefined);
      onSent({});
    } catch (cause) { setBusy(undefined); say(cause instanceof Error ? cause.message : 'Could not post'); }
  };

  const send = async (ids: string[], story: false | 'friends' | 'close') => {
    setBusy('Sending…');
    try {
      if (ids.length) {
        if (shot.kind === 'photo') {
          const image = await flatten(true);
          await Promise.all(ids.map((conversationId) => chat.sendMessage({ conversationId, body: 'Ping', ping: { image, views } })));
        } else {
          const file = new File([shot.blob], `snap.${shot.blob.type.includes('mp4') ? 'mp4' : 'webm'}`, { type: shot.blob.type || 'video/webm' });
          await Promise.all(ids.map((conversationId) => chat.sendMessage({ conversationId, body: '', document: { file } })));
        }
        noteSends(ids);
      }
      if (story) await toStory(story);
      else { setBusy(undefined); onSent(ids.length === 1 ? { conversationId: ids[0]! } : {}); }
    } catch (cause) { setBusy(undefined); say(cause instanceof Error ? cause.message : 'That did not send'); }
  };

  const glass = 'bg-black/28 backdrop-blur-md ring-1 ring-white/15';
  const hide = mode !== 'none';

  return (
    <div className="fixed inset-0 z-500 flex flex-col bg-black text-white select-none">
      <div className="relative min-h-0 flex-1">
        <div ref={stage} className="absolute top-0 left-1/2 aspect-[9/16] max-h-full w-full max-w-[calc((100dvh-92px)*9/16)] -translate-x-1/2 overflow-hidden rounded-b-[28px]"
          onPointerMove={onMove}>
          {shot.kind === 'photo'
            ? <img ref={media} src={url} alt="" className="absolute inset-0 size-full object-cover" style={{ filter: css || undefined }} draggable={false} />
            : <video ref={media} src={url} className="absolute inset-0 size-full object-cover" style={{ filter: css || undefined }} autoPlay loop playsInline />}
          <canvas ref={ink} width={W} height={H} className="pointer-events-none absolute inset-0 size-full" />
          <div className="sk-layer inset-0">
            {all.map((s) => (
              <div key={s.id} className="sk" style={{ ...stickerStyle(s), visibility: editing?.id === s.id ? 'hidden' : undefined, pointerEvents: s.id === 'stamp' ? 'none' : 'auto' }}
                onPointerDown={(e) => onDown(e, s)} onPointerUp={(e) => onUp(e, s)}
                onDoubleClick={() => setStickers((p) => p.filter((x) => x.id !== s.id))}>
                <StickerView sticker={s} mode="edit" />
              </div>
            ))}
          </div>
        </div>

        <button type="button" aria-label="Discard" onClick={onRetake} className={cn('absolute top-3.5 left-3.5 z-10 grid size-[42px] place-items-center rounded-full', glass, hide && 'hidden')}><X size={20} /></button>
        {song && !hide && (
          <button type="button" onClick={() => setSheet('clip')} className={cn('absolute top-[18px] left-1/2 z-10 flex h-[34px] max-w-[190px] -translate-x-1/2 items-center gap-2 rounded-full pr-3 pl-1 text-[13px] font-semibold', glass)}>
            <img src={song.img} alt="" className="size-6 animate-spin rounded-full [animation-duration:4s]" /><span className="truncate">{song.name} · {song.artist}</span>
          </button>
        )}
        <div className={cn('absolute top-3.5 right-3.5 z-10 flex flex-col gap-0.5 rounded-[26px] p-1', glass, hide && 'hidden')}>
          {([['Text', Type, () => { setEditing(undefined); setMode('text'); }], ['Draw', PenLine, () => setMode('draw')], ['Stickers', Sticker, () => setSheet('stickers')],
            ['Music', Music2, () => setSheet('music')], ['Link', LinkIcon, () => setSheet('link')]] as const).map(([label, Icon, act]) => (
            <button key={label} type="button" aria-label={label} onClick={act} className="grid size-10 place-items-center rounded-full active:scale-90"><Icon size={20} /></button>
          ))}
          {shot.kind === 'photo' && (
            <button type="button" aria-label="View limit" onClick={() => { const v = VIEWS[(VIEWS.indexOf(views) + 1) % 3]!; setViews(v); say(v === null ? 'Unlimited views' : `${v} view${v > 1 ? 's' : ''}, then it's gone`); }}
              className="relative grid size-10 place-items-center rounded-full"><Timer size={20} /><small className="absolute right-0.5 bottom-0.5 text-[9px] font-extrabold">{views ?? '∞'}</small></button>
          )}
        </div>

        {/* filters along the bottom, the time and the day among them */}
        <div className={cn('scrollbar-none absolute inset-x-0 bottom-3 z-10 flex gap-3 overflow-x-auto px-4 py-1', hide && 'hidden')}>
          {FILTER_CIRCLES.map((f, i) => (
            <button key={f.k} type="button" aria-label={f.k} onClick={() => setCircle(i)}
              className={cn('grid size-[58px] shrink-0 place-items-center overflow-hidden rounded-full text-[13px] font-extrabold ring-2 backdrop-blur-md transition-transform', i === circle ? 'scale-110 ring-[#ff7eb6]' : 'bg-white/14 ring-white/45')}>
              {f.k === 'none' ? <CircleOff size={20} /> : f.k === 'time' ? new Date().toTimeString().slice(0, 5)
                : f.k === 'day' ? <span className="font-serif italic">{new Date().toLocaleDateString('en', { weekday: 'short' })}</span>
                  : shot.kind === 'photo' ? <img src={url} alt="" className="size-full object-cover" style={{ filter: f.css }} /> : <span className="size-full bg-gradient-to-b from-[#8b5dff] to-[#e0559b]" style={{ filter: f.css }} />}
            </button>
          ))}
        </div>
      </div>

      <div className={cn('flex h-[92px] shrink-0 items-center gap-2 px-3 pb-2.5', hide && 'invisible')}>
        <button type="button" aria-label="Save" onClick={() => void save()} className={cn('grid size-[50px] shrink-0 place-items-center rounded-full', glass)}><Download size={20} /></button>
        <MyStory onClick={() => void toStory('friends')} />
        <button type="button" onClick={() => setSheet('send')} className="flex h-[50px] flex-[1.15] items-center justify-center gap-2 rounded-full bg-gradient-to-br from-[#e0559b] to-[#ff7eb6] text-[15.5px] font-bold shadow-[0_10px_24px_-10px_rgba(224,85,155,.8)]">Send to<Send size={18} /></button>
      </div>

      {mode === 'text' && (
        <TextMode {...(editing ? { initial: editing.d as unknown as TextData } : {})} onLocation={() => undefined}
          onDone={(d) => { const was = editing; setEditing(undefined); setMode('none');
            if (was) { if (!d.text.trim()) setStickers((p) => p.filter((x) => x.id !== was.id)); else update(was.id, { d: d as unknown as Record<string, unknown> }); return; }
            if (d.text.trim()) add({ type: 'text', y: 0.68, d: { ...d, bg: d.bg === 'none' ? 'soft' : d.bg } as unknown as Record<string, unknown> }); }} />
      )}
      {mode === 'draw' && <DrawMode ink={ink} stage={stage} strokes={strokes} setStrokes={setStrokes} onDone={() => setMode('none')} />}

      {sheet === 'stickers' && <EmojiTray onPick={(src) => { add({ type: 'emoji', y: 0.32, d: { src } }); setSheet(null); }} onClose={() => setSheet(null)} />}
      {sheet === 'music' && <MusicSheet close={() => setSheet(null)} onPreview={() => undefined} chooseSong={(s) => { setSong(s); setSheet('clip'); }} />}
      {sheet === 'clip' && <ClipSheet close={() => setSheet(null)} {...(song ? { song } : {})} setSong={setSong} />}
      {sheet === 'link' && <LinkSheet onDone={(v) => { add({ type: 'link', y: 0.3, d: { text: v } }); setSheet(null); }} onClose={() => setSheet(null)} />}
      {sheet === 'send' && <SendTo views={shot.kind === 'photo' ? views : undefined} {...(lockedChatId ? { locked: lockedChatId } : {})} onClose={() => setSheet(null)} onSend={(ids, story) => { setSheet(null); void send(ids, story); }} />}

      {busy && <div className="absolute inset-0 z-50 grid place-items-center bg-black/55"><div className="flex flex-col items-center gap-3"><span className="size-9 animate-spin rounded-full border-3 border-white/25 border-t-white" /><span className="text-[14px] font-semibold">{busy}</span></div></div>}
      {toast && <div className={cn('animate-panel-in absolute top-20 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2.5 text-[14px] font-bold whitespace-nowrap', glass)}>{toast}</div>}
    </div>
  );
}

function MyStory({ onClick }: { onClick: () => void }) {
  const { profile } = useProfile();
  return (
    <button type="button" onClick={onClick} className="flex h-[50px] flex-1 items-center justify-center gap-2 rounded-full bg-black/28 text-[15.5px] font-bold ring-1 ring-white/15 backdrop-blur-md">
      {profile?.avatarUrl && <img src={profile.avatarUrl} alt="" className="size-7 rounded-full object-cover" />}My story
    </button>
  );
}

function EmojiTray({ onPick, onClose }: { onPick: (src: string) => void; onClose: () => void }) {
  const [pack, setPack] = useState<{ name: string; url: string; keywords: string[] }[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => { void fetch('/stickers/fluent-3d.json').then((r) => r.json()).then((j: { stickers: typeof pack }) => setPack(j.stickers)).catch(() => undefined); }, []);
  return (
    <Panel title="Stickers" onClose={onClose}>
      <label className="mx-3.5 mb-3 flex h-[38px] shrink-0 items-center gap-2 rounded-[10px] bg-[#2c2c2e] px-3 text-white/55"><Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none" /></label>
      <div className="grid grid-cols-4 gap-2.5 overflow-y-auto px-3.5 pb-4">
        {pack.filter((s) => !q || `${s.name} ${s.keywords.join(' ')}`.toLowerCase().includes(q.toLowerCase())).map((s) => (
          <button key={s.url} type="button" onClick={() => onPick(s.url)} className="aspect-square rounded-2xl p-1.5 active:bg-white/10"><img src={s.url} alt={s.name} loading="lazy" className="size-full object-contain" /></button>
        ))}
      </div>
    </Panel>
  );
}

function LinkSheet({ onDone, onClose }: { onDone: (v: string) => void; onClose: () => void }) {
  const [v, setV] = useState('');
  return (
    <Panel title="Attach a link" onClose={onClose}>
      <form className="flex flex-col gap-3 px-4" onSubmit={(e) => { e.preventDefault(); if (v.trim()) onDone(v.trim().slice(0, 200)); }}>
        <Field autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder="https://" inputMode="url" enterKeyHint="done" />
        <Blue type="submit" disabled={!v.trim()}>Add</Blue>
      </form>
    </Panel>
  );
}

// ---- Send To ------------------------------------------------------------------------
// The people you send to most come first, as on Snapchat.
const SEND_KEY = 'pingo.sendUse';
const readSends = (): Record<string, { n: number; t: number }> => { try { return JSON.parse(localStorage.getItem(SEND_KEY) ?? '{}') as Record<string, { n: number; t: number }>; } catch { return {}; } };
export function noteSends(ids: string[]) {
  const u = readSends(); for (const id of ids) { const e = (u[id] ??= { n: 0, t: 0 }); e.n += 1; e.t = Date.now(); }
  try { localStorage.setItem(SEND_KEY, JSON.stringify(u)); } catch { /* order resets */ }
}

export function SendTo({ views, locked, onClose, onSend }: {
  views: 1 | 2 | null | undefined; locked?: string; onClose: () => void;
  onSend: (ids: string[], story: false | 'friends' | 'close') => void;
}) {
  const { conversations } = useChat();
  const { profile } = useProfile();
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'all' | 'groups'>('all');
  const [picked, setPicked] = useState<Set<string>>(() => new Set(locked ? [locked] : []));
  const [story, setStory] = useState<false | 'friends' | 'close'>(false);
  const sends = useMemo(readSends, []);
  const list = useMemo(() => conversations
    .filter((c) => (tab === 'all' || c.kind === 'group') && (!q.trim() || c.title.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => (sends[b.id]?.n ?? 0) - (sends[a.id]?.n ?? 0) || (sends[b.id]?.t ?? 0) - (sends[a.id]?.t ?? 0))
    .slice(0, 80), [conversations, tab, q, sends]);
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const names = [...(story ? [story === 'close' ? 'Close friends' : 'My story'] : []), ...conversations.filter((c) => picked.has(c.id)).map((c) => c.title)];
  const Tick = ({ on }: { on: boolean }) => (on ? <CircleCheck size={26} className="shrink-0 text-[#e0559b]" /> : <Circle size={26} className="shrink-0 text-white/40" />);
  return (
    <div className="animate-panel-in fixed inset-0 z-600 flex flex-col bg-[#0d0d10] text-white">
      <div className="flex items-center gap-2 px-3.5 pt-3.5 pb-2.5">
        <button type="button" aria-label="Back" onClick={onClose} className="grid size-10 shrink-0 place-items-center"><ChevronDown size={26} /></button>
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-white/8 px-3.5 text-white/55"><Search size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Send to…" className="min-w-0 flex-1 bg-transparent text-[16px] text-white outline-none" />
          <UsersRound size={19} className="text-white" />
        </label>
      </div>
      <div className="flex gap-1.5 px-3.5 pb-3">
        {(['all', 'groups'] as const).map((t) => <button key={t} type="button" onClick={() => setTab(t)} className={cn('rounded-full px-4 py-2 text-[14.5px] font-bold capitalize', tab === t ? 'bg-[#e0559b]/28 ring-1 ring-[#e0559b]/55' : 'text-white/70')}>{t}</button>)}
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 pb-28">
        {!q && tab === 'all' && (
          <>
            <h4 className="mx-0.5 mt-1.5 mb-2.5 text-[17px] font-bold">Post to…</h4>
            <div className="mb-4 overflow-hidden rounded-[18px] bg-white/6">
              {([['friends', 'My story · Friends', 'Your friends on PINGO'], ['close', 'Close friends', 'Only your list']] as const).map(([k, label, sub]) => (
                <button key={k} type="button" onClick={() => setStory((s) => (s === k ? false : k))} className="flex w-full items-center gap-3 border-t border-white/6 px-3.5 py-2.5 text-left first:border-t-0">
                  <span className={cn('grid size-[46px] shrink-0 place-items-center rounded-full ring-2 ring-offset-2 ring-offset-[#0d0d10]', k === 'close' ? 'bg-[#1fc15e] ring-[#1fc15e]' : 'ring-[#e0559b]')}>
                    {k === 'close' ? <Star size={18} fill="#fff" /> : profile?.avatarUrl ? <img src={profile.avatarUrl} alt="" className="size-full rounded-full object-cover" /> : null}
                  </span>
                  <span className="min-w-0 flex-1"><b className={cn('block text-[16px]', story === k && 'text-[#ff7eb6]')}>{label}</b><span className="text-[13.5px] text-white/55">{sub}</span></span>
                  <Tick on={story === k} />
                </button>
              ))}
            </div>
          </>
        )}
        <h4 className="mx-0.5 mb-2.5 text-[17px] font-bold">{q ? 'Results' : 'Recents & suggested'}</h4>
        <div className="overflow-hidden rounded-[18px] bg-white/6">
          {list.map((c) => (
            <button key={c.id} type="button" onClick={() => toggle(c.id)} className="flex w-full items-center gap-3 border-t border-white/6 px-3.5 py-2.5 text-left first:border-t-0">
              {c.avatarUrl ? <img src={c.avatarUrl} alt="" className="size-[46px] shrink-0 rounded-full object-cover" /> : <span className="grid size-[46px] shrink-0 place-items-center rounded-full bg-white/10 font-bold">{c.title[0]}</span>}
              <span className="min-w-0 flex-1"><b className={cn('block truncate text-[16px]', picked.has(c.id) && 'text-[#ff7eb6]')}>{c.title}</b>{c.kind === 'group' && <span className="text-[13.5px] text-white/55">Group</span>}</span>
              <Tick on={picked.has(c.id)} />
            </button>
          ))}
          {list.length === 0 && <p className="py-6 text-center text-white/50">Nobody by that name</p>}
        </div>
      </div>
      <div className={cn('fixed inset-x-0 bottom-0 flex items-center gap-2.5 bg-gradient-to-br from-[#e0559b] to-[#ff7eb6] px-3.5 pt-3 pb-[max(1.4rem,env(safe-area-inset-bottom))] transition-transform', names.length ? 'translate-y-0' : 'translate-y-full')}>
        <div className="scrollbar-none flex min-w-0 flex-1 gap-1.5 overflow-x-auto text-[15px] font-bold">{names.map((n, i) => <span key={i} className="shrink-0 rounded-full bg-white/22 px-3 py-1.5">{n}</span>)}</div>
        {views !== undefined && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-black/18 px-2.5 py-1.5 text-[12.5px] font-extrabold"><Timer size={13} />{views ?? '∞'}</span>}
        <button type="button" aria-label="Send" onClick={() => onSend([...picked], story)} className="grid size-[50px] shrink-0 place-items-center rounded-full bg-white text-[#e0559b] active:scale-90"><Send size={22} /></button>
      </div>
    </div>
  );
}

// ---- flattening a Ping ------------------------------------------------------------
export async function drawStickers(g: CanvasRenderingContext2D, list: StorySticker[]) {
  const unit = W / 100; // one cqw
  await document.fonts?.ready;
  for (const s of list) {
    g.save();
    g.translate(s.x * W, s.y * H); g.rotate((s.r * Math.PI) / 180); g.scale(s.s, s.s);
    const d = s.d as Record<string, string & number>;
    if (s.type === 'emoji') {
      const img = await loadImage(String(d.src ?? '')); if (img) { const w = 28 * unit; g.drawImage(img, -w / 2, -w / 2, w, (w * img.naturalHeight) / img.naturalWidth); }
    } else if (s.type === 'text') {
      const t = d as unknown as TextData; const px = (t.size / 390) * W;
      g.font = `${FONT[t.font] ?? '800'} ${px}px ${FAMILY[t.font] ?? 'Manrope, sans-serif'}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const lines = t.text.split('\n'); const lh = px * 1.15; const wMax = Math.max(...lines.map((l) => g.measureText(l).width));
      if (t.bg !== 'none') { g.fillStyle = t.bg === 'solid' ? t.color : 'rgba(0,0,0,.55)'; roundRect(g, -wMax / 2 - px * 0.35, -(lines.length * lh) / 2 - px * 0.15, wMax + px * 0.7, lines.length * lh + px * 0.3, px * 0.3); }
      g.fillStyle = t.bg === 'solid' ? (light(t.color) ? '#111' : '#fff') : t.color;
      lines.forEach((l, i) => g.fillText(l, 0, (i - (lines.length - 1) / 2) * lh));
    } else if (s.type === 'link') {
      const px = 4.1 * unit; g.font = `800 ${px}px Manrope, sans-serif`; const text = String(d.text).replace(/^https?:\/\//, '');
      const w = g.measureText(text).width + px * 1.4; g.fillStyle = '#fff'; roundRect(g, -w / 2, -px * 0.9, w, px * 1.8, px * 0.55);
      g.fillStyle = '#0a84ff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 0, 0);
    } else if (s.type === 'clock') {
      const at = new Date(Number(d.at) || Date.now());
      const hm = at.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 30;
      if ((s.style ?? 0) % 2 === 0) { g.font = `800 ${11.3 * unit}px Manrope, sans-serif`; g.fillText(hm, 0, 0); }
      else { g.font = `italic 700 ${9 * unit}px 'Playfair Display', Georgia, serif`; g.fillText(at.toLocaleDateString('en', { weekday: 'long' }), 0, 0); }
    }
    g.restore();
  }
}
const FAMILY: Record<string, string> = { classic: 'Manrope, sans-serif', modern: 'Oswald, sans-serif', neon: 'Yellowtail, cursive', type: "'Courier Prime', monospace", strong: 'Anton, sans-serif', elegant: "'Playfair Display', serif", direct: 'Poppins, sans-serif' };
const FONT: Record<string, string> = { classic: '800', modern: '600', neon: '400', type: '700', strong: 'italic 400', elegant: 'italic 700', direct: 'italic 800' };
const light = (hex: string) => { const n = parseInt(hex.replace('#', ''), 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 160; };
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); }
function loadImage(src: string): Promise<HTMLImageElement | undefined> {
  return new Promise((res) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(undefined); i.src = src; });
}
