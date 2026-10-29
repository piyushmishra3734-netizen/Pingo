import { cn } from '@pingo/ui';
import { Check, X } from 'lucide-react';
import { useEffect, useState } from 'react';

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
 * Yours only - the line under the question says so, because the first thing
 * anybody wonders in a group is whether they just changed it for everyone.
 * Spicy is not on the list for anyone under 18 or with no age.
 */
export function GroupPersonalityCard({
  conversationId,
  userId,
  start,
  onClose,
  onSaved,
}: {
  conversationId: string;
  userId: string;
  /** A name typed after the command, picked to begin with. */
  start?: GroupPersonalityId | undefined;
  onClose: () => void;
  onSaved: (picked: GroupPersonality) => void;
}) {
  const [age, setAge] = useState<number | null>();
  const [current, setCurrent] = useState<GroupPersonalityId>();
  const [picked, setPicked] = useState<GroupPersonalityId | undefined>(start);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    void loadMine(conversationId, userId)
      .then((mine) => {
        if (!live) return;
        setAge(mine.age);
        setCurrent(mine.current);
        setPicked((p) => p ?? mine.current);
      })
      .catch(() => live && setAge(null));
    return () => {
      live = false;
    };
  }, [conversationId, userId]);

  const loaded = age !== undefined;
  const options = GROUP_PERSONALITIES.filter((p) => p.id !== 'spicy' || isAdult(age));
  const choice = options.find((p) => p.id === picked);

  const ok = async () => {
    if (!choice) return;
    if (choice.id === current) return onClose();
    setBusy(true);
    setError(undefined);
    const failed = await setMine(conversationId, choice.id);
    setBusy(false);
    if (failed) setError(failed);
    else onSaved(choice);
  };

  return (
    <div
      role="dialog"
      aria-label="PINGO AI personality"
      className="pingo-pastel mb-2 overflow-hidden rounded-[24px] shadow-[0_18px_48px_-14px_rgba(40,36,90,0.4)] ring-1 ring-black/5"
      style={{ animation: 'gp-rise .32s cubic-bezier(.2,.8,.2,1)' }}
    >
      <style>{'@keyframes gp-rise { from { opacity: 0; transform: translateY(12px) scale(.98) } } @media (prefers-reduced-motion: reduce) { [aria-label="PINGO AI personality"] { animation: none !important } }'}</style>
      <div className="flex items-start gap-3 px-4 pt-4">
        <AiFace src={null} framed className="size-10 shrink-0 ring-2 ring-[var(--pp-card)]" />
        <div className="min-w-0 flex-1">
          <p className="text-[16.5px] font-bold leading-snug text-[var(--pp-ink)]">How should I talk to you here?</p>
          <p className="mt-0.5 text-[13px] leading-snug text-[var(--pp-sub)]">
            Just for you. Everyone else keeps their own · tag @pingoai to chat
          </p>
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

      <div role="radiogroup" aria-label="Personality" className="grid max-h-[46vh] grid-cols-2 gap-2 overflow-y-auto px-4 pb-1 pt-3">
        {!loaded
          ? Array.from({ length: 6 }, (_, i) => <span key={i} className="h-[58px] animate-pulse rounded-2xl bg-[var(--pp-card)]" />)
          : options.map((p) => {
              const on = picked === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setPicked(p.id)}
                  className={cn(
                    'focus-ring relative flex items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left transition-[background-color,box-shadow] active:scale-[0.98]',
                    on
                      ? 'bg-[var(--pp-accent-soft)] shadow-[inset_0_0_0_2px_var(--pp-accent)]'
                      : 'bg-[var(--pp-card)] shadow-[var(--pp-shadow)]',
                  )}
                >
                  <span aria-hidden className="text-[22px] leading-none">{p.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-semibold text-[var(--pp-ink)]">
                      {p.label}
                      {current === p.id && <span className="ml-1 text-[11.5px] font-medium text-[var(--pp-faint)]">· now</span>}
                    </span>
                    <span className="block truncate text-[12px] text-[var(--pp-sub)]">{p.hint}</span>
                  </span>
                  {on && (
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[var(--pp-accent)] text-[var(--pp-accent-ink)]">
                      <Check size={13} strokeWidth={3} aria-hidden />
                    </span>
                  )}
                </button>
              );
            })}
      </div>

      {error && (
        <p role="alert" className="px-4 pt-2 text-[13px] font-medium text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-2 p-4">
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
          className="focus-ring bg-sweep h-11 flex-[1.4] rounded-full text-[15px] font-semibold text-white shadow-[0_8px_22px_-8px_rgba(139,93,255,0.65)] disabled:opacity-50"
        >
          {busy ? 'Saving…' : choice ? `OK · ${choice.emoji} ${choice.label}` : 'OK'}
        </button>
      </div>
    </div>
  );
}
