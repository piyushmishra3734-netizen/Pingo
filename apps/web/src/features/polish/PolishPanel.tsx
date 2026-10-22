import { cn } from '@pingo/ui';
import { Check, ChevronLeft, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { TRANSLATE_TARGETS } from './languages.js';
import { MAX_POLISH_CHARS, polish, type PolishMode } from './polish.js';
import { lastTarget, rememberTarget } from './target.js';

/**
 * Polish, the Telegram way: no sheet, no dimming. A slim strip appears right
 * above the field with one row of options, and the answer replaces that row in
 * place. It takes about one line of height, so the chat stays in view and the
 * draft stays under your thumb. Nothing touches the draft until the tick.
 */

export interface PolishPanelProps {
  text: string;
  onUse: (text: string) => void;
  onClose: () => void;
  className?: string;
}

const MODES: { mode: Exclude<PolishMode, 'translate'>; label: string }[] = [
  { mode: 'grammar', label: 'Grammar' },
  { mode: 'formal', label: 'Formal' },
  { mode: 'casual', label: 'Casual' },
  { mode: 'shorten', label: 'Shorten' },
  { mode: 'expand', label: 'Expand' },
];

type View = 'modes' | 'languages' | 'result';

export function PolishPanel({ text, onUse, onClose, className }: PolishPanelProps) {
  const [view, setView] = useState<View>('modes');
  const [busy, setBusy] = useState<string>();
  const [result, setResult] = useState<{ label: string; text: string }>();
  const [error, setError] = useState<string>();
  const [more, setMore] = useState(false);
  const run = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  // Escape, or a tap anywhere outside, puts it away.
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', away);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('pointerdown', away);
    };
  }, [onClose]);

  const tooLong = text.length > MAX_POLISH_CHARS;
  const preferred = lastTarget();

  const go = async (key: string, label: string, mode: PolishMode, target?: string) => {
    if (busy) return;
    const mine = ++run.current;
    setBusy(key);
    setError(undefined);
    try {
      const out = await polish(mode, text, target);
      if (mine !== run.current) return;
      setResult({ label, text: out });
      setView('result');
    } catch (e) {
      if (mine !== run.current) return;
      setError(e instanceof Error ? e.message : 'That did not work. Try again.');
    } finally {
      if (mine === run.current) setBusy(undefined);
    }
  };

  const translate = (code: string) => {
    const t = TRANSLATE_TARGETS.find((x) => x.code === code);
    if (!t) return;
    rememberTarget(code);
    void go(`t:${code}`, `To ${t.name.split(' (')[0]}`, 'translate', t.name);
  };

  const pill = (active?: boolean) =>
    cn(
      'shrink-0 rounded-full px-2 py-1.5 text-[12px] font-medium whitespace-nowrap transition-colors duration-instant ease-standard focus-ring',
      active ? 'bg-brand/12 text-brand' : 'text-ink hover:bg-hover active:bg-pressed',
      'disabled:opacity-50',
    );

  return (
    <div
      ref={box}
      role="group"
      aria-label="Polish"
      className={cn(
        'glass-surface overflow-hidden rounded-2xl border border-line/60 p-1 shadow-lg motion-safe:animate-panel-in',
        className,
      )}
    >
      {view === 'modes' && (
        <div className="flex items-center gap-0 overflow-x-auto [scrollbar-width:none]">
          {MODES.map((m) => (
            <button key={m.mode} type="button" disabled={Boolean(busy) || tooLong} className={pill()} onClick={() => void go(m.mode, m.label, m.mode)}>
              {busy === m.mode ? 'Working…' : m.label}
            </button>
          ))}
          <button type="button" disabled={Boolean(busy) || tooLong} className={cn(pill(), 'text-brand')} onClick={() => setView('languages')}>
            Translate
          </button>
        </div>
      )}

      {view === 'languages' && (
        <div className="flex flex-col">
          <div className="flex items-center gap-0 overflow-x-auto [scrollbar-width:none]">
            <button type="button" aria-label="Back" className="shrink-0 rounded-full p-1.5 text-text-secondary hover:bg-hover focus-ring" onClick={() => (more ? setMore(false) : setView('modes'))}>
              <ChevronLeft size={16} aria-hidden />
            </button>
            {TRANSLATE_TARGETS.slice(0, 2).map((t) => (
              <button key={t.code} type="button" disabled={Boolean(busy)} className={pill(t.code === preferred)} onClick={() => translate(t.code)}>
                {busy === `t:${t.code}` ? 'Working…' : t.native}
              </button>
            ))}
            <button type="button" className={cn(pill(more), 'text-text-secondary')} onClick={() => setMore((m) => !m)}>
              More
            </button>
          </div>
          {more && (
            <div className="mt-1 flex max-h-28 flex-wrap gap-0.5 overflow-y-auto border-t border-line/60 pt-1">
              {TRANSLATE_TARGETS.slice(2).map((t) => (
                <button key={t.code} type="button" disabled={Boolean(busy)} className={pill(t.code === preferred)} onClick={() => translate(t.code)}>
                  {busy === `t:${t.code}` ? 'Working…' : t.native}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {view === 'result' && result && (
        <div className="flex flex-col gap-1 px-2.5 pb-1 pt-1.5">
          <span className="text-[11.5px] font-medium text-brand">{result.label}</span>
          <p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-body text-ink">{result.text}</p>
          <div className="-mr-1 flex items-center justify-end gap-0.5">
            <button type="button" aria-label="Try another" className="rounded-full p-2 text-text-secondary hover:bg-hover focus-ring" onClick={() => setView('modes')}>
              <RotateCcw size={16} aria-hidden />
            </button>
            <button type="button" aria-label="Discard" className="rounded-full p-2 text-text-secondary hover:bg-hover focus-ring" onClick={onClose}>
              <X size={16} aria-hidden />
            </button>
            <button type="button" aria-label="Use this" className="grid size-9 place-items-center rounded-full bg-brand text-white active:opacity-80 focus-ring" onClick={() => onUse(result.text)}>
              <Check size={17} aria-hidden />
            </button>
          </div>
        </div>
      )}

      {(error || tooLong) && (
        <p role="alert" className="px-3 pb-1.5 pt-0.5 text-[12px] text-danger">
          {tooLong ? `Too long to polish. Keep it under ${MAX_POLISH_CHARS} characters.` : error}
        </p>
      )}
    </div>
  );
}
