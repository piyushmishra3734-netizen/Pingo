import { useProfile } from '@pingo/core';
import { ChevronRight, ImagePlus } from 'lucide-react';
import { useRef, useState } from 'react';

import { BannerBackdrop } from '../conversations/BannerBackdrop.js';
import { ChatBannerPicker } from './ChatBannerPicker.js';
import { prepareCover } from './cover-gif.js';

/**
 * Edit profile's "Chat banner" row: what your friends see behind your name in
 * their chat lists, and the sheet to change it.
 *
 * Saved the moment it is picked, not with the form - it is its own thing, and a
 * banner that only applies after a Save further down the page is one people
 * think did not work.
 */
export function ChatBannerSection() {
  const { profile, update, service } = useProfile();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);
  if (!profile) return null;

  const premium = profile.isPremium === true;
  const current = profile.chatBannerUrl;

  const save = async (url: string | undefined) => {
    setBusy(true);
    setError(undefined);
    try {
      await update({ chatBannerUrl: url });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    setBusy(true);
    setError(undefined);
    try {
      // A still picture only: a moving banner behind every row of a chat list is noise, not decoration.
      if (file.type === 'image/gif') {
        setError('A chat banner is a still picture. GIFs work as your profile photo.');
        return;
      }
      // Shrunk the way a cover is.
      const prepared = await prepareCover(file, premium);
      if (!prepared.ok) {
        setError(prepared.reason);
        return;
      }
      const url = await service.uploadChatBanner(prepared.file);
      await update({ chatBannerUrl: url });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not upload. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="focus-ring relative flex w-full items-center gap-3 overflow-hidden rounded-[28px] bg-surface p-[18px] text-left active:scale-[0.995]"
      >
        {current && <BannerBackdrop src={current} />}
        <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-brand/10 text-brand">
          <ImagePlus size={20} aria-hidden />
        </span>
        <span className="relative min-w-0 flex-1">
          <span className="block text-body font-semibold text-ink">Chat banner</span>
          <span className="block text-caption text-text-secondary">{current ? 'Shown behind your name in chats' : 'Add a banner to your chat row'}</span>
        </span>
        <ChevronRight size={20} className="relative shrink-0 text-text-tertiary" aria-hidden />
      </button>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void upload(file);
        }}
      />

      {open && (
        <ChatBannerPicker
          current={current}
          premium={premium}
          me={{ id: profile.id, name: profile.displayName, avatarUrl: profile.avatarUrl }}
          busy={busy}
          error={error}
          onPick={(banner) => void save(banner.src)}
          onRemove={() => void save(undefined)}
          onUpload={() => fileRef.current?.click()}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
