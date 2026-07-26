import { cn } from '@pingo/ui';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * The chrome every step of the auth flow shares.
 *
 * It exists so the rules in
 * [docs/01 § 2.1](../../../../../docs/01-onboarding-auth.md#21-global-rules-for-the-whole-flow)
 * are structural rather than remembered: a progress bar with **no step numbers**,
 * a Back control that always works, one `h1`, one field group, one primary
 * action — and the primary action pinned to the bottom, above where a phone
 * keyboard appears.
 *
 * Screens supply content and a footer. They do not lay out the page, which is
 * what stops the seven steps from drifting apart in padding and rhythm.
 */

export interface AuthScreenProps {
  /**
   * 0–1. Rendered as a bar, never as "3 of 7" — § 2.1 is explicit that step
   * numbers make a short flow feel long.
   *
   * Omit on screens outside the linear flow (Welcome, Log In triage), which have
   * no progress to report.
   */
  progress?: number;
  title: string;
  /** The line under the title. One sentence, sentence case. */
  subtitle?: ReactNode;
  children: ReactNode;
  /** The primary action, and anything that belongs beneath it. */
  footer?: ReactNode;
  /**
   * Inline message above the footer — an offline notice or a failed attempt.
   * Never a dialog: § 19 forbids blocking the flow over a recoverable problem.
   */
  message?: ReactNode;
  /** Defaults to browser history. Pass a function where Back must undo flow state. */
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
  onBack,
  showBack = true,
}: AuthScreenProps) {
  const navigate = useNavigate();
  const goBack = onBack ?? (() => navigate(-1));

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-brand-wash">
      {/*
        2px, brand gradient, top edge. The track is always present so the bar
        grows within a fixed line rather than appearing from nothing.
      */}
      {progress !== undefined && (
        <div
          className="sticky top-0 z-10 h-0.5 w-full shrink-0 bg-line"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-label="Sign-up progress"
        >
          <div
            className="h-full bg-brand-gradient transition-[width] duration-quick ease-standard"
            style={{ width: `${Math.min(Math.max(progress, 0), 1) * 100}%` }}
          />
        </div>
      )}

      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col px-6 pb-8 pt-3">
        {showBack ? (
          <button
            type="button"
            onClick={goBack}
            className={cn(
              '-ml-2 mb-6 inline-flex h-10 w-fit items-center gap-1 rounded-md px-2',
              'focus-ring text-caption text-text-secondary',
              'transition-colors duration-instant ease-standard',
              'hover:bg-hover hover:text-ink',
            )}
          >
            <ChevronLeft />
            Back
          </button>
        ) : (
          <div className="mb-6 h-10" aria-hidden />
        )}

        <h1 className="text-h1 text-ink animate-rise">{title}</h1>

        {subtitle && (
          <p className="mt-3 text-body text-text-secondary animate-rise">{subtitle}</p>
        )}

        <div className="mt-8">{children}</div>

        {/*
          Pushes the footer to the bottom edge. The wireframes all show generous
          space between the last field and the primary action, and this is what
          produces it at any viewport height.
        */}
        <div className="flex-1" aria-hidden />

        {message && <div className="mb-4">{message}</div>}
        {footer}
      </div>
    </div>
  );
}

/**
 * Drawn here rather than imported.
 *
 * `ChevronLeftIcon` is a 24×24 control glyph; this sits inline beside 12px text
 * and needs to be smaller than the icon set's smallest sensible size.
 */
function ChevronLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
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

/**
 * The inline caption beneath a failed or blocked step.
 *
 * `role="alert"` so a screen reader announces it without moving focus — the
 * field keeps focus so the user can simply correct and retry.
 */
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
        'text-caption',
        tone === 'danger' ? 'text-danger' : 'text-text-secondary',
      )}
    >
      {children}
    </p>
  );
}
