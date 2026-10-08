import { useChat, useProfile, type StorySticker } from '@pingo/core';
import { cn } from '@pingo/ui';
import { ChevronDown, CircleCheck, Circle, Search, Send, Star, Timer, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { useStories } from '../../stories/StoryContext.js';

import type { TextData } from '../../stories/stickers/StickerView.js';

const W = 1080, H = 1920;

/**
 * Snapchat's Send to, for anything leaving the camera, the story editor or
 * the share screen (a song, a playlist, a link, a file):
 * My story or Close friends at the top, the chats below - the ones sent to
 * most first - and a bar along the foot naming who it is going to.
 *
 * In the app's own theme: light unless somebody chose dark. It used to be
 * black everywhere, which suited the camera and nothing else.
 *
 * And the flattening a chat needs: a picture cannot carry a live poll, so what
 * goes to a chat has its stickers drawn into it.
 */

// ---- Send To ------------------------------------------------------------------------
// The people you send to most come first, as on Snapchat.
const SEND_KEY = 'pingo.sendUse';
const readSends = (): Record<string, { n: number; t: number }> => { try { return JSON.parse(localStorage.getItem(SEND_KEY) ?? '{}') as Record<string, { n: number; t: number }>; } catch { return {}; } };
export function noteSends(ids: string[]) {
  const u = readSends(); for (const id of ids) { const e = (u[id] ??= { n: 0, t: 0 }); e.n += 1; e.t = Date.now(); }
  try { localStorage.setItem(SEND_KEY, JSON.stringify(u)); } catch { /* order resets */ }
}

export function SendTo({ views, locked, onClose, onSend, post = true, preview, busy, error }: {
  views: 1 | 2 | null | undefined; locked?: string; onClose: () => void;
  onSend: (ids: string[], story: false | 'friends' | 'close') => void;
  /** Offer My story and Close friends. Off for what cannot be a story: a song, a link, a file. */
  post?: boolean;
  /** What is being sent, shown above the people it is going to. */
  preview?: ReactNode;
  busy?: boolean;
  error?: string;
}) {
  const { conversations } = useChat();
  const { profile } = useProfile();
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'all' | 'groups'>('all');
  const [picked, setPicked] = useState<Set<string>>(() => new Set(locked ? [locked] : []));
  const [story, setStory] = useState<false | 'friends' | 'close'>(false);
  const sends = useMemo(readSends, []);
  /*
   * Friends only. The chat list also holds message requests and anybody who
   * ever wrote first, and a snap is not for them - a one-to-one chat shows here
   * only when both of you follow each other. Groups stay: being in one is the
   * consent. Until the friend list arrives nobody one-to-one is shown, rather
   * than everybody for a moment.
   */
  const { service: stories } = useStories();
  const [friendIds, setFriendIds] = useState<Set<string>>();
  useEffect(() => {
    let active = true;
    void stories.listFriends().then((ids) => { if (active) setFriendIds(new Set(ids)); }).catch(() => { if (active) setFriendIds(new Set()); });
    return () => { active = false; };
  }, [stories]);
  const allowed = useMemo(() => conversations.filter((c) => {
    if (c.id === locked) return true;
    if (c.kind === 'group' || c.kind === 'community') return true;
    if (c.kind !== 'direct' || !friendIds) return false;
    return c.participantIds.some((id) => id !== profile?.id && friendIds.has(id));
  }), [conversations, friendIds, locked, profile?.id]);
  const list = useMemo(() => allowed
    .filter((c) => (tab === 'all' || c.kind === 'group') && (!q.trim() || c.title.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => (sends[b.id]?.n ?? 0) - (sends[a.id]?.n ?? 0) || (sends[b.id]?.t ?? 0) - (sends[a.id]?.t ?? 0))
    .slice(0, 80), [allowed, tab, q, sends]);
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const names = [...(story ? [story === 'close' ? 'Close friends' : 'My story'] : []), ...conversations.filter((c) => picked.has(c.id)).map((c) => c.title)];
  /** Faces for the send bar: the story first, as its ring, then each chat. */
  const faces = [
    ...(story ? [{ img: story === 'friends' ? profile?.avatarUrl : undefined, letter: '', star: story === 'close' }] : []),
    ...conversations.filter((c) => picked.has(c.id)).map((c) => ({ img: c.avatarUrl, letter: c.title[0] ?? '', star: false })),
  ];
  // One name in full; more than one by first names, so the line fits.
  const first = (n: string) => (n === 'My story' || n === 'Close friends' ? n : n.split(' ')[0] ?? n);
  const summary = names.length <= 1 ? (names[0] ?? '') : names.length === 2 ? `${first(names[0]!)} and ${first(names[1]!)}` : `${first(names[0]!)} and ${names.length - 1} others`;
  const Tick = ({ on }: { on: boolean }) => (on ? <CircleCheck size={26} className="shrink-0 text-brand" /> : <Circle size={26} className="shrink-0 text-text-tertiary" />);
  return (
    <div className="animate-panel-in fixed inset-0 z-600 flex flex-col bg-page text-ink">
      <div className="flex items-center gap-2 px-3.5 pt-3.5 pb-2.5">
        <button type="button" aria-label="Back" onClick={onClose} className="grid size-10 shrink-0 place-items-center"><ChevronDown size={26} /></button>
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-sunken px-3.5 text-text-tertiary"><Search size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Send to…" className="min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-text-tertiary" />
          <UsersRound size={19} className="text-ink" />
        </label>
      </div>
      <div className="flex gap-1.5 px-3.5 pb-3">
        {(['all', 'groups'] as const).map((t) => <button key={t} type="button" onClick={() => setTab(t)} className={cn('rounded-full px-4 py-2 text-[14.5px] font-bold capitalize', tab === t ? 'bg-ink text-page' : 'text-text-secondary')}>{t}</button>)}
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 pb-28">
        {preview && !q && <div className="mb-4">{preview}</div>}
        {post && !q && tab === 'all' && (
          <>
            <h4 className="mx-0.5 mt-1.5 mb-2.5 text-[17px] font-bold">Post to…</h4>
            <div className="mb-4 overflow-hidden rounded-[18px] bg-surface shadow-[0_1px_2px_rgba(16,17,20,0.06)]">
              {([['friends', 'My story · Friends', 'Your friends on PINGO'], ['close', 'Close friends', 'Only your list']] as const).map(([k, label, sub]) => (
                <button key={k} type="button" onClick={() => setStory((s) => (s === k ? false : k))} className="flex w-full items-center gap-3 border-t border-line px-3.5 py-2.5 text-left first:border-t-0">
                  <span className={cn('grid size-[46px] shrink-0 place-items-center rounded-full ring-2 ring-offset-2 ring-offset-page', k === 'close' ? 'bg-close-friends ring-close-friends' : 'ring-brand')}>
                    {k === 'close' ? <Star size={18} fill="#fff" /> : profile?.avatarUrl ? <img src={profile.avatarUrl} alt="" className="size-full rounded-full object-cover" /> : null}
                  </span>
                  <span className="min-w-0 flex-1"><b className={cn('block text-[16px]', story === k && 'text-brand')}>{label}</b><span className="text-[13.5px] text-text-secondary">{sub}</span></span>
                  <Tick on={story === k} />
                </button>
              ))}
            </div>
          </>
        )}
        <h4 className="mx-0.5 mb-2.5 text-[17px] font-bold">{q ? 'Results' : 'Recents & suggested'}</h4>
        <div className="overflow-hidden rounded-[18px] bg-surface shadow-[0_1px_2px_rgba(16,17,20,0.06)]">
          {list.map((c) => (
            <button key={c.id} type="button" onClick={() => toggle(c.id)} className="flex w-full items-center gap-3 border-t border-line px-3.5 py-2.5 text-left first:border-t-0">
              {c.avatarUrl ? <img src={c.avatarUrl} alt="" className="size-[46px] shrink-0 rounded-full object-cover" /> : <span className="grid size-[46px] shrink-0 place-items-center rounded-full bg-sunken font-bold">{c.title[0]}</span>}
              <span className="min-w-0 flex-1"><b className={cn('block truncate text-[16px]', picked.has(c.id) && 'text-brand')}>{c.title}</b>{c.kind === 'group' && <span className="text-[13.5px] text-text-secondary">Group</span>}</span>
              <Tick on={picked.has(c.id)} />
            </button>
          ))}
          {list.length === 0 && <p className="py-6 text-center text-text-tertiary">Nobody by that name</p>}
        </div>
      </div>
      {/*
        Who it is going to, and the one button. A card floating over the list
        rather than a coloured band across the foot: faces first, because those
        are what somebody checks before a send, then a plain sentence.
      */}
      <div
        className={cn(
          'fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] transition-[transform,opacity] duration-300 ease-[var(--ease-standard)]',
          names.length ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-[130%] opacity-0',
        )}
      >
        {error && <p role="alert" className="mb-2 px-2 text-center text-[13.5px] text-danger">{error}</p>}
        <div className="flex items-center gap-2.5 rounded-[22px] border border-line bg-surface py-2.5 pr-2.5 pl-3 shadow-[0_18px_40px_-18px_rgba(16,17,20,0.45)]">
          <div className="flex shrink-0 -space-x-2">
            {faces.slice(0, 3).map((f, i) =>
              f.img ? (
                <img key={i} src={f.img} alt="" className="size-8 rounded-full object-cover ring-2 ring-surface" />
              ) : (
                <span key={i} className={cn('grid size-8 place-items-center rounded-full text-[13px] font-bold ring-2 ring-surface', f.star ? 'bg-close-friends text-white' : 'bg-sunken text-ink')}>
                  {f.star ? <Star size={14} fill="#fff" /> : f.letter}
                </span>
              ),
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14.5px] font-semibold text-ink">{summary}</p>
            <p className="flex items-center gap-1 text-[12.5px] text-text-secondary">
              {views !== undefined ? (
                <>
                  <Timer size={12} />
                  {views === null ? 'Replay any time' : views === 1 ? 'View once' : 'Can be viewed twice'}
                </>
              ) : (
                `${names.length} ${names.length === 1 ? 'chat' : 'chats'} selected`
              )}
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => onSend([...picked], story)}
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-brand px-4 text-[15px] font-semibold text-white active:scale-95 disabled:opacity-60"
          >
            {busy ? <span className="size-4.5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Send size={18} />}
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- flattening a Ping ------------------------------------------------------------
export async function drawStickers(g: CanvasRenderingContext2D, list: StorySticker[]) {
  // Fractions of whatever frame is being drawn - the editor exports at its stage's shape.
  const W = g.canvas.width, H = g.canvas.height;
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
    } else if (s.type === 'post') {
      // The card as `.sk-postcard` draws it: 54cqw wide, a 4:5 picture, the author above it.
      const w = 54 * unit, r = 3.6 * unit, head = (s.style ?? 0) % 2 === 0 ? 9.6 * unit : 0, ph = w * 1.25, h = head + ph;
      const img = await loadImage(String(d.src ?? ''));
      g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 10 * unit; g.shadowOffsetY = 4 * unit;
      g.fillStyle = head ? '#fff' : '#000'; roundRect(g, -w / 2, -h / 2, w, h, r);
      g.shadowColor = 'transparent';
      g.save(); g.beginPath(); g.roundRect(-w / 2, -h / 2, w, h, r); g.clip();
      if (img) { const k = Math.max(w / img.naturalWidth, ph / img.naturalHeight); g.drawImage(img, -img.naturalWidth * k / 2, -h / 2 + head + ph / 2 - img.naturalHeight * k / 2, img.naturalWidth * k, img.naturalHeight * k); }
      g.restore();
      if (head) {
        const av = await loadImage(String(d.avatar ?? '')); const a = 5.6 * unit, ax = -w / 2 + 2.6 * unit, ay = -h / 2 + (head - a) / 2;
        if (av) { g.save(); g.beginPath(); g.arc(ax + a / 2, ay + a / 2, a / 2, 0, Math.PI * 2); g.clip(); g.drawImage(av, ax, ay, a, a); g.restore(); }
        g.fillStyle = '#111'; g.font = `700 ${3.1 * unit}px Manrope, sans-serif`; g.textAlign = 'left'; g.textBaseline = 'middle';
        g.fillText(String(d.user ?? ''), ax + a + 1.8 * unit, -h / 2 + head / 2);
      }
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
