import type { Conversation } from '@pingo/core';
import {
  ArchiveIcon,
  CloseIcon,
  IconButton,
  MoreIcon,
  PinIcon,
  TrashIcon,
  UnarchiveIcon,
  cn,
} from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

/**
 * What the header becomes while chats are selected.
 *
 * It replaces the normal bar in place rather than sliding in over it, so the
 * screen does not appear to gain a layer — you are in the same list, doing
 * something to part of it.
 *
 * ## Three actions, then everything else
 *
 * Pin, Archive and Delete are here because they account for almost every reason
 * anyone multi-selects chats. The rest are real, and they are one tap away
 * behind `⋯` — putting eleven icons in a row would make the three that matter
 * as hard to find as the eight that do not.
 *
 * ## Why the actions are stateful rather than fixed
 *
 * Selecting three pinned chats offers Unpin, not Pin. A bar that always says
 * "Pin" and silently does nothing on an already-pinned chat is a bar that lies
 * about what the button will do.
 */

export interface SelectionBarProps {
  selected: Conversation[];
  onCancel: () => void;
  onPin: (pinned: boolean) => void;
  onArchive: (archived: boolean) => void;
  onDelete: () => void;
  /** The overflow contents, rendered by the list which owns the actions. */
  menu: React.ReactNode;
}

export function SelectionBar({
  selected,
  onCancel,
  onPin,
  onArchive,
  onDelete,
  menu,
}: SelectionBarProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Every chat pinned means the useful offer is Unpin; a mixed selection is
  // treated as "not yet pinned", because Pin is the action that adds.
  const allPinned = selected.length > 0 && selected.every((c) => c.pinned);
  const allArchived = selected.length > 0 && selected.every((c) => c.archived);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    // Deferred, so the click that opened it does not immediately close it.
    const timer = window.setTimeout(() => document.addEventListener('click', dismiss));
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('click', dismiss);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div
      role="toolbar"
      aria-label={`${selected.length} selected`}
      className="animate-panel-in flex items-center gap-1"
    >
      <IconButton label="Cancel selection" variant="ghost" onClick={onCancel}>
        <CloseIcon size={21} />
      </IconButton>

      <span
        className="min-w-0 flex-1 text-h2 text-ink tabular-nums"
        // Announced as it changes, so a screen-reader user hears the count
        // without having to go looking for it after every tap.
        aria-live="polite"
      >
        {selected.length}
      </span>

      <IconButton
        label={allPinned ? 'Unpin' : 'Pin'}
        variant="ghost"
        onClick={() => onPin(!allPinned)}
      >
        <PinIcon size={20} className={cn(allPinned && 'text-brand')} />
      </IconButton>

      <IconButton
        label={allArchived ? 'Unarchive' : 'Archive'}
        variant="ghost"
        onClick={() => onArchive(!allArchived)}
      >
        {allArchived ? <UnarchiveIcon size={20} /> : <ArchiveIcon size={20} />}
      </IconButton>

      <IconButton label="Delete" variant="ghost" onClick={onDelete}>
        <TrashIcon size={20} className="text-danger" />
      </IconButton>

      <div className="relative" ref={menuRef}>
        <IconButton
          label="More actions"
          variant="ghost"
          onClick={() => setOpen((was) => !was)}
        >
          <MoreIcon size={21} />
        </IconButton>

        {open && (
          <div
            role="menu"
            aria-label="More actions"
            onClick={() => setOpen(false)}
            className={cn(
              'animate-panel-in absolute top-full right-0 z-200 mt-1 w-56 origin-top-right',
              'max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-lg',
            )}
          >
            {menu}
          </div>
        )}
      </div>
    </div>
  );
}

/** One row of the overflow menu. Kept here so every caller gets the same shape. */
export function SelectionMenuItem({
  label,
  danger = false,
  onSelect,
}: {
  label: string;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={cn(
        'focus-ring flex w-full items-center px-3 py-2.5 text-left text-body',
        'transition-colors duration-instant hover:bg-hover active:bg-pressed',
        danger ? 'text-danger' : 'text-ink',
      )}
    >
      {label}
    </button>
  );
}
