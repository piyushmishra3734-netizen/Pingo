import { cn } from '@pingo/ui';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { FunnelBackdrop } from './FunnelBackdrop.js';

/**
 * Auth/setup chrome — productive: solid panels, fast enter, black CTAs.
 */

export interface AuthScreenProps {
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

      {progress !== undefined && (
        <div
          className="h-0.5 w-full shrink-0 bg-black/[0.06]"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-label="Progress"
        >
          <div
            className="h-full bg-brand transition-[width] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
            style={{ width: `${Math.min(Math.max(progress, 0), 1) * 100}%` }}
          />
        </div>
      )}

      <div
        className={cn(
          'mx-auto flex w-full max-w-[22rem] flex-1 flex-col overflow-y-auto',
          'px-6 pb-[max(1.75rem,env(safe-area-inset-bottom))]',
          progress !== undefined
            ? 'pt-5'
            : 'pt-[max(1.25rem,env(safe-area-inset-top))]',
        )}
      >
        {showBack ? (
          <button
            type="button"
            onClick={goBack}
            className={cn(
              'group -ml-2 mb-6 inline-flex h-9 w-fit items-center gap-1 rounded-lg px-2',
              'funnel-enter text-[0.8125rem] font-medium text-[#6B6B6F]',
              'transition-[color,transform,background-color] duration-100',
              'ease-[cubic-bezier(0.23,1,0.32,1)]',
              'hover:bg-hover hover:text-ink',
              'active:scale-[0.97]',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-focus-ring)]',
            )}
          >
            <span className="transition-transform duration-100 group-hover:-translate-x-0.5">
              <ChevronLeft />
            </span>
            Back
          </button>
        ) : (
          <div className="mb-6 h-9" aria-hidden />
        )}

        <header className="funnel-enter" style={{ animationDelay: '20ms' }}>
          <h1 className="text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.03em] text-ink">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2 text-[0.9375rem] leading-relaxed tracking-[-0.01em] text-[#6B6B6F]">
              {subtitle}
            </p>
          )}
        </header>

        {/* Solid white panel — no backdrop-blur (blur was laggy) */}
        <div
          className={cn(
            'funnel-enter mt-6 rounded-2xl border border-black/[0.06] bg-white p-4',
            'shadow-[0_4px_20px_rgba(0,0,0,0.04)] sm:p-5',
          )}
          style={{ animationDelay: '40ms' }}
        >
          {children}
        </div>

        <div className="flex-1" aria-hidden />

        {message && (
          <div className="funnel-enter mb-3 mt-4" style={{ animationDelay: '50ms' }}>
            {message}
          </div>
        )}

        {footer && (
          <div className="funnel-enter mt-4" style={{ animationDelay: '55ms' }}>
            {/*
              Primary Buttons use bg-brand-gradient — accent from Appearance
              retints them. Do not hardcode black here or purple users conflict.
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
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
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
        'rounded-lg px-3 py-2.5 text-[0.8125rem] leading-snug',
        tone === 'danger'
          ? 'bg-[#FEF2F2] text-[#B42318]'
          : 'bg-white text-[#6B6B6F] shadow-sm ring-1 ring-black/[0.04]',
      )}
    >
      {children}
    </p>
  );
}
