import type { StickerAnswer, StickerResult, StorySticker } from '@pingo/core';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import './stickers.css';

/**
 * One story sticker, drawn the same way where it is placed and where it is
 * watched.
 *
 * `mode="edit"` makes its words editable in place; `mode="view"` makes the
 * interactive ones interactive - a poll takes a vote, a slider slides - and
 * everything else reports a tap to the viewer, which decides what a tap on a
 * place or a person means.
 */

export const FONTS = [
  { k: 'classic', name: 'Classic' }, { k: 'modern', name: 'Modern' }, { k: 'neon', name: 'Neon' },
  { k: 'type', name: 'Typewriter' }, { k: 'strong', name: 'Strong' }, { k: 'elegant', name: 'Elegant' }, { k: 'direct', name: 'Directional' },
] as const;
export const TEXT_COLORS = ['#ffffff', '#000000', '#0a84ff', '#34c759', '#ffcc00', '#ff9500', '#ff3b30', '#e0559b', '#bf5af2', '#5e5ce6', '#64d2ff', '#a2845e'];
export const TEXT_ANIMS = ['none', 'type', 'pop', 'wave', 'flicker'] as const;
/** How many looks a tap cycles through, per type. */
export const STYLE_COUNT: Partial<Record<StorySticker['type'], number>> = { loc: 4, men: 4, tag: 4, link: 4, post: 2, clock: 2 };

export interface TextData { text: string; font: string; color: string; bg: 'none' | 'solid' | 'soft'; align: 'left' | 'center' | 'right'; size: number; anim: string }

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const light = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 160;
};

/** Where a sticker sits: its centre at x, y of the frame, then turned and scaled. */
export function stickerStyle(s: StorySticker, scale = s.s): CSSProperties {
  return {
    left: `${s.x * 100}%`,
    top: `${s.y * 100}%`,
    transform: `translate(-50%, -50%) rotate(${s.r}deg) scale(${scale})`,
  };
}

/** Text as it was typed, with the size given in the frame's own units. */
export function TextSticker({ d, editable, innerRef, onInput }: {
  d: TextData;
  editable?: boolean;
  innerRef?: React.Ref<HTMLDivElement>;
  onInput?: (text: string) => void;
}) {
  const style: CSSProperties = { fontSize: `${(d.size / 390) * 100}cqw`, textAlign: d.align };
  if (d.bg === 'solid') { style.background = d.color; style.color = light(d.color) ? '#111' : '#fff'; }
  else style.color = d.color;
  const anim = !editable && d.anim && d.anim !== 'none' ? `sk-anim-${d.anim}` : '';
  const perChar = !editable && (d.anim === 'type' || d.anim === 'wave');
  return (
    <div
      ref={innerRef}
      className={`sk-txt sk-f-${d.font} sk-bg-${d.bg} ${anim} outline-none`}
      style={style}
      contentEditable={editable || undefined}
      suppressContentEditableWarning
      spellCheck={false}
      onInput={onInput ? (e) => onInput((e.currentTarget as HTMLDivElement).innerText.replace(/\n$/, '')) : undefined}
    >
      {editable ? undefined : perChar
        ? [...d.text].map((c, i) => (c === '\n' ? <br key={i} /> : <span key={i} className="sk-ch" style={{ animationDelay: `${i * 55}ms` }}>{c}</span>))
        : d.text}
    </div>
  );
}

function pad(n: number) { return String(Math.max(0, n)).padStart(2, '0'); }
function Countdown({ to }: { to: string }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick((n) => n + 1), 20000); return () => window.clearInterval(t); }, []);
  const m = Math.floor(Math.max(0, Date.parse(to) - Date.now()) / 60000);
  const parts: [string, string][] = [[pad(Math.floor(m / 1440)), 'days'], [pad(Math.floor((m % 1440) / 60)), 'hours'], [pad(m % 60), 'minutes']];
  return (
    <div className="sk-digits">
      {parts.map(([v, l], i) => (
        <span key={l} style={{ display: 'contents' }}>
          {i > 0 && <span className="sk-colon">:</span>}
          <span className="sk-grp"><span className="sk-d"><i>{v[0]}</i><i>{v[1]}</i></span><small>{l}</small></span>
        </span>
      ))}
    </div>
  );
}

const Pin = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>);
const Chain = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>);

