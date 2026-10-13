import { cn } from '@pingo/ui';
import { Check, Crown } from 'lucide-react';
import { useState } from 'react';

import { saveAiPrefs, useAiPrefs } from '../room/ai-prefs.js';
import { AVATAR_TABS, avatarsIn, canUseAvatar, presetFor, type AiAvatar, type AvatarCategory } from './ai-profile-model.js';
import { AiFace, TopBar } from './pastel.js';

/** The preset faces, by category. Pro ones are for Pingo Pro; everyone else sees them locked. */
export function AvatarPage({ premium, onBack, onPro, onSaved }: { premium: boolean; onBack: () => void; onPro: () => void; onSaved: () => void }) {
  const { prefs } = useAiPrefs();
  const [tab, setTab] = useState<'all' | AvatarCategory>('all');
  const current = presetFor(prefs.avatar_url) ?? (prefs.avatar_url ? undefined : avatarsIn('default')[0]);
  const [picked, setPicked] = useState<AiAvatar | undefined>(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const done = async () => {
    if (!picked || picked.id === current?.id) return onSaved();
    setSaving(true);
    setError(undefined);
    const err = await saveAiPrefs({ avatar_url: picked.src });
    setSaving(false);
    if (err) setError(/pro/i.test(err) ? 'That avatar is part of Pingo Pro.' : err);
    else onSaved();
  };

  return (
    <>
      <TopBar title="Choose Avatar" onBack={onBack} action={{ label: 'Done', onClick: () => void done(), disabled: !picked, busy: saving }} />
      <div role="tablist" aria-label="Avatar categories" className="flex gap-1 overflow-x-auto px-4 pb-3 pt-1 [scrollbar-width:none]">
        {AVATAR_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'shrink-0 rounded-full px-4 py-2 text-[15.5px] font-medium',
              tab === t.id ? 'bg-[var(--pp-accent-soft)] font-semibold text-[var(--pp-accent)]' : 'text-[var(--pp-sub)]',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* The one picked, large, before it is saved. */}
      <div className="flex items-center gap-4 px-4 pb-3">
        <AiFace src={picked?.src ?? prefs.avatar_url} framed className="size-16 shrink-0 ring-2 ring-[var(--pp-accent)]" />
        <div className="min-w-0">
          <p className="text-[16px] font-semibold">{picked?.label ?? 'Your photo'}</p>
          <p className="text-[13.5px] text-[var(--pp-sub)]">{picked && picked.id !== current?.id ? 'Tap Done to use it everywhere' : 'In use now'}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <div role="radiogroup" aria-label="Avatars" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {avatarsIn(tab).map((a) => {
            const locked = !canUseAvatar(a, premium);
            const on = picked?.id === a.id;
            return (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={locked ? `${a.label}, Pingo Pro` : a.label}
                onClick={() => (locked ? onPro() : setPicked(a))}
                className={cn(
                  'relative aspect-square overflow-hidden rounded-[22px] ring-2 transition-transform active:scale-[0.98]',
                  on ? 'ring-[var(--pp-accent)]' : 'ring-transparent',
                )}
              >
                <img src={a.src} alt="" draggable={false} loading="lazy" className={cn('size-full object-cover', locked && 'opacity-70')} />
                {on && (
                  <span className="absolute bottom-2.5 right-2.5 grid size-7 place-items-center rounded-full bg-[var(--pp-accent)] text-[var(--pp-accent-ink)] ring-2 ring-white">
                    <Check size={16} strokeWidth={3} />
                  </span>
                )}
                {locked && (
                  <span className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-[12px] font-bold text-[#8a6400]">
                    <Crown size={13} className="fill-[#f5b81c] text-[#f5b81c]" aria-hidden />
                    Pro
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-center text-[14px] text-danger">
            {error}
          </p>
        )}
      </div>
    </>
  );
}
