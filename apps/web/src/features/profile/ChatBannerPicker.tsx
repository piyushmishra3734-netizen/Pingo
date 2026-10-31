import { Avatar, cn } from '@pingo/ui';
import { Ban, Check, Crown, Upload } from 'lucide-react';
import { useState } from 'react';

import { Sheet } from '../../components/Sheet.js';
import { BannerBackdrop } from '../conversations/BannerBackdrop.js';
import { CHAT_BANNER_COLLECTIONS, sameBanner, type ChatBanner } from './chat-banners.js';

/**
 * Choosing your chat banner: what your row looks like in everybody else's chat
 * list.
 *
 * A live row sits at the top, so the choice is judged where it will be seen -
 * a banner that is lovely as a rectangle can drown a name. Collections for
 * everybody; your own upload for PINGO premium, crowned for everyone else so it
 * reads as an invitation rather than a missing feature.
 */
export function ChatBannerPicker({
  current,
  premium,
  me,
  busy,
  error,
  onPick,
  onRemove,
  onUpload,
  onClose,
}: {
  current: string | null | undefined;
  premium: boolean;
  me: { id: string; name: string; avatarUrl?: string | undefined };
  busy: boolean;
  error: string | undefined;
  onPick: (banner: ChatBanner) => void;
  onRemove: () => void;
  /** Opens the file picker; only offered to premium. */
  onUpload: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState(CHAT_BANNER_COLLECTIONS[0]!.id);
  const shown = CHAT_BANNER_COLLECTIONS.find((c) => c.id === tab) ?? CHAT_BANNER_COLLECTIONS[0]!;

  return (
    <Sheet title="Chat banner" description="Shown behind your name in your friends' chat lists." onClose={onClose}>
      {/* The row, as a friend sees it. */}
      <div className="relative mb-4 flex items-center gap-3 overflow-hidden rounded-2xl bg-surface px-3 py-2.5 ring-1 ring-line">
        {current && <BannerBackdrop src={current} />}
        <span className="relative">
          <Avatar name={me.name} id={me.id} {...(me.avatarUrl ? { src: me.avatarUrl } : {})} size="lg" />
        </span>
        <span className="relative min-w-0 flex-1">
          <span className="block truncate text-[16px] font-semibold text-ink">{me.name}</span>
          <span className="block truncate text-[14px] text-text-secondary">hey, kya chal raha hai?</span>
        </span>
        <span className="relative text-[12px] text-text-tertiary">now</span>
        {busy && <span className="absolute inset-0 animate-pulse bg-surface/40" aria-hidden />}
      </div>

      {error && (
        <p role="alert" className="mb-3 text-[13.5px] font-medium text-danger">
          {error}
        </p>
      )}

      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => (premium ? onUpload() : undefined)}
          aria-disabled={!premium}
          className={cn(
            'focus-ring flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left ring-1 ring-line',
            premium ? 'bg-surface active:scale-[0.99]' : 'bg-sunken',
          )}
        >
          <Upload size={18} className={premium ? 'text-brand' : 'text-text-tertiary'} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14.5px] font-semibold text-ink">Upload your own</span>
            {!premium && (
              <span className="flex items-center gap-1 text-[12px] font-semibold text-[#a16207]">
                <Crown size={12} aria-hidden /> Premium
              </span>
            )}
          </span>
        </button>
        {current && (
          <button
            type="button"
            onClick={onRemove}
            className="focus-ring flex shrink-0 items-center gap-2 rounded-2xl bg-surface px-3.5 text-[14.5px] font-semibold text-text-secondary ring-1 ring-line"
          >
            <Ban size={17} aria-hidden /> None
          </button>
        )}
      </div>

      {CHAT_BANNER_COLLECTIONS.length > 1 && (
        <div role="tablist" aria-label="Collections" className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1">
          {CHAT_BANNER_COLLECTIONS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={c.id === tab}
              onClick={() => setTab(c.id)}
              className={cn(
                'focus-ring h-9 shrink-0 rounded-full px-4 text-[14px] font-semibold',
                c.id === tab ? 'bg-ink text-surface' : 'bg-sunken text-text-secondary',
              )}
            >
              {c.title}
            </button>
          ))}
        </div>
      )}

      <div role="radiogroup" aria-label={shown.title} className="grid grid-cols-2 gap-2.5 pb-2">
        {shown.banners.map((banner) => {
          const on = sameBanner(current, banner.src);
          return (
            <button
              key={banner.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={banner.label}
              disabled={busy}
              onClick={() => onPick(banner)}
              className={cn(
                'focus-ring relative aspect-[3/1] overflow-hidden rounded-2xl bg-sunken bg-cover bg-center active:scale-[0.98]',
                on && 'ring-[3px] ring-brand ring-offset-2 ring-offset-surface',
              )}
              style={{ backgroundImage: `url(${banner.src})` }}
            >
              {on && (
                <span className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-brand text-on-brand">
                  <Check size={14} strokeWidth={3} aria-hidden />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
