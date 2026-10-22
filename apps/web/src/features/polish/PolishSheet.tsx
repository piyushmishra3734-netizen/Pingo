import { cn } from '@pingo/ui';
import { ArrowLeft, Check, Languages, RotateCcw } from 'lucide-react';
import { useRef, useState } from 'react';

import { Sheet } from '../../components/Sheet.js';
import { TRANSLATE_TARGETS } from './languages.js';
import { MAX_POLISH_CHARS, POLISH_MODES, polish, type PolishMode } from './polish.js';
import { lastTarget, rememberTarget } from './target.js';

/**
 * Polish, from the composer: pick what to do to the draft, see the result, then
 * use it or leave the draft alone. Nothing replaces the text until "Use this".
 *
 * The draft's words go to ChatGPT through the `polish` function, and the line at
 * the bottom says so.
 */

export interface PolishSheetProps {
  text: string;
  onUse: (text: string) => void;
  onClose: () => void;
}

type View = 'modes' | 'languages' | 'result';

export function PolishSheet({ text, onUse, onClose }: PolishSheetProps) {
  const [view, setView] = useState<View>('modes');
  const [busy, setBusy] = useState<string>();
  const [result, setResult] = useState<{ label: string; text: string }>();
  const [error, setError] = useState<string>();
  /** A tap on a slow answer must not be overwritten by an older one landing late. */
  const run = useRef(0);

  const tooLong = text.length > MAX_POLISH_CHARS;
  const preferred = lastTarget();
  const targets = [
    ...TRANSLATE_TARGETS.filter((t) => t.code === preferred),
    ...TRANSLATE_TARGETS.filter((t) => t.code !== preferred),
  ];

  const go = async (label: string, mode: PolishMode, target?: string) => {
    if (busy) return;
    const mine = ++run.current;
    setBusy(label);
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

  const title = view === 'languages' ? 'Translate to' : view === 'result' ? (result?.label ?? 'Result') : 'Polish';

  return (
    <Sheet title={title} onClose={onClose}>
      {view === 'modes' && (
        <div className="flex flex-col gap-1">
          <p className="mb-2 line-clamp-2 rounded-lg bg-hover px-3 py-2 text-caption text-text-secondary">{text}</p>
          <ul className="flex flex-col">
            {POLISH_MODES.map((m) => (
              <li key={m.mode}>
                <Row label={m.label} hint={m.hint} busy={busy === m.label} disabled={Boolean(busy) || tooLong} onClick={() => void go(m.label, m.mode)} />
              </li>
            ))}
            <li>
              <Row
                label="Translate"
                hint="Into any language you pick"
                icon={<Languages size={18} aria-hidden />}
                disabled={Boolean(busy) || tooLong}
                onClick={() => setView('languages')}
              />
            </li>
          </ul>
          {tooLong && <p className="px-1 pt-2 text-caption text-danger">That is too long to polish. Trim it under {MAX_POLISH_CHARS} characters.</p>}
        </div>
      )}

      {view === 'languages' && (
        <div className="flex flex-col gap-1">
          <button type="button" onClick={() => setView('modes')} className="mb-1 flex w-fit items-center gap-1 rounded-md px-1 py-1 text-caption text-text-secondary focus-ring">
            <ArrowLeft size={14} aria-hidden /> Back
          </button>
          <ul className="flex max-h-[52vh] flex-col overflow-y-auto">
            {targets.map((t) => (
              <li key={t.code}>
                <Row
                  label={t.native}
                  hint={t.code === 'hinglish' ? 'Hindi in English letters' : t.name}
                  busy={busy === `To ${t.name}`}
                  disabled={Boolean(busy)}
                  onClick={() => {
                    rememberTarget(t.code);
                    void go(`To ${t.name.split(' (')[0]}`, 'translate', t.name);
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {view === 'result' && result && (
        <div className="flex flex-col gap-3">
          <p className="whitespace-pre-wrap break-words rounded-xl bg-hover px-4 py-3 text-body text-ink">{result.text}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setView('modes')}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full border border-line text-body text-ink focus-ring"
            >
              <RotateCcw size={16} aria-hidden /> Try another
            </button>
            <button
              type="button"
              onClick={() => onUse(result.text)}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-brand text-body font-medium text-white focus-ring"
            >
              <Check size={16} aria-hidden /> Use this
            </button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="px-1 pt-2 text-caption text-danger">{error}</p>}
      <p className="px-1 pt-3 text-caption text-text-tertiary">
        Only this text goes to ChatGPT, and only because you tapped. It is not saved.
      </p>
    </Sheet>
  );
}

function Row({
  label,
  hint,
  icon,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  hint: string;
  icon?: React.ReactNode;
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
        'flex w-full items-center justify-between gap-3 rounded-md px-3 py-3 text-left',
        'transition-colors duration-instant ease-standard hover:bg-hover active:bg-pressed focus-ring',
        disabled && !busy && 'opacity-50',
      )}
    >
      <span className="flex min-w-0 flex-col">
        <span className="text-body text-ink">{label}</span>
        <span className="text-caption text-text-secondary">{hint}</span>
      </span>
      {busy ? <span className="text-caption text-text-tertiary">Working…</span> : icon}
    </button>
  );
}

