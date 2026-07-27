import { CameraIcon, FileIcon, ImageIcon, PlusIcon, UserIcon, cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

/**
 * The `+` beside the composer, and what it opens.
 *
 * The icon turns anticlockwise as the sheet rises, so the `+` becomes an `×`:
 * one control, two states, and the way out is the button you came in by.
 * Rotating rather than swapping the glyph is what makes it read as the same
 * object changing rather than two buttons taking turns.
 *
 * ## Every row does something
 *
 * All six send a real message. Location asks the browser where you are, Contact
 * picks from the people this app knows about, Document uploads a file, Event
 * takes a title and a time — none of them is a stub, and none is a screen,
 * because each is one decision reached from a menu.
 */

export interface AttachMenuProps {
  onGallery: () => void;
  onCamera: () => void;
  onDocument: () => void;
  onLocation: () => void;
  onContact: () => void;
  onEvent: () => void;
}

export function AttachMenu({
  onGallery,
  onCamera,
  onDocument,
  onLocation,
  onContact,
  onEvent,
}: AttachMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const timer = window.setTimeout(() => document.addEventListener('click', dismiss));
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('click', dismiss);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /*
   * Ordered by how often each is reached for, not alphabetically or by type.
   * Gallery and Camera are most of the traffic and sit closest to the thumb.
   */
  const items = [
    { label: 'Gallery', icon: <ImageIcon size={19} />, onSelect: onGallery },
    { label: 'Camera', icon: <CameraIcon size={19} />, onSelect: onCamera },
    { label: 'Document', icon: <FileIcon size={19} />, onSelect: onDocument },
    { label: 'Location', icon: <span className="text-[1.05rem]">📍</span>, onSelect: onLocation },
    { label: 'Contact', icon: <UserIcon size={19} />, onSelect: onContact },
    { label: 'Event', icon: <span className="text-[1.05rem]">📅</span>, onSelect: onEvent },
  ];

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        aria-label={open ? 'Close attachments' : 'Attach'}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className={cn(
          'focus-ring touch-target mb-0.5 grid size-10 place-items-center rounded-full',
          /*
           * `rotate`, not `transform`.
           *
           * Tailwind v4's rotate utilities set the standalone `rotate` property,
           * so a transition list naming `transform` does not cover them — the
           * turn was snapping instantly with no animation at all.
           */
          'text-text-secondary transition-[rotate,color,background-color]',
          'duration-base ease-standard',
          'hover:bg-hover hover:text-ink',
          /*
           * 45°, not 135°.
           *
           * A plus has four-fold symmetry, so both land on the same cross — but
           * 135° travels three times as far to get there, and in the same
           * duration that is three times the angular speed. It read as a spin
           * rather than a turn. The shorter arc over a slightly longer duration
           * is the same gesture, unhurried.
           */
          open && '-rotate-45 text-brand',
        )}
      >
        <PlusIcon size={24} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Attachment options"
          className={cn(
            // Grows upward from the button, which is where it came from.
            'absolute bottom-full left-0 z-200 mb-2 w-44 origin-bottom-left',
            'animate-panel-in overflow-hidden rounded-xl border border-line',
            'bg-surface py-1 shadow-lg',
          )}
        >
          {items.map((item, index) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              // Staggered, so the rows arrive in order rather than as a block.
              style={{ animationDelay: `${index * 40}ms` }}
              className={cn(
                'animate-row-in focus-ring flex w-full items-center gap-3 px-3 py-2.5',
                'text-left text-body text-ink',
                'transition-colors duration-instant hover:bg-hover active:bg-pressed',
              )}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-hover text-text-secondary">
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
