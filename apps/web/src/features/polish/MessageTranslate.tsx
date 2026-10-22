import { cn } from '@pingo/ui';
import { Languages } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Sheet } from '../../components/Sheet.js';
import { TRANSLATE_TARGETS, foreignLanguage, targetName } from './languages.js';
import { polish } from './polish.js';
import { lastTarget, rememberTarget } from './target.js';

/**
 * Under somebody's message, only when it is in a language that is not English or
 * Hinglish: a small Translate link. The reader picks the language, and the
 * answer appears under the original, which stays put.
 *
 * Detection is local and runs for nothing. The words only leave the phone when
 * Translate is tapped and a language chosen.
 */

const cache = new Map<string, string>();

export function MessageTranslate({ body, mine }: { body: string; mine: boolean }) {
  const from = useMemo(() => foreignLanguage(body), [body]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<{ code: string; text: string }>();
  const [error, setError] = useState(false);

  if (!from) return null;

  const translate = async (code: string) => {
    const name = TRANSLATE_TARGETS.find((t) => t.code === code)?.name ?? code;
    rememberTarget(code);
    setPicking(false);
    setError(false);
    const key = `${code}|${body}`;
    const hit = cache.get(key);
    if (hit) {
      setShown({ code, text: hit });
      return;
    }
    setBusy(true);
    try {
      const text = await polish('translate', body, name);
      cache.set(key, text);
      setShown({ code, text });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const preferred = lastTarget();
  const targets = [
    ...TRANSLATE_TARGETS.filter((t) => t.code === preferred),
    ...TRANSLATE_TARGETS.filter((t) => t.code !== preferred && t.code !== from),
  ];
  const quiet = mine ? 'text-white/80' : 'text-brand';

  return (
    <>
      <div className="mt-1.5 flex flex-col gap-1 border-t border-current/10 pt-1.5">
        {shown && (
          <p className="text-body break-words whitespace-pre-wrap" lang={shown.code}>
            {shown.text}
          </p>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => (shown ? setShown(undefined) : setPicking(true))}
          className={cn('flex w-fit items-center gap-1 text-caption font-medium focus-ring', quiet)}
        >
          <Languages size={13} aria-hidden />
          {busy
            ? 'Translating…'
            : error
              ? 'Could not translate. Try again'
              : shown
                ? `Translated to ${targetName(shown.code).split(' (')[0]}. Hide`
                : `Translate from ${targetName(from).split(' (')[0]}`}
        </button>
      </div>

      {picking && (
        <Sheet title="Translate to" description="Only this message is sent to ChatGPT, and only now." onClose={() => setPicking(false)}>
          <ul className="flex max-h-[52vh] flex-col overflow-y-auto">
            {targets.map((t) => (
              <li key={t.code}>
                <button
                  type="button"
                  onClick={() => void translate(t.code)}
                  className="flex w-full flex-col rounded-md px-3 py-3 text-left transition-colors duration-instant ease-standard hover:bg-hover active:bg-pressed focus-ring"
                >
                  <span className="text-body text-ink">{t.native}</span>
                  <span className="text-caption text-text-secondary">{t.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </>
  );
}
