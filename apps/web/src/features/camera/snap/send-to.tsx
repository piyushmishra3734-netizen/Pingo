import { useChat, useProfile, type StorySticker } from '@pingo/core';
import { cn } from '@pingo/ui';
import { ChevronDown, CircleCheck, Circle, Search, Send, Star, Timer, UsersRound } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { TextData } from '../../stories/stickers/StickerView.js';

const W = 1080, H = 1920;

/**
 * Snapchat's Send to, for anything leaving the camera or the story editor:
 * My story or Close friends at the top, the chats below - the ones sent to
 * most first - and a bar along the foot naming who it is going to.
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
