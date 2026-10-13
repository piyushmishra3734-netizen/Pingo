import { cn } from '@pingo/ui';
import { ChevronLeft, ChevronRight, Loader2, Sparkles } from 'lucide-react';
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';

import { PINGO_MASCOT } from '../flow/PingoFlow.js';
import { presetFor } from './ai-profile-model.js';

/**
 * The pieces PINGO AI's profile pages are made of: a top bar (back, title, a
 * pill action), white cards on lavender, rows with an icon and a chevron, and
 * the mascot on its clouds.
 */

/* ---------- wide screens ---------- */

const WIDE = '(min-width: 1024px)';

/** A laptop or desktop window: the profile lays out as two panes. */
export function useIsWide(): boolean {
  return useSyncExternalStore(
    (l) => {
      const m = window.matchMedia(WIDE);
      m.addEventListener('change', l);
      return () => m.removeEventListener('change', l);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

/** Inside the right pane of the two-pane layout: the pane has no Back, the sidebar is the way around. */
export const SplitPane = createContext(false);

export function TopBar({
  title,
  onBack,
  action,
  end,
}: {
  title?: string;
  onBack: () => void;
  action?: { label: string; onClick: () => void; disabled?: boolean; busy?: boolean } | undefined;
  end?: ReactNode;
}) {
  const split = useContext(SplitPane);
  return (
    <header className="pp-pad relative z-[2] flex items-center gap-3 px-4 pb-2 pt-[max(0.85rem,env(safe-area-inset-top))] lg:pb-4 lg:pt-7">
      {!split && (
        <button
          type="button"
          aria-label="Back"
          onClick={onBack}
          className="pp-card grid size-11 shrink-0 place-items-center rounded-full text-[var(--pp-ink)] active:scale-95 lg:hover:bg-[var(--pp-field)]"
        >
          <ChevronLeft size={22} />
        </button>
      )}
      <h1 className="min-w-0 flex-1 truncate text-[21px] font-bold tracking-[-0.01em] lg:text-[26px] lg:tracking-[-0.02em]">{title}</h1>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          disabled={action.disabled || action.busy}
          className={cn(
            'flex h-11 min-w-[5.25rem] items-center justify-center gap-1.5 rounded-full px-5 text-[16px] font-semibold transition-[opacity,filter] active:scale-[0.97] enabled:hover:brightness-110',
            'bg-[var(--pp-accent)] text-[var(--pp-accent-ink)] disabled:opacity-45',
          )}
        >
          {action.busy && <Loader2 size={16} className="animate-spin" aria-hidden />}
          {action.label}
        </button>
      )}
      {end}
    </header>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('pp-card overflow-hidden', className)}>{children}</div>;
}

export function NavRow({
  icon,
  title,
  sub,
  onClick,
  end,
  className,
}: {
  icon: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  onClick?: () => void;
  end?: ReactNode;
  className?: string;
}) {
  const inner = (
    <>
      <span className="grid size-10 shrink-0 place-items-center text-[var(--pp-ink)]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16.5px] font-semibold leading-tight">{title}</span>
        {sub && <span className="mt-0.5 block text-[14px] leading-snug text-[var(--pp-sub)]">{sub}</span>}
      </span>
      {end ?? (onClick ? <ChevronRight size={20} className="shrink-0 text-[var(--pp-sub)]" aria-hidden /> : null)}
    </>
  );
  const cls = cn('flex w-full items-center gap-3 px-4 py-3.5 text-left', className);
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, 'transition-colors active:bg-[var(--pp-field)] lg:hover:bg-[var(--pp-field)]')}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 mt-1 px-1 text-[16px] font-bold">{children}</h2>;
}

/** Soft clouds and a few sparkles behind the mascot. */
export function Sky({ className, sparkles = true }: { className?: string; sparkles?: boolean }) {
  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      <span className="pp-cloud bottom-[8%] left-[-6%] h-[34%] w-[46%] opacity-90" />
      <span className="pp-cloud bottom-[2%] left-[22%] h-[26%] w-[36%] opacity-80" />
      <span className="pp-cloud bottom-[10%] right-[-8%] h-[38%] w-[48%] opacity-90" />
      <span className="pp-cloud bottom-[-4%] right-[24%] h-[24%] w-[34%] opacity-75" />
      {sparkles && (
        <>
          <Sparkles className="pp-twinkle absolute left-[16%] top-[30%] text-[var(--pp-gold)]" size={26} fill="currentColor" strokeWidth={1.2} />
          <Sparkles className="pp-twinkle absolute right-[14%] top-[52%] text-[var(--pp-gold)] [animation-delay:0.9s]" size={30} fill="currentColor" strokeWidth={1.2} />
          <Sparkles className="pp-twinkle absolute left-[22%] top-[12%] text-[#d9a8f0] [animation-delay:1.6s]" size={14} fill="currentColor" strokeWidth={1.2} />
          <Sparkles className="pp-twinkle absolute right-[24%] top-[18%] text-[#d9a8f0] [animation-delay:0.4s]" size={14} fill="currentColor" strokeWidth={1.2} />
        </>
      )}
    </div>
  );
}

/**
 * PINGO AI's face as this person set it. The classic face (or none) is the
 * cut-out mascot, standing free; a preset or a photo sits in a round frame.
 */
export function AiFace({ src, className, framed }: { src: string | null | undefined; className?: string; framed?: boolean }) {
  const preset = presetFor(src);
  const free = !src || preset?.id === 'classic';
  if (free && !framed) {
    return <img src={PINGO_MASCOT} alt="" draggable={false} className={cn('select-none object-contain', className)} />;
  }
  return (
    <span className={cn('block overflow-hidden rounded-full bg-[var(--pp-accent-soft)]', className)}>
      <img src={free ? '/ai/avatars/classic.webp' : src!} alt="" draggable={false} className="size-full select-none object-cover" />
    </span>
  );
}

export function StatusDot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2.5 shrink-0 rounded-full', className)} style={{ background: color }} />;
}

/** A text field with a counter under it, as on the edit page. */
export function Counted({ value, max }: { value: string; max: number }) {
  const n = value.length;
  return <p className={cn('mt-1.5 text-right text-[13px] tabular-nums', n > max ? 'text-danger' : 'text-[var(--pp-faint)]')}>{n}/{max}</p>;
}

export const fieldClass =
  'block w-full rounded-[16px] border border-[var(--pp-line)] bg-[var(--pp-card)] px-4 text-[16.5px] text-[var(--pp-ink)] outline-none transition-colors placeholder:text-[var(--pp-faint)] focus:border-[var(--pp-accent)]';
