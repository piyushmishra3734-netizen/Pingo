import { ChevronLeftIcon, cn } from '@pingo/ui';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * The shared header for secondary screens — Profile, Settings, Calls, Communities.
 *
 * Exists so those four screens cannot drift apart in height, padding, glass
 * treatment or back-button placement. The conversation list and chat thread have
 * their own headers because both carry extra rows (search and filters; presence
 * and call actions) that would make this component a grab bag of options.
 *
 * The title is centred when a back button is present and left-aligned otherwise,
 * which is the convention users already carry over from their OS.
 */

export interface ScreenHeaderProps {
  title: string;
  showBack?: boolean;
  /** Right-hand slot: a text button or icon button. */
  action?: ReactNode;
  className?: string;
}

export function ScreenHeader({
  title,
  showBack = false,
  action,
  className,
}: ScreenHeaderProps) {
  const navigate = useNavigate();

  return (
    <header
      className={cn(
        'sticky top-0 z-100 flex items-center gap-2',
        'glass-surface border-x-0 border-t-0 border-b-line',
        'px-3 py-3',
        'pt-[max(0.75rem,env(safe-area-inset-top))]',
        className,
      )}
    >
      {showBack ? (
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className={cn(
            // Drawn at 40px, hit at 44. Back is the most-pressed control on
            // every secondary screen and it sat under the bar on all of them.
            'touch-target grid size-10 shrink-0 place-items-center rounded-full',
            'focus-ring text-text-secondary transition-colors duration-instant',
            'hover:bg-hover hover:text-ink active:scale-[0.96]',
          )}
        >
          <ChevronLeftIcon size={22} />
        </button>
      ) : (
        <span className="w-1" aria-hidden />
      )}

      <h1
        className={cn(
          'min-w-0 flex-1 truncate text-h2 text-ink',
          showBack ? 'text-center' : 'px-2 text-left',
        )}
      >
        {title}
      </h1>

      {/*
        A spacer matching the back button's width keeps a centred title optically
        centred even when there is no action on the right.
      */}
      {action ?? (showBack ? <span className="w-10 shrink-0" aria-hidden /> : <span className="w-1" aria-hidden />)}
    </header>
  );
}
