import type { Message } from '@pingo/core';
import { cn } from '@pingo/ui';
import { Copy, Ellipsis, Flag, Forward, Info, Languages, Pencil, Pin, Reply, Star, Trash, Trash2 } from 'lucide-react';
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
  mine: boolean;
  /** The same actions the More sheet runs; the common ones are listed here directly. */
  quick: {
    pin: () => void;
    star: () => void;
    edit: () => void;
    info: () => void;
    translate: () => void;
    deleteForMe: () => void;
    deleteForEveryone: () => void;
    report: () => void;
  };
}

export function MessageActions({
  message,
  onReply,
  onForward,
  onMore,
  onDone,
  mine,
  quick,
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
     * gets copied in every case, it is the message's text fallback by design.
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

  const run = (fn: () => void) => () => {
    fn();
    onDone();
  };
  const text = message.body.trim().length > 0;

  /*
   * The approved list, iOS's shape: what you reach for most, one tap each,
   * then the destructive ones set apart below a gap. The long tail - remind,
   * share, save, speak, jump - is still one row away, under More.
   */
  return (
    <div
      ref={listRef}
      role="menu"
      aria-label="Message actions"
      onKeyDown={onKeyDown}
      className="lq-glass-water lq-menu w-[236px] overflow-hidden rounded-[22px] py-1"
    >
      <Action label="Reply" icon={<Reply size={19} />} onClick={() => { onReply(message); onDone(); }} />
      {text && <Action label={copied ? 'Copied' : 'Copy'} icon={<Copy size={19} />} onClick={() => void copy()} />}
      <Action label="Forward" icon={<Forward size={19} />} onClick={() => { onForward(message); onDone(); }} />
      <Action label="Pin" icon={<Pin size={19} />} onClick={run(quick.pin)} />
      <Action label="Star" icon={<Star size={19} />} onClick={run(quick.star)} />
      {mine && text && <Action label="Edit" icon={<Pencil size={19} />} onClick={run(quick.edit)} />}
      <Action label="Info" icon={<Info size={19} />} onClick={run(quick.info)} />
      {text && <Action label="Translate" icon={<Languages size={19} />} onClick={run(quick.translate)} />}
      <Action label="More" icon={<Ellipsis size={19} />} onClick={onMore} />
      <div aria-hidden className="h-[7px] bg-text-tertiary/15" />
      {mine && (
        <Action label="Delete for everyone" icon={<Trash2 size={19} />} danger onClick={run(quick.deleteForEveryone)} />
      )}
      <Action label="Delete for me" icon={<Trash size={19} />} danger onClick={run(quick.deleteForMe)} />
      {!mine && <Action label="Report" icon={<Flag size={19} />} danger onClick={run(quick.report)} />}
    </div>
  );
}

function Action({
  label,
  icon,
  danger = false,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'focus-ring flex w-full items-center justify-between gap-3 border-t border-text-tertiary/15 px-4 py-[11px] text-left first:border-t-0 [div+&]:border-t-0',
        'text-[15.5px] font-medium transition-colors duration-instant active:bg-text-tertiary/15',
        danger ? 'text-[#ff453a]' : 'text-ink',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0">{icon}</span>
    </button>
  );
}
