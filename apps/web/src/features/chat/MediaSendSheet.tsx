import type { VideoEdit } from '@pingo/core';
import { useProfile } from '@pingo/core';
import { cn } from '@pingo/ui';
import { ChevronRight, Pencil, Play, Plus, Scissors, Send, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Overlay } from '../../components/Overlay.js';
import { SnapEditor } from '../camera/SnapEditor.js';
import { isAnimatedImage } from './animated-image.js';
import { isStillImage, toStandardQuality } from './media-quality.js';
import { VideoTrimSheet } from './VideoTrimSheet.js';

/**
 * Photos and videos, reviewed together before they go - WhatsApp's send page,
 * drawn the iPhone way.
 *
 * Everything picked is on one page, pictures and clips mixed, in the order
 * chosen: the one in front large, the rest on a strip underneath. Swipe or tap
 * to move between them; the pencil draws on a photo, the scissors trim a clip;
 * the bin takes the one in front out and the strip's plus adds more. One caption for the
 * lot, riding on the first. HD (premium) and view once sit where WhatsApp puts
 * them - HD at the top, the "1" beside the caption.
 */

export interface PickedMedia {
  file: File;
  kind: 'image' | 'video';
}

export type SendItem =
  | { kind: 'photo'; image: Blob }
  | { kind: 'video'; file: File; edit?: VideoEdit };

export interface MediaSendSheetProps {
  items: PickedMedia[];
  /** Who it is going to, for the line above the caption. */
  to: string;
  onCancel: () => void;
  /** Vets more picks (size, length) the way the first ones were, and returns the ones allowed. */
  onAddMore: (files: File[]) => Promise<PickedMedia[]>;
  onSend: (items: SendItem[], caption: string, viewOnce: boolean) => Promise<void>;
}

interface Slot extends PickedMedia {
  key: string;
  url: string;
  edited?: Blob;
  editedUrl?: string;
  trim?: VideoEdit;
  animated?: boolean;
}

let nextKey = 0;
const slotOf = (m: PickedMedia): Slot => ({ ...m, key: `m${(nextKey += 1)}`, url: URL.createObjectURL(m.file) });

