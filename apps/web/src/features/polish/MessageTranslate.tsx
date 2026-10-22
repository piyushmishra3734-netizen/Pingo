import { cn } from '@pingo/ui';
import { Languages, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Sheet } from '../../components/Sheet.js';
import { TRANSLATE_TARGETS, foreignLanguage, targetName } from './languages.js';
import { cachedPolish, polish } from './polish.js';
import { lastTarget, rememberTarget } from './target.js';

/**
 * Under somebody's message, only when it is in a language that is not English or
 * Hinglish: a quiet Translate link. Tap it and English and Hinglish are right
 * there as chips, with "More" for the rest. The answer appears under the
 * original, which stays put.
 *
 * Detection is local and costs nothing. The words only leave the phone when a
 * language is chosen, and an answer already fetched once is shown from memory.
 */

const name = (code: string) => targetName(code).split(' (')[0] ?? code;
const apiName = (code: string) => TRANSLATE_TARGETS.find((t) => t.code === code)?.name ?? code;

export function MessageTranslate({ body, mine }: { body: string; mine: boolean }) {
  const [from, setFrom] = useState<string>();
  const [choosing, setChoosing] = useState(false);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [shown, setShown] = useState<{ code: string; text: string }>();
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    void foreignLanguage(body).then((code) => {
      if (!live) return;
      setFrom(code);
      // Already translated before, to the language last used: show it without a tap.
      const code2 = lastTarget();
      const hit = code ? cachedPolish('translate', body, apiName(code2)) : undefined;
      if (hit) setShown({ code: code2, text: hit });
    });
    return () => {
      live = false;
    };
  }, [body]);

  if (!from) return null;

  const translate = async (code: string) => {
    rememberTarget(code);
    setChoosing(false);
    setMore(false);
    setError(false);
    setBusy(code);
    try {
      setShown({ code, text: await polish('translate', body, apiName(code)) });
    } catch {
      setError(true);
    } finally {
      setBusy(undefined);
    }
  };

  const quiet = mine ? 'text-white/85' : 'text-brand';
  const chip = cn(
    'rounded-full border px-3 py-1 text-caption font-medium transition-colors duration-instant ease-standard focus-ring',
    mine ? 'border-white/30 text-white hover:bg-white/15' : 'border-brand/30 text-brand hover:bg-brand/10',
  );
  const quick = TRANSLATE_TARGETS.slice(0, 2);

  return (
    <>
      <div className="mt-1.5 flex flex-col gap-1.5 border-t border-current/10 pt-1.5">
        {shown && (
          <p className="text-body break-words whitespace-pre-wrap" lang={shown.code === 'hinglish' ? 'hi-Latn' : shown.code}>
            {shown.text}
          </p>
        )}

        {choosing && !shown ? (
          <div className="flex flex-wrap items-center gap-1.5 motion-safe:animate-panel-in">
            {quick.map((t) => (
              <button key={t.code} type="button" className={chip} onClick={() => void translate(t.code)}>
                {t.native}
              </button>
            ))}
            <button type="button" className={chip} onClick={() => setMore(true)}>
              More
            </button>
            <button type="button" aria-label="Cancel" className={cn('rounded-full p-1 focus-ring', quiet)} onClick={() => setChoosing(false)}>
              <X size={14} aria-hidden />
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => (shown ? setShown(undefined) : setChoosing(true))}
            className={cn('flex w-fit items-center gap-1 text-caption font-medium focus-ring', quiet)}
          >
            <Languages size={13} aria-hidden />
            {busy
              ? `Translating to ${name(busy)}…`
              : error
                ? 'Could not translate. Tap to retry'
                : shown
                  ? `Translated to ${name(shown.code)} · Hide`
                  : `Translate from ${name(from)}`}
          </button>
        )}
      </div>

      {more && (
        <Sheet title="Translate to" onClose={() => setMore(false)}>
          <ul className="flex max-h-[52vh] flex-col overflow-y-auto">
            {TRANSLATE_TARGETS.filter((t) => t.code !== from).map((t) => (
              <li key={t.code}>
                <button
                  type="button"
                  onClick={() => void translate(t.code)}
                  className="flex w-full items-baseline justify-between gap-3 rounded-md px-3 py-3 text-left transition-colors duration-instant ease-standard hover:bg-hover active:bg-pressed focus-ring"
                >
                  <span className="text-body text-ink">{t.native}</span>
                  <span className="text-caption text-text-tertiary">{name(t.code)}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="px-1 pt-3 text-caption text-text-tertiary">Only this message goes to ChatGPT, and only because you tapped. It is not saved.</p>
        </Sheet>
      )}
    </>
  );
}
