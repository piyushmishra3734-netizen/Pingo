import type { Sticker } from '@pingo/core';
import { IconButton, MicIcon, SendIcon, SmileIcon, cn } from '@pingo/ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { EmojiPicker } from '../emoji/EmojiPicker.js';
import { StickerPicker } from '../stickers/StickerPicker.js';

/**
 * The message composer.
 *
 * A `textarea` that grows with its content up to a cap, then scrolls. A
 * single-line input would silently hide the middle of a long message while the
 * user is still writing it.
 *
 * The send control swaps to a microphone when the field is empty, so the primary
 * action is always the one that makes sense — and the button never sits there
 * disabled, which is a dead-end the user has to reason about.
 *
 * Enter sends; Shift+Enter makes a newline. On touch, Enter always inserts a
 * newline instead, because there is no visible Shift key to discover.
 */

export interface ComposerProps {
  onSend: (body: string) => void | Promise<void>;
  /** Absent means the surface cannot take stickers, and the button is hidden. */
  onSendSticker?: (sticker: Sticker) => void | Promise<void>;
  placeholder?: string;
  /** Called as the field fills and empties, so the other side sees the dots. */
  onTyping?: (typing: boolean) => void | Promise<void>;
  /** Announced to screen readers, e.g. "Message Anaya Sharma". */
  ariaLabel?: string;
  className?: string;
}

/** Growth cap, in px. Roughly six lines before the field starts to scroll. */
const MAX_HEIGHT = 140;

export function Composer({
  onSend,
  onSendSticker,
  onTyping,
  placeholder = 'Type a message...',
  ariaLabel = 'Message',
  className,
}: ComposerProps) {
  const [value, setValue] = useState('');
  /**
   * One panel, two tabs.
   *
   * Emoji and stickers used to be separate buttons opening separate panels,
   * which meant two icons to learn and two things that could each be the open
   * one. They are two drawers of the same cupboard, so they share a panel and
   * emoji is the default — it is what the button is reached for nine times out
   * of ten.
   */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tab, setTab] = useState<'emoji' | 'stickers'>('emoji');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasText = value.trim().length > 0;

  /** A short, self-clearing line for things the composer cannot do yet. */
  const [notice, setNotice] = useState<string>();
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(undefined), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Autosize before paint, so the field never renders at the wrong height first.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  const submit = () => {
    if (!hasText) return;
    void onSend(value);
    setValue('');
    // Keep focus so a conversation can be held entirely from the keyboard.
    textareaRef.current?.focus();
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {notice && (
        <p role="status" className="px-1 text-caption text-text-tertiary">
          {notice}
        </p>
      )}
      {pickerOpen && (
        <div
          className={cn(
            'overflow-hidden rounded-xl border border-line bg-surface shadow-lg',
            // Anchored to the composer, so it grows from its bottom edge.
            'origin-bottom animate-panel-in',
          )}
        >
          <PickerTabs tab={tab} onTab={setTab} showStickers={Boolean(onSendSticker)} />

          {tab === 'emoji' ? (
            <EmojiPicker
              onSelect={(emoji) => {
                // Appended rather than sent: an emoji is part of a message,
                // where a sticker is the whole of one.
                setValue((current) => current + emoji);
                textareaRef.current?.focus();
              }}
              onClose={() => setPickerOpen(false)}
            />
          ) : (
            <StickerPicker
              onSelect={(sticker) => {
                void onSendSticker?.(sticker);
                setPickerOpen(false);
              }}
            />
          )}
        </div>
      )}

      <div className="flex items-end gap-2">
      <div
        className={cn(
          'flex min-w-0 flex-1 items-end gap-2 bg-sunken',
          'rounded-xl border border-transparent px-3 py-2',
          'transition-[background-color,border-color,box-shadow] duration-instant ease-standard',
          'focus-within:bg-surface focus-within:border-line-strong focus-within:shadow-sm',
        )}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            /*
              Reported on every keystroke; the service throttles. Stopping is
              sent the moment the field empties, because a late "still typing"
              is harmless and a late "stopped" leaves the dots up.
            */
            void onTyping?.(event.target.value.length > 0);
          }}
          onKeyDown={(event) => {
            const touch = window.matchMedia('(pointer: coarse)').matches;
            if (event.key === 'Enter' && !event.shiftKey && !touch) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className={cn(
            'min-w-0 flex-1 resize-none bg-transparent outline-none',
            'py-1.5 text-body text-ink placeholder:text-text-tertiary',
            'scrollbar-none',
          )}
        />

        {/*
          One button for emoji *and* stickers. They are two drawers of the same
          cupboard — both "insert something that is not typed" — and giving each
          its own icon meant two things to learn and two panels that could each
          be the open one. Emoji leads because it is what the button is reached
          for nine times in ten.
        */}
        <IconButton
          label="Emoji and stickers"
          size="sm"
          variant="ghost"
          className={cn('mb-0.5', pickerOpen && 'text-brand')}
          onClick={() => setPickerOpen((was) => !was)}
        >
          <SmileIcon size={20} />
        </IconButton>
      </div>

      {hasText ? (
        <IconButton
          label="Send message"
          variant="gradient"
          onClick={submit}
          className="mb-0.5"
        >
          {/* Nudged to sit optically centred inside the circle. */}
          <SendIcon size={19} className="-translate-x-px translate-y-px" />
        </IconButton>
      ) : (
        /*
         * Voice messages are not built, so the control says so instead of
         * pretending. It had no `onClick` at all — a filled, primary-looking
         * button that did nothing when pressed, which is the worst version of
         * this: it looks more available than a text link would.
         *
         * Recording needs a message kind, a storage bucket and an upload path,
         * none of which exist. Until they do this states the fact once, quietly,
         * rather than failing silently on every press.
         */
        <IconButton
          label="Voice messages aren't available yet"
          variant="ghost"
          className="mb-0.5 text-text-tertiary"
          onClick={() => setNotice("Voice messages aren't available yet.")}
        >
          <MicIcon size={20} />
        </IconButton>
      )}
      </div>
    </div>
  );
}

/**
 * The two tabs above the picker.
 *
 * A segmented strip rather than a row of icons, because the tabs are a choice
 * between two whole surfaces and the current one has to be obvious without
 * looking at what is underneath. Absent entirely when the surface takes no
 * stickers — one tab is not a choice.
 */
function PickerTabs({
  tab,
  onTab,
  showStickers,
}: {
  tab: 'emoji' | 'stickers';
  onTab: (next: 'emoji' | 'stickers') => void;
  showStickers: boolean;
}) {
  if (!showStickers) return null;

  const tabs = [
    { id: 'emoji' as const, label: 'Emoji' },
    { id: 'stickers' as const, label: 'Stickers' },
  ];

  return (
    <div role="tablist" aria-label="Emoji and stickers" className="flex gap-1 border-b border-line p-1.5">
      {tabs.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="tab"
          aria-selected={tab === entry.id}
          onClick={() => onTab(entry.id)}
          className={cn(
            'focus-ring flex-1 rounded-lg px-3 py-1.5 text-caption font-medium',
            'transition-colors duration-instant',
            tab === entry.id
              ? 'bg-selected text-brand'
              : 'text-text-secondary hover:bg-hover hover:text-ink',
          )}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );
}
