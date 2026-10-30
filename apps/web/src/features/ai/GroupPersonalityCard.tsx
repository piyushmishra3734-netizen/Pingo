import { cn } from '@pingo/ui';
import { Check, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { isAdult } from './personalities.js';
import { AiFace } from './profile/pastel.js';
import {
  GROUP_PERSONALITIES,
  loadMine,
  setMine,
  type GroupPersonality,
  type GroupPersonalityId,
} from './group-personality.js';

/**
 * The card `@pingoai /personality` opens above the composer in a group: pick
 * how PINGO AI talks to you here, then OK.
 *
 * One row that scrolls sideways, like stickers or reactions: it sits over a
 * chat, so it has to stay short and leave the conversation in view. The line
 * under the row says what the highlighted one is like, so the tiles can be
 * just a face and a name.
 *
 * Yours only - said under the question, because the first thing anybody
 * wonders in a group is whether they just changed it for everyone. Spicy is
 * not in the row for anyone under 18 or with no age.
 */
export function GroupPersonalityCard({
  conversationId,
  userId,
  start,
  preview = false,
  onClose,
  onSaved,
}: {
  conversationId: string;
  userId: string;
  /** A name typed after the command, picked to begin with. */
  start?: GroupPersonalityId | undefined;
  /** Dev only: an adult, nothing current, and OK saves nothing. */
  preview?: boolean;
  onClose: () => void;
  onSaved: (picked: GroupPersonality) => void;
}) {
  const [age, setAge] = useState<number | null | undefined>(preview ? 19 : undefined);
  const [current, setCurrent] = useState<GroupPersonalityId | undefined>(preview ? 'friendly' : undefined);
  const [picked, setPicked] = useState<GroupPersonalityId | undefined>(start ?? (preview ? 'friendly' : undefined));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (preview) return;
    let live = true;
    void loadMine(conversationId, userId)
      .then((mine) => {
        if (!live) return;
        setAge(mine.age);
        setCurrent(mine.current);
        setPicked((p) => p ?? mine.current);
      })
      .catch(() => {
        if (!live) return;
        setAge(null);
        setCurrent('friendly');
        setPicked((p) => p ?? 'friendly');
      });
    return () => {
      live = false;
    };
  }, [conversationId, userId, preview]);

  // The picked one in view, so a name typed after the command is not hidden off to the side.
  useEffect(() => {
    rowRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [age]);

  const loaded = age !== undefined;
  const options = GROUP_PERSONALITIES.filter((p) => p.id !== 'spicy' || isAdult(age));
  const choice = options.find((p) => p.id === picked);

  const ok = async () => {
    if (!choice) return;
    if (choice.id === current) return onClose();
    setBusy(true);
    setError(undefined);
    const failed = preview ? undefined : await setMine(conversationId, choice.id);
    setBusy(false);
    if (failed) setError(failed);
    else onSaved(choice);
  };

  return (
    <div
      role="dialog"
      aria-label="PINGO AI personality"
      className="gp-rise pingo-pastel mb-2 overflow-hidden rounded-[24px] shadow-[0_18px_48px_-14px_rgba(40,36,90,0.4)] ring-1 ring-black/5"
    >
      <style>{`
@keyframes gp-rise { from { opacity: 0; transform: translateY(12px) scale(.98) } }
@keyframes gp-tile { from { opacity: 0; transform: translateX(14px) } }
.gp-rise { animation: gp-rise .32s cubic-bezier(.2,.8,.2,1) }
.gp-tile { animation: gp-tile .36s cubic-bezier(.2,.8,.2,1) both }
.gp-row { scrollbar-width: none } .gp-row::-webkit-scrollbar { display: none }
@media (prefers-reduced-motion: reduce) { .gp-rise, .gp-tile { animation: none !important } }`}</style>

      <div className="flex items-center gap-3 px-4 pt-3.5">
        <AiFace src={null} framed className="size-9 shrink-0 ring-2 ring-[var(--pp-card)]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15.5px] font-bold text-[var(--pp-ink)]">How should I talk to you here?</p>
          <p className="truncate text-[12.5px] text-[var(--pp-sub)]">Just for you · everyone else keeps their own</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="focus-ring grid size-8 shrink-0 place-items-center rounded-full text-[var(--pp-sub)] hover:bg-[var(--pp-line)]"
        >
          <X size={18} aria-hidden />
        </button>
      </div>

      <div
        ref={rowRef}
        role="radiogroup"
        aria-label="Personality"
        className="gp-row flex snap-x snap-mandatory gap-2.5 overflow-x-auto scroll-px-4 px-4 pb-2 pt-3"
      >
        {!loaded
          ? Array.from({ length: 5 }, (_, i) => <span key={i} className="h-[92px] w-[78px] shrink-0 animate-pulse rounded-[20px] bg-[var(--pp-card)]" />)
          : options.map((p, i) => {
              const on = picked === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={`${p.label}: ${p.hint}`}
                  onClick={() => setPicked(p.id)}
                  style={{ animationDelay: `${i * 30}ms` }}
                  className={cn(
                    'gp-tile focus-ring relative flex h-[92px] w-[78px] shrink-0 snap-start flex-col items-center justify-center gap-1.5 rounded-[20px] transition-[background-color,box-shadow,transform] active:scale-95',
                    on
                      ? 'bg-[var(--pp-accent-soft)] shadow-[inset_0_0_0_2px_var(--pp-accent)]'
                      : 'bg-[var(--pp-card)] shadow-[var(--pp-shadow)]',
                  )}
                >
                  <span aria-hidden className={cn('grid size-11 place-items-center rounded-full text-[24px] leading-none transition-transform', on ? 'scale-110 bg-[var(--pp-card)]' : 'bg-[var(--pp-bg)]')}>
                    {p.emoji}
                  </span>
                  <span className="max-w-full truncate px-1 text-[12.5px] font-semibold text-[var(--pp-ink)]">{p.label}</span>
                  {on && (
                    <span className="absolute right-1.5 top-1.5 grid size-[18px] place-items-center rounded-full bg-[var(--pp-accent)] text-[var(--pp-accent-ink)]">
                      <Check size={12} strokeWidth={3} aria-hidden />
                    </span>
                  )}
                  {current === p.id && !on && (
                    <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-[var(--pp-online)]" aria-hidden />
                  )}
                </button>
              );
            })}
      </div>

      <p className="min-h-[20px] px-4 text-[13px] text-[var(--pp-sub)]" aria-live="polite">
        {choice && (
          <>
            <span className="font-semibold text-[var(--pp-ink)]">{choice.label}</span> · {choice.hint}
            {current === choice.id && ' · using now'}
          </>
        )}
      </p>

      {error && (
        <p role="alert" className="px-4 pt-1 text-[13px] font-medium text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-2 px-4 pb-4 pt-3">
        <button
          type="button"
          onClick={onClose}
          className="focus-ring h-11 flex-1 rounded-full bg-[var(--pp-card)] text-[15px] font-semibold text-[var(--pp-sub)] shadow-[var(--pp-shadow)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void ok()}
          disabled={!choice || busy}
          className="focus-ring bg-sweep h-11 flex-[1.6] rounded-full text-[15px] font-semibold text-white shadow-[0_8px_22px_-8px_rgba(139,93,255,0.65)] disabled:opacity-50"
        >
          {busy ? 'Saving…' : choice ? `OK · ${choice.emoji} ${choice.label}` : 'OK'}
        </button>
      </div>
    </div>
  );
}
