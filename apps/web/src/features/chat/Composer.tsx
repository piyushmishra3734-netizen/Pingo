import { IconButton, MicIcon, SendIcon, SmileIcon, cn } from '@pingo/ui';
import { useLayoutEffect, useRef, useState } from 'react';

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
  placeholder?: string;
  /** Announced to screen readers, e.g. "Message Anaya Sharma". */
  ariaLabel?: string;
  className?: string;
}

/** Growth cap, in px. Roughly six lines before the field starts to scroll. */
const MAX_HEIGHT = 140;

export function Composer({
  onSend,
  placeholder = 'Type a message...',
  ariaLabel = 'Message',
  className,
}: ComposerProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasText = value.trim().length > 0;

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
    <div className={cn('flex items-end gap-2', className)}>
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
          onChange={(event) => setValue(event.target.value)}
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

        <IconButton label="Add emoji" size="sm" variant="ghost" className="mb-0.5">
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
  );
}
