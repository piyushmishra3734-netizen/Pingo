import { cn } from '@pingo/ui';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useBackStep } from '../../navigation/useBackStep.js';

/**
 * The pieces PINGO AI's menu and settings are built from: a panel that slides
 * in (from the left for the menu, full screen for a page), a page header, and
 * grouped rows with an icon, a title, a line under it and a chevron or a
 * switch. Flat, solid, Figtree, like the room itself.
 */

export function AiPanel({
  side = 'full',
  onClose,
  label,
  children,
}: {
  side?: 'left' | 'full';
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  useBackStep(true, onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="ai-room-ui fixed inset-0 z-[400]" role="dialog" aria-modal="true" aria-label={label}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className={cn('absolute inset-0 bg-black/40 transition-opacity duration-300', shown ? 'opacity-100' : 'opacity-0')}
      />
      <div
        className={cn(
          'absolute flex flex-col overflow-hidden bg-page shadow-2xl transition-transform duration-300 ease-out',
          side === 'left' ? 'inset-y-0 left-0 w-[min(88vw,24rem)] rounded-r-[28px]' : 'inset-0',
          shown ? 'translate-x-0' : side === 'left' ? '-translate-x-full' : 'translate-x-full',
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function PageHeader({ title, onBack, onClose, action }: { title: string; onBack?: () => void; onClose?: () => void; action?: ReactNode }) {
  return (
    <header className="flex items-center gap-2 px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
      {onBack ? (
        <button type="button" aria-label="Back" onClick={onBack} className="grid size-11 place-items-center rounded-full bg-surface text-ink shadow-sm active:scale-95">
          <ChevronLeft size={22} />
        </button>
      ) : onClose ? (
        <button type="button" aria-label="Close" onClick={onClose} className="grid size-11 place-items-center rounded-full text-ink active:scale-95">
          <X size={22} />
        </button>
      ) : null}
      <h1 className="min-w-0 flex-1 truncate text-[22px] font-bold tracking-[-0.01em] text-ink">{title}</h1>
      {action}
    </header>
  );
}

export function Group({ title, footer, children }: { title?: string; footer?: string | undefined; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      {title && <h2 className="px-1 text-[15px] font-semibold text-ink">{title}</h2>}
      <div className="overflow-hidden rounded-[20px] bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04)] ring-1 ring-line">{children}</div>
      {footer && <p className="px-1 text-[13px] leading-snug text-text-tertiary">{footer}</p>}
    </section>
  );
}

export function Row({
  icon,
  title,
  sub,
  onClick,
  href,
  end,
  danger,
  divider = true,
}: {
  icon?: ReactNode;
  title: string;
  sub?: ReactNode;
  onClick?: () => void;
  href?: string;
  end?: ReactNode;
  danger?: boolean;
  divider?: boolean;
}) {
  const body = (
    <>
      {icon && <span className={cn('grid w-7 shrink-0 place-items-center', danger ? 'text-danger' : 'text-ink')}>{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className={cn('block text-[16px] font-medium leading-tight', danger ? 'text-danger' : 'text-ink')}>{title}</span>
        {sub && <span className="mt-0.5 block text-[13.5px] leading-snug text-text-secondary">{sub}</span>}
      </span>
      {end ?? (onClick || href ? <ChevronRight size={19} className="shrink-0 text-text-tertiary" aria-hidden /> : null)}
    </>
  );
  const cls = cn('flex min-h-[60px] w-full items-center gap-3.5 px-4 py-2.5 text-left', divider && '[&+*]:border-t [&+*]:border-line', (onClick || href) && 'active:bg-hover');
  if (href) {
    return (
      <a href={href} className={cls}>
        {body}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls}>
        {body}
      </button>
    );
  }
  return <div className={cls}>{body}</div>;
}

/** A list of choices with a tick on the chosen one. */
export function Choices<T extends string>({
  options,
  value,
  onPick,
}: {
  options: readonly { id: T; label: string; hint?: string }[];
  value: T;
  onPick: (id: T) => void;
}) {
  return (
    <div className="overflow-hidden rounded-[20px] bg-surface ring-1 ring-line" role="radiogroup">
      {options.map((o, i) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          onClick={() => onPick(o.id)}
          className={cn('flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left active:bg-hover', i > 0 && 'border-t border-line')}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-medium text-ink">{o.label}</span>
            {o.hint && <span className="block text-[13.5px] leading-snug text-text-secondary">{o.hint}</span>}
          </span>
          <span
            aria-hidden
            className={cn('grid size-6 place-items-center rounded-full border-2', o.id === value ? 'border-brand bg-brand' : 'border-line-strong')}
          >
            {o.id === value && <span className="size-2 rounded-full bg-on-brand" />}
          </span>
        </button>
      ))}
    </div>
  );
}
