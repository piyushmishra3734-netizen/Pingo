import { cn } from '@pingo/ui';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { FunnelBackdrop } from './FunnelBackdrop.js';

/**
 * The chrome every sign-up and sign-in screen sits in.
 *
 * ## It used to have its own design system
 *
 * Every size, weight, radius, shadow and curve in here was an arbitrary value:
 * `text-[1.75rem]`, `text-[0.9375rem]`, `tracking-[-0.03em]`, `rounded-[10px]`,
 * `shadow-[0_4px_20px_rgba(0,0,0,0.04)]`, and `cubic-bezier(0.23,1,0.32,1)`
 * written out seven times - which is not even the app's curve, that being
 * `--ease-standard`, `cubic-bezier(0.32,0.72,0,1)`.
 *
 * So the funnel could not match the app it opens, because it was not drawing
 * from the same scale. Not a matter of taste: a screen built from numbers
 * somebody picked once cannot agree with a screen built from a system, and the
 * disagreement is what reads as unfinished. Everything here now comes from
 * `packages/tokens`, and where a value is missing the scale is what changes.
 *
 * That also fixes a real bug rather than only a look. The panel shadow was a
 * raw `rgba(0,0,0,0.04)`, which does not invert - the same mistake
 * `FunnelBackdrop` records fixing for its mesh, left behind on the panel.
 *
 * ## The card is gone
 *
 * The form was wrapped in `rounded-2xl border bg-surface p-4 shadow`. A border
 * says "separate object", and a form is not a separate object from the screen
 * that exists to hold it - it insets every field from the margin the rest of
 * the app uses and turns a full screen into a widget on a wallpaper. Fields now
 * sit on the page ground, full width, at the page's own margin.
 *
 * ## Progress stays a fraction, and stops looking like a page load
 *
 * The first draft of this rewrite replaced the bar with "Step 2 of 3".
 * `progress.ts` rules that out, citing the product blueprint § 2.1: a count
 * makes a short flow feel long. That is a decision already taken, so the
 * fraction stays.
 *
 * What was actually wrong is where it was drawn. A 2px full-bleed hairline
 * pinned to the very top edge is the shape a browser uses to say a page is
 * loading, which is why it read as one. It is now a short rounded track in the
 * header row, beside the back control, at a size that reads as an indicator
 * rather than as an edge of the window.
 */

export interface AuthScreenProps {
  /** How far through the flow, 0 to 1. Omit where there is no flow. */
  progress?: number;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  message?: ReactNode;
  alert?: ReactNode;
  onBack?: () => void;
  showBack?: boolean;
}

export function AuthScreen({
  progress,
  title,
  subtitle,
  children,
  footer,
  message,
  alert,
  onBack,
  showBack = true,
}: AuthScreenProps) {
  const navigate = useNavigate();
  const goBack = onBack ?? (() => navigate(-1));

  return (
    <FunnelBackdrop>
      {alert}

      <div
        className={cn(
          'mx-auto flex w-full max-w-sm flex-1 flex-col overflow-y-auto',
          'px-5 pt-[max(0.75rem,env(safe-area-inset-top))]',
          'pb-[max(1.5rem,env(safe-area-inset-bottom))]',
        )}
      >
        <div className="mb-7 flex h-11 shrink-0 items-center justify-between gap-3">
          {showBack ? (
            <button
              type="button"
              onClick={goBack}
              aria-label="Back"
              className={cn(
                'focus-ring -ml-2 grid size-11 shrink-0 place-items-center rounded-full',
                'text-text-secondary transition-colors duration-instant ease-standard',
                'hover:bg-hover hover:text-ink active:bg-pressed',
              )}
            >
              <ChevronLeft />
            </button>
          ) : (
            <span aria-hidden />
          )}

          {progress !== undefined && (
            <div
              className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-line"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
              aria-label="Progress"
            >
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-base ease-standard"
                style={{ width: `${Math.min(Math.max(progress, 0), 1) * 100}%` }}
              />
            </div>
          )}
        </div>

        <header className="funnel-enter">
          <h1 className="text-h1 text-ink">{title}</h1>
          {subtitle && <p className="mt-2 text-body text-text-secondary">{subtitle}</p>}
        </header>

        <div className="funnel-enter mt-8" style={{ animationDelay: '40ms' }}>
          {children}
        </div>

        <div className="flex-1" aria-hidden />

        {message && (
          <div className="funnel-enter mt-6" style={{ animationDelay: '50ms' }}>
            {message}
          </div>
        )}

        {footer && (
          <div className="funnel-enter mt-6" style={{ animationDelay: '55ms' }}>
            {/*
              Primary Buttons use bg-brand-gradient - the accent chosen in
              Appearance retints them. Never hardcode a colour here, or a purple
              user gets a black button.
            */}
            {footer}
          </div>
        )}
      </div>
    </FunnelBackdrop>
  );
}

function ChevronLeft() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="m14.5 6-6 6 6 6"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AuthMessage({
  children,
  tone = 'danger',
}: {
  children: ReactNode;
  tone?: 'danger' | 'muted';
}) {
  return (
    <p
      role="alert"
      className={cn(
        'rounded-md px-3 py-2.5 text-body leading-snug',
        tone === 'danger'
          ? 'bg-danger-soft text-danger'
          : 'bg-surface text-text-secondary shadow-sm ring-1 ring-line',
      )}
    >
      {children}
    </p>
  );
}
