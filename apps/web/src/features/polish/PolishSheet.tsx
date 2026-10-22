import { cn } from '@pingo/ui';
import { ArrowLeft, Briefcase, Check, Expand, Languages, RotateCcw, Scissors, Smile, SpellCheck, WandSparkles } from 'lucide-react';
import { useRef, useState, type ComponentType } from 'react';

import { Sheet } from '../../components/Sheet.js';
import { TRANSLATE_TARGETS } from './languages.js';
import { MAX_POLISH_CHARS, polish, type PolishMode } from './polish.js';
import { lastTarget, rememberTarget } from './target.js';

/**
 * Polish, from the composer. Your draft sits on top, the six things you can do to
 * it are tiles underneath, and the answer replaces the tiles in place so the
 * sheet never changes height or jumps. Nothing touches the draft until
 * "Use this".
 */

export interface PolishSheetProps {
  text: string;
  onUse: (text: string) => void;
  onClose: () => void;
}

type Icon = ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;

const TILES: { mode: Exclude<PolishMode, 'translate'>; label: string; hint: string; icon: Icon }[] = [
  { mode: 'grammar', label: 'Fix grammar', hint: 'Typos, same vibe', icon: SpellCheck },
  { mode: 'formal', label: 'Formal', hint: 'Polite, for work', icon: Briefcase },
  { mode: 'casual', label: 'Casual', hint: 'Like a friend', icon: Smile },
  { mode: 'shorten', label: 'Shorten', hint: 'Fewer words', icon: Scissors },
  { mode: 'expand', label: 'Expand', hint: 'More detail', icon: Expand },
];

type View = 'modes' | 'languages' | 'result';

export function PolishSheet({ text, onUse, onClose }: PolishSheetProps) {
  const [view, setView] = useState<View>('modes');
  const [busy, setBusy] = useState<string>();
  const [result, setResult] = useState<{ label: string; text: string }>();
  const [error, setError] = useState<string>();
  /** A slow answer must not overwrite a newer one landing first. */
  const run = useRef(0);

  const tooLong = text.length > MAX_POLISH_CHARS;
  const preferred = lastTarget();
  const quick = TRANSLATE_TARGETS.slice(0, 2);
  const rest = TRANSLATE_TARGETS.slice(2);

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
    void go(`t:${code}`, `Translated to ${t.name.split(' (')[0]}`, 'translate', t.name);
  };

  return (
    <Sheet title="Polish" onClose={onClose} hideTitle>
      <div className="flex flex-col gap-4">
        <header className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-full bg-brand/12 text-brand">
            <WandSparkles size={18} aria-hidden />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-body font-semibold text-ink">Polish</span>
            <span className="text-caption text-text-secondary">Make it sound right, then send</span>
          </span>
        </header>

        <p className="line-clamp-3 rounded-2xl bg-hover px-4 py-3 text-body text-ink/80">{text}</p>

        {view === 'modes' && (
          <div className="flex flex-col gap-3 motion-safe:animate-panel-in">
            <div className="grid grid-cols-2 gap-2">
              {TILES.map(({ mode, label, hint, icon: Icon }) => (
                <Tile key={mode} busy={busy === mode} disabled={Boolean(busy) || tooLong} onClick={() => void go(mode, label, mode)}>
                  <Icon size={18} aria-hidden />
                  <span className="text-body font-medium text-ink">{label}</span>
                  <span className="text-caption text-text-secondary">{hint}</span>
                </Tile>
              ))}
              <Tile disabled={Boolean(busy) || tooLong} onClick={() => setView('languages')}>
                <Languages size={18} aria-hidden />
                <span className="text-body font-medium text-ink">Translate</span>
                <span className="text-caption text-text-secondary">English, Hinglish, more</span>
              </Tile>
            </div>
            {tooLong && <p className="text-caption text-danger">Too long to polish. Trim it under {MAX_POLISH_CHARS} characters.</p>}
          </div>
        )}

        {view === 'languages' && (
          <div className="flex flex-col gap-3 motion-safe:animate-panel-in">
            <button type="button" onClick={() => setView('modes')} className="flex w-fit items-center gap-1 text-caption text-text-secondary focus-ring">
              <ArrowLeft size={14} aria-hidden /> Back
            </button>
            <div className="grid grid-cols-2 gap-2">
              {quick.map((t) => (
                <button
                  key={t.code}
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => translate(t.code)}
                  className={cn(
                    'flex h-14 items-center justify-center rounded-2xl border text-body font-medium transition-colors duration-instant ease-standard focus-ring',
                    t.code === preferred ? 'border-brand bg-brand/10 text-brand' : 'border-line text-ink hover:bg-hover',
                    busy && busy !== `t:${t.code}` && 'opacity-50',
                  )}
                >
                  {busy === `t:${t.code}` ? 'Working…' : t.native}
                </button>
              ))}
            </div>
            <p className="text-caption font-medium uppercase tracking-wide text-text-tertiary">More languages</p>
            <ul className="-mt-1 flex max-h-[30vh] flex-wrap gap-1.5 overflow-y-auto">
              {rest.map((t) => (
                <li key={t.code}>
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => translate(t.code)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-caption transition-colors duration-instant ease-standard focus-ring',
                      t.code === preferred ? 'border-brand bg-brand/10 text-brand' : 'border-line text-ink hover:bg-hover',
                    )}
                  >
                    {busy === `t:${t.code}` ? 'Working…' : t.native}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {view === 'result' && result && (
          <div className="flex flex-col gap-3 motion-safe:animate-panel-in">
            <div className="flex flex-col gap-1.5 rounded-2xl border border-brand/25 bg-brand/8 px-4 py-3">
              <span className="text-caption font-medium text-brand">{result.label}</span>
              <p className="whitespace-pre-wrap break-words text-body text-ink">{result.text}</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setView('modes')}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full border border-line text-body text-ink transition-colors duration-instant ease-standard hover:bg-hover focus-ring"
              >
                <RotateCcw size={16} aria-hidden /> Try another
              </button>
              <button
                type="button"
                onClick={() => onUse(result.text)}
                className="flex h-11 flex-[1.4] items-center justify-center gap-2 rounded-full bg-brand text-body font-medium text-white transition-opacity duration-instant ease-standard active:opacity-80 focus-ring"
              >
                <Check size={16} aria-hidden /> Use this
              </button>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="text-caption text-danger">
            {error}
          </p>
        )}
        <p className="text-caption text-text-tertiary">Only this text goes to ChatGPT, and only because you tapped. It is not saved.</p>
      </div>
    </Sheet>
  );
}

function Tile({
  children,
  busy,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'relative flex flex-col items-start gap-0.5 rounded-2xl border border-line px-3.5 py-3 text-left text-brand',
        'transition-[background-color,transform] duration-instant ease-standard hover:bg-hover active:scale-[0.98] focus-ring',
        disabled && !busy && 'opacity-50',
        busy && 'animate-pulse border-brand/40 bg-brand/8',
      )}
    >
      {children}
    </button>
  );
}
