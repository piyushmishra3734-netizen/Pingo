import { CameraIcon, ImageIcon, PlusIcon, cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

/**
 * The `+` beside the composer, and what it opens.
 *
 * The icon turns anticlockwise as the sheet rises, so the `+` becomes an `×`:
 * one control, two states, and the way out is the button you came in by.
 * Rotating rather than swapping the glyph is what makes it read as the same
 * object changing rather than two buttons taking turns.
 *
 * ## Only what actually works
 *
 * Gallery and Camera are here because both do their job. Location, Contact,
 * Document and Event are not, because nothing behind them exists — and a sheet
 * of six choices where four do nothing is worse than a sheet of two that do.
 * They belong here when they work, and the shape is ready for them.
 */

export interface AttachMenuProps {
  onGallery: () => void;
  onCamera: () => void;
}

export function AttachMenu({ onGallery, onCamera }: AttachMenuProps) {
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

  const items = [
    { label: 'Gallery', icon: <ImageIcon size={19} />, onSelect: onGallery },
    { label: 'Camera', icon: <CameraIcon size={19} />, onSelect: onCamera },
  ];

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        aria-label={open ? 'Close attachments' : 'Attach'}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className={cn(
          'focus-ring touch-target mb-0.5 grid size-9 place-items-center rounded-full',
          'text-text-secondary transition-[transform,color] duration-quick ease-standard',
          'hover:text-ink',
          // 135° anticlockwise turns the plus into a cross.
          open && '-rotate-[135deg] text-brand',
        )}
      >
        <PlusIcon size={20} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Attach"
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
