import type { Message } from '@pingo/core';
import { ChatIcon, ChevronRightIcon, cn } from '@pingo/ui';
import { useRef, useState } from 'react';

/**
 * Level 1: the four actions that are always there.
 *
 * docs/13 § 1.2 and § 2.1 - Reply, Copy, Forward, More, in that order, never
 * reordered by frequency. The order is the feature: a menu that rearranges
 * itself destroys the muscle memory it was trying to reward.
 *
 * ## No placeholders
 *
 * Every row here does its work. `More` opens Level 2, which is the one thing
 * that legitimately leads somewhere else.
 */

export interface MessageActionsProps {
  message: Message;
  onReply: (message: Message) => void;
  onForward: (message: Message) => void;
  onMore: () => void;
  onDone: () => void;
}

export function MessageActions({
  message,
  onReply,
  onForward,
  onMore,
  onDone,
}: MessageActionsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  /** Vertical arrows walk the list; the bar above uses horizontal ones. */
  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();

    const buttons = [...(listRef.current?.querySelectorAll('button') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[(index + step + buttons.length) % buttons.length];
    next?.focus();
  };

  const copy = async () => {
    /*
     * A Ping has no text and a sticker's text is its emoji, so `body` is what
     * gets copied in every case - it is the message's text fallback by design.
     */
    try {
      await navigator.clipboard.writeText(message.body);
      navigator.vibrate?.(4);
      setCopied(true);
      // Confirmed in place rather than with a toast: the menu is still on
      // screen, and a toast would arrive after it has gone.
      window.setTimeout(onDone, 420);
    } catch {
      // Clipboard can be refused. Closing silently would look like it worked.
      setCopied(false);
    }
  };

  return (
    <div
      ref={listRef}
      role="menu"
      aria-label="Message actions"
      onKeyDown={onKeyDown}
      className="bg-surface border border-line w-44 overflow-hidden rounded-xl py-1 shadow-lg"
    >
      <Action
        label="Reply"
        icon={<ChatIcon size={17} />}
        onClick={() => {
          onReply(message);
          onDone();
        }}
      />
      <Action
        label={copied ? 'Copied' : 'Copy'}
        icon={<span className="text-[0.95rem] leading-none">📋</span>}
        onClick={() => void copy()}
      />
      <Action
        label="Forward"
        icon={<span className="text-[0.95rem] leading-none">📤</span>}
        onClick={() => {
          onForward(message);
          onDone();
        }}
      />
      <Action
        label="More"
        icon={<span className="text-[0.95rem] leading-none">⋯</span>}
        trailing={<ChevronRightIcon size={15} className="text-text-tertiary" />}
        onClick={onMore}
      />
    </div>
  );
}

function Action({
  label,
  icon,
  trailing,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  trailing?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'focus-ring flex w-full items-center gap-2.5 px-3 py-2.5 text-left',
        'text-body text-ink transition-colors duration-instant',
        'hover:bg-hover active:bg-pressed',
      )}
    >
      <span className="grid w-5 shrink-0 place-items-center text-text-secondary">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}