export function MediaSendSheet({ items, to, onCancel, onAddMore, onSend }: MediaSendSheetProps) {
  const { profile } = useProfile();
  const premium = profile?.isPremium === true;
  const [slots, setSlots] = useState<Slot[]>(() => items.map(slotOf));
  const [index, setIndex] = useState(0);
  const [caption, setCaption] = useState('');
  const [hd, setHd] = useState(false);
  const [once, setOnce] = useState(false);
  const [editing, setEditing] = useState<'draw' | 'trim'>();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  const track = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLInputElement>(null);

  // Object URLs go with the sheet.
  const all = useRef(slots);
  all.current = slots;
  useEffect(() => () => all.current.forEach((s) => { URL.revokeObjectURL(s.url); if (s.editedUrl) URL.revokeObjectURL(s.editedUrl); }), []);

  // Which pictures move: those are sent as they are and cannot be drawn on.
  useEffect(() => {
    const unknown = slots.filter((s) => s.kind === 'image' && s.animated === undefined);
    if (!unknown.length) return;
    void Promise.all(unknown.map(async (s) => [s.key, await isAnimatedImage(s.file)] as const)).then((found) =>
      setSlots((list) => list.map((s) => { const hit = found.find(([k]) => k === s.key); return hit ? { ...s, animated: hit[1] } : s; })));
  }, [slots]);

  const say = (text: string) => { setNote(text); window.setTimeout(() => setNote((n) => (n === text ? undefined : n)), 1800); };
  const current = slots[index];
  const hasVideo = useMemo(() => slots.some((s) => s.kind === 'video'), [slots]);

  const goTo = (i: number) => {
    setIndex(i);
    const el = track.current?.children[i] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  };
  const onScroll = () => {
    const el = track.current; if (!el) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== index && i >= 0 && i < slots.length) setIndex(i);
  };

  const remove = () => {
    if (!current) return;
    if (slots.length === 1) { onCancel(); return; }
    URL.revokeObjectURL(current.url);
    setSlots((list) => list.filter((s) => s.key !== current.key));
    setIndex((i) => Math.min(i, slots.length - 2));
  };

  const add = async (files: File[]) => {
    const ok = await onAddMore(files);
    if (!ok.length) return;
    const start = slots.length;
    setSlots((list) => [...list, ...ok.map(slotOf)]);
    window.setTimeout(() => goTo(start), 60);
  };

  const send = async () => {
    setBusy(true);
    try {
      const out: SendItem[] = await Promise.all(slots.map(async (s): Promise<SendItem> => {
        if (s.kind === 'video') return { kind: 'video', file: s.file, ...(s.trim ? { edit: s.trim } : {}) };
        const blob = s.edited ?? s.file;
        // Standard quality unless HD was asked for (premium); anything that moves goes as it is.
        const image = hd && premium ? blob : isStillImage(blob) ? await toStandardQuality(new File([blob], s.file.name, { type: blob.type })) : blob;
        return { kind: 'photo', image };
      }));
      await onSend(out, caption.trim(), once);
    } catch {
      say('Those did not send. Try again.');
      setBusy(false);
    }
  };

  if (editing === 'draw' && current?.kind === 'image') {
    return (
      <Overlay onDismiss={() => setEditing(undefined)}>
        <div className="fixed inset-0 z-500 bg-black">
          <SnapEditor
            src={current.editedUrl ?? current.url}
            onCancel={() => setEditing(undefined)}
            doneLabel="Done"
            onDone={(blob) => {
              const url = URL.createObjectURL(blob);
              setSlots((list) => list.map((s) => { if (s.key !== current.key) return s; if (s.editedUrl) URL.revokeObjectURL(s.editedUrl); return { ...s, edited: blob, editedUrl: url }; }));
              setEditing(undefined);
            }}
          />
        </div>
      </Overlay>
    );
  }
  if (editing === 'trim' && current?.kind === 'video') {
    return (
      <VideoTrimSheet
        src={current.url}
        {...(current.trim ? { initial: current.trim } : {})}
        doneLabel="Done"
        onDone={(edit) => {
          if (edit) setSlots((list) => list.map((s) => (s.key === current.key ? { ...s, trim: edit } : s)));
          setEditing(undefined);
        }}
      />
    );
  }

  return (
    <Overlay onDismiss={onCancel}>
      <div className="fixed inset-0 z-500 flex flex-col bg-black text-white select-none" role="dialog" aria-modal="true" aria-label="Send photos and videos">
        {/* top: close, then what can be done to the one in front, and HD */}
        <div className="flex items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
          <button type="button" aria-label="Close" onClick={onCancel} className="grid size-10 place-items-center rounded-full bg-white/12 active:bg-white/20"><X size={21} /></button>
          <div className="flex items-center gap-2">
            {slots.length > 1 && (
              <button type="button" aria-label="Remove this one" onClick={remove} className="grid size-10 place-items-center rounded-full bg-white/12 active:bg-white/20"><Trash2 size={18} /></button>
            )}
            {current?.kind === 'image' && !current.animated && (
              <button type="button" aria-label="Draw and edit" onClick={() => setEditing('draw')} className="grid size-10 place-items-center rounded-full bg-white/12 active:bg-white/20"><Pencil size={18} /></button>
            )}
            {current?.kind === 'video' && (
              <button type="button" aria-label="Trim" onClick={() => setEditing('trim')} className={cn('grid size-10 place-items-center rounded-full active:bg-white/20', current.trim ? 'bg-white text-black' : 'bg-white/12')}><Scissors size={18} /></button>
            )}
            <button
              type="button"
              role="switch"
              aria-checked={hd && premium}
              aria-label="HD"
              onClick={() => { if (!premium) { say('HD is part of PINGO premium'); return; } setHd((h) => !h); }}
              className={cn('h-8 rounded-full px-3 text-[13px] font-bold tracking-wide ring-1', hd && premium ? 'bg-white text-black ring-white' : 'text-white/85 ring-white/35')}
            >
              HD
            </button>
          </div>
        </div>

        {/* the one in front, and the rest by swiping */}
        <div className="relative min-h-0 flex-1">
          <div ref={track} onScroll={onScroll} className="scrollbar-none absolute inset-0 flex snap-x snap-mandatory overflow-x-auto">
            {slots.map((s) => (
              <div key={s.key} className="relative grid h-full w-full shrink-0 snap-center place-items-center px-1">
                {s.kind === 'image'
                  ? <img src={s.editedUrl ?? s.url} alt="" draggable={false} className="max-h-full max-w-full rounded-[4px] object-contain" />
                  : <PreviewVideo src={s.url} active={s === current} {...(s.trim ? { trim: s.trim } : {})} />}
              </div>
            ))}
          </div>
          {note && <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center"><span className="rounded-full bg-white/15 px-3.5 py-1.5 text-[13px] font-medium backdrop-blur-md">{note}</span></div>}
        </div>

        {/* the strip: every one picked, the bin, and more */}
        <div className="scrollbar-none flex items-center gap-1.5 overflow-x-auto px-3 pt-3 pb-2">
          {slots.map((s, i) => (
            <button key={s.key} type="button" aria-label={`${s.kind === 'video' ? 'Video' : 'Photo'} ${i + 1} of ${slots.length}`} aria-current={i === index}
              onClick={() => goTo(i)}
              className={cn('relative size-[52px] shrink-0 overflow-hidden rounded-[10px] transition-[transform,opacity] duration-150', i === index ? 'ring-2 ring-white' : 'opacity-70')}>
              {s.kind === 'image'
                ? <img src={s.editedUrl ?? s.url} alt="" className="size-full object-cover" />
                : <video src={`${s.url}#t=0.1`} muted playsInline preload="metadata" className="size-full object-cover" />}
              {s.kind === 'video' && <Play size={12} fill="#fff" className="absolute bottom-1 left-1 drop-shadow" />}
            </button>
          ))}
          <button type="button" aria-label="Add more" onClick={() => more.current?.click()} className="grid size-[52px] shrink-0 place-items-center rounded-[10px] bg-white/12 active:bg-white/20"><Plus size={22} /></button>
          <input ref={more} type="file" accept="image/*,video/*" multiple hidden
            onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) void add(f); }} />
        </div>

        {/* caption, view once, and send */}
        <div className="flex items-end gap-2 px-3 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded-[22px] bg-white/12 pr-1 pl-4">
            <input
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxLength={1000}
              placeholder="Add a caption…"
              aria-label="Caption"
              className="min-w-0 flex-1 bg-transparent py-2.5 text-[16px] text-white outline-none placeholder:text-white/50"
            />
            <button
              type="button"
              role="switch"
              aria-checked={once}
              aria-label="View once"
              onClick={() => { const on = !once; setOnce(on); say(on ? (hasVideo ? 'Photos open once, then they are gone' : 'Opens once, then it is gone') : 'Stays in the chat'); }}
              className={cn('grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-bold ring-[1.5px] ring-dashed', once ? 'bg-white text-black ring-white' : 'text-white/85 ring-white/60')}
            >
              1
            </button>
          </div>
          <button type="button" aria-label="Send" disabled={busy} onClick={() => void send()}
            className="bg-brand-gradient grid size-11 shrink-0 place-items-center rounded-full text-on-brand shadow-[0_6px_18px_color-mix(in_srgb,var(--gradient-from)_40%,transparent)] disabled:opacity-60">
            {busy ? <span className="size-5 animate-spin rounded-full border-2 border-white/35 border-t-white" /> : <Send size={19} />}
          </button>
        </div>
        <p className="flex items-center justify-center gap-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] text-[12px] text-white/50">
          <ChevronRight size={12} />{to}{slots.length > 1 ? ` · ${slots.length} items` : ''}
        </p>
      </div>
    </Overlay>
  );
}