export interface StickerViewProps {
  sticker: StorySticker;
  mode: 'edit' | 'view';
  /** The signed-in user's own answer, if they gave one. */
  answer?: StickerAnswer;
  /** Totals for this sticker, once answered. */
  results?: StickerResult[];
  onAnswer?: (answer: StickerAnswer, el?: HTMLElement) => void;
  /** A tap that is not an answer: a place, a person, a link, a question, a song. */
  onTap?: (el: HTMLElement) => void;
  /** Edit mode: a card's words changed. `field` is `q` or `o0`, `o1`... */
  onEditField?: (field: string, text: string) => void;
  /** The slider is being dragged: the story should hold still meanwhile. */
  onBusy?: (busy: boolean) => void;
}

export function StickerView({ sticker: s, mode, answer, results = [], onAnswer, onTap, onEditField, onBusy }: StickerViewProps) {
  const d = s.d;
  const view = mode === 'view';
  const edit = (field: string, text: string, cls: string, tag: 'div' | 'span' = 'div'): ReactNode => {
    const Tag = tag;
    return (
      <Tag
        className={cls}
        contentEditable={!view || undefined}
        suppressContentEditableWarning
        spellCheck={false}
        onBlur={!view ? (e: React.FocusEvent<HTMLElement>) => onEditField?.(field, e.currentTarget.textContent?.trim() ?? '') : undefined}
      >{text}</Tag>
    );
  };
  const tap = (e: React.MouseEvent<HTMLElement>) => { if (view) onTap?.(e.currentTarget); };
  const style = s.style ?? 0;

  switch (s.type) {
    case 'text':
      return <TextSticker d={d as unknown as TextData} />;
    case 'loc':
      return <div className={`sk-chip sk-loc s${style}`} onClick={tap}><Pin />{str(d.text)}</div>;
    case 'men':
      return <div className={`sk-chip sk-men s${style}`} onClick={tap}><span>@{str(d.text)}</span></div>;
    case 'tag':
      return <div className={`sk-chip sk-tag s${style}`} onClick={tap}>#{str(d.text)}</div>;
    case 'link':
      return <div className={`sk-chip sk-link s${style}`} onClick={tap}><Chain />{str(d.text).replace(/^https?:\/\//, '')}</div>;
    case 'poll': {
      const opts = (d.opts as string[] | undefined) ?? ['YES', 'NO'];
      const voted = answer?.choice !== undefined;
      // The server's totals, with one's own vote counted even before they arrive.
      const serverHasMine = results.some((r) => r.votes > 0);
      const count = (i: number) => (results.find((r) => r.choice === i)?.votes ?? 0) + (!serverHasMine && answer?.choice === i ? 1 : 0);
      const total = opts.reduce((a, _, i) => a + count(i), 0) || 1;
      return (
        <div className={`sk-card sk-poll ${voted ? 'sk-voted' : ''}`}>
          {edit('q', str(d.q, 'Ask a question…'), 'sk-q')}
          <div className="sk-opts">
            {opts.map((o, i) => (
              <div key={i} className={`sk-opt ${answer?.choice === i ? 'sk-mine' : ''}`}
                onClick={view && !voted ? () => onAnswer?.({ choice: i }) : undefined} role={view ? 'button' : undefined}>
                <span className="sk-fill" style={{ width: voted ? `${Math.round((count(i) / total) * 100)}%` : 0 }} />
                {edit(`o${i}`, o, 'sk-lb', 'span')}
                <span className="sk-pct">{voted ? Math.round((count(i) / total) * 100) : 0}%</span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    case 'question':
      return (
        <div className="sk-card sk-question" onClick={tap} role={view ? 'button' : undefined}>
          {edit('q', str(d.q, 'Ask me a question'), 'sk-q')}
          <div className="sk-ans">{view ? 'Type something…' : 'Viewers respond here'}</div>
        </div>
      );
    case 'countdown':
      return (
        <div className="sk-card sk-countdown" onClick={!view ? tap : undefined}>
          {edit('q', str(d.q, 'Countdown'), 'sk-q')}
          <Countdown to={str(d.to, new Date().toISOString())} />
          {view && (
            <button type="button" className={`sk-remind ${answer?.remind ? 'sk-on' : ''}`}
              onClick={(e) => { e.stopPropagation(); if (!answer?.remind) onAnswer?.({ remind: true }); }}>
              {answer?.remind ? 'Reminder set' : 'Remind me'}
            </button>
          )}
        </div>
      );
    case 'slider':
      return <Slider s={s} view={view} answer={answer} results={results} onAnswer={onAnswer} onBusy={onBusy} edit={edit} />;
    case 'quiz': {
      const opts = (d.opts as string[] | undefined) ?? ['A', 'B', 'C'];
      const right = num(d.right);
      const pick = answer?.choice;
      return (
        <div className="sk-card sk-quiz">
          {edit('q', str(d.q, 'Guess what?'), 'sk-q')}
          <div className="sk-os">
            {opts.map((o, i) => (
              <button key={i} type="button" data-i={i}
                className={`sk-o ${pick !== undefined && i === right ? 'sk-right' : ''} ${pick === i && i !== right ? 'sk-wrong' : ''} ${!view && i === right ? 'sk-right' : ''}`}
                onClick={view && pick === undefined ? (e) => onAnswer?.({ choice: i }, e.currentTarget) : undefined}>
                <b>{'ABC'[i]}</b>{edit(`o${i}`, o, '', 'span')}
              </button>
            ))}
          </div>
        </div>
      );
    }
    case 'music':
      return (
        <div className="sk-music" onClick={tap}>
          {str(d.img) && <img src={str(d.img)} alt="" />}
          <div><b>{str(d.name)}</b><span><span className="sk-eq"><i /><i /><i /></span>{str(d.artist)}</span></div>
        </div>
      );
    case 'clock': {
      const t = new Date(num(d.at, Date.now()));
      const hm = t.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' }).replace(/\s?(AM|PM)/i, '');
      return style % 2 === 0
        ? <div className="sk-clock">{hm}<small>{t.getHours() < 12 ? 'AM' : 'PM'}</small></div>
        : <div className="sk-chip s0" style={{ color: '#111', fontSize: '5.6cqw' }}>{t.toLocaleDateString('en', { weekday: 'long' })} · {hm}</div>;
    }
    case 'emoji':
      return <div className="sk-emoji"><img src={str(d.src)} alt="" /></div>;
    case 'post':
      return (
        <div className={`sk-postcard s${style}`} onClick={tap}>
          <header>{str(d.avatar) && <img src={str(d.avatar)} alt="" />}{str(d.user)}</header>
          <img src={str(d.src)} alt="" />
        </div>
      );
  }
  return null;
}

function Slider({ s, view, answer, results, onAnswer, onBusy, edit }: {
  s: StorySticker; view: boolean; answer?: StickerAnswer; results: StickerResult[];
  onAnswer?: (a: StickerAnswer, el?: HTMLElement) => void; onBusy?: (b: boolean) => void;
  edit: (field: string, text: string, cls: string) => ReactNode;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [v, setV] = useState<number | undefined>(answer?.slide);
  useEffect(() => setV(answer?.slide), [answer?.slide]);
  const avg = results[0]?.average ?? num(s.d.avg, 0.7);
  const emoji = str(s.d.emoji, '😍');
  const pos = v ?? 0;
  const drag = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!view || answer) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    onBusy?.(true);
    const at = (x: number) => { const r = track.current!.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)); };
    setV(at(e.clientX));
    const el = e.currentTarget;
    let last = at(e.clientX);
    el.onpointermove = (ev) => { last = at(ev.clientX); setV(last); };
    el.onpointerup = () => { el.onpointermove = null; el.onpointerup = null; onBusy?.(false); onAnswer?.({ slide: last }); };
  };
  return (
    <div className={`sk-card sk-slider ${answer ? 'sk-answered' : ''}`}>
      {edit('q', str(s.d.q, 'Ask a question…'), 'sk-q')}
      <div className="sk-track" ref={track}>
        <span className="sk-done" style={{ width: `${pos * 100}%` }} />
        <span className="sk-avg" style={{ left: `${avg * 100}%` }}>{Math.round(avg * 100)}</span>
        <span className="sk-knob" style={{ left: `${pos * 100}%`, fontSize: v !== undefined && !answer ? `${8.7 + pos * 6}cqw` : undefined }}
          onPointerDown={drag}>{emoji}</span>
      </div>
    </div>
  );
}
