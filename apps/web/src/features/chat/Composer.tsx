import type { Sticker } from '@pingo/core';
import { IconButton, ImageIcon, MicIcon, SendIcon, SmileIcon, cn } from '@pingo/ui';
import { useLayoutEffect, useRef, useState } from 'react';

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
  // One panel at a time: two open at once would cover the thread entirely.
  const [panel, setPanel] = useState<'emoji' | 'stickers' | undefined>();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasText = value.trim().length > 0;

  const toggle = (next: 'emoji' | 'stickers') =>
    setPanel((current) => (current === next ? undefined : next));

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
      {panel && (
        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
          {panel === 'emoji' ? (
            <EmojiPicker
              onSelect={(emoji) => {
                // Appended rather than sent: an emoji is part of a message,
                // where a sticker is the whole of one.
                setValue((current) => current + emoji);
                textareaRef.current?.focus();
              }}
              onClose={() => setPanel(undefined)}
            />
          ) : (
            <StickerPicker
              onSelect={(sticker) => {
                void onSendSticker?.(sticker);
                setPanel(undefined);
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

        {onSendSticker && (
          <IconButton
            label="Stickers"
            size="sm"
            variant="ghost"
            className={cn('mb-0.5', panel === 'stickers' && 'text-brand')}
            onClick={() => toggle('stickers')}
          >
            <ImageIcon size={20} />
          </IconButton>
        )}

        <IconButton
          label="Add emoji"
          size="sm"
          variant="ghost"
          className={cn('mb-0.5', panel === 'emoji' && 'text-brand')}
          onClick={() => toggle('emoji')}
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
        <IconButton label="Record voice message" variant="filled" className="mb-0.5">
          <MicIcon size={20} />
        </IconButton>
      )}
      </div>
    </div>
  );
}