/** A picked clip, playing inside its trim while it is the one in front. */
function PreviewVideo({ src, active, trim }: { src: string; active: boolean; trim?: VideoEdit }) {
  const v = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const el = v.current; if (!el) return;
    if (!active) { el.pause(); setPlaying(false); }
  }, [active]);
  useEffect(() => {
    const el = v.current; if (!el) return;
    const from = trim?.trimStart ?? 0, to = trim?.trimEnd;
    const tick = () => { if (to !== undefined && el.currentTime >= to) el.currentTime = from; };
    el.currentTime = from;
    el.addEventListener('timeupdate', tick);
    return () => el.removeEventListener('timeupdate', tick);
  }, [trim]);
  return (
    <button type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={() => { const el = v.current; if (!el) return; if (el.paused) { void el.play(); setPlaying(true); } else { el.pause(); setPlaying(false); } }}
      className="relative grid max-h-full max-w-full place-items-center">
      <video ref={v} src={src} playsInline loop muted={trim?.muted ?? false} preload="metadata" className="max-h-full max-w-full rounded-[4px] object-contain" />
      {!playing && <span className="absolute grid size-16 place-items-center rounded-full bg-black/45 backdrop-blur-sm"><Play size={28} fill="#fff" /></span>}
    </button>
  );
}
