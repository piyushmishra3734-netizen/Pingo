import { useChat, type Message, type PingRef } from '@pingo/core';
import { CameraIcon, StorageIcon, cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

import { useT } from '../i18n/useT.js';

/**
 * A Ping in the thread: closed, open, or gone.
 *
 * Visually a sealed card - not a photo bubble - so the limited-view promise
 * is obvious before anyone taps. Open state reveals the image with soft
 * radius and a frosted action row; gone state is a quiet capsule, not a hole.
 */
export function PingBubble({
  message,
  ping,
  mine,
}: {
  message: Message;
  ping: PingRef;
  mine: boolean;
}) {
  const t = useT();
  const { service } = useChat();

  const [url, setUrl] = useState<string>();
  const [viewsLeft, setViewsLeft] = useState<number>();
  const [state, setState] = useState<'closed' | 'opening' | 'open' | 'gone'>(
    ping.gone ? 'gone' : 'closed',
  );
  const [saving, setSaving] = useState(false);
  /** Whether the opened Ping has decoded, for the blur-up. */
  const [pingReady, setPingReady] = useState(false);
  const objectUrl = useRef<string | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  const open = async () => {
    if (state !== 'closed') return;
    setState('opening');

    const view = await service.openPing(message.id).catch(() => undefined);
    if (!view) {
      setState('gone');
      return;
    }

    setUrl(view.url);
    setViewsLeft(view.viewsLeft);
    setState('open');
  };

  const save = async () => {
    setSaving(true);
    try {
      const blob = await service.savePing(message.id);
      if (!blob) {
        setState('gone');
        return;
      }

      const href = URL.createObjectURL(blob);
      objectUrl.current = href;
      const link = document.createElement('a');
      link.href = href;
      link.download = `pingo-ping-${message.id}.jpg`;
      link.click();

      // Gone from the app the moment it is on the device.
      setUrl(undefined);
      setState('gone');
    } finally {
      setSaving(false);
    }
  };

  const viewsLabel = ping.views === 1 ? '1 view' : '2 views';

  // ---- gone ---------------------------------------------------------------

  if (state === 'gone') {
    return (
      <div
        className={cn(
          'flex w-[13.5rem] items-center gap-2.5 rounded-[1.125rem] px-3.5 py-3',
          /*
            Recessed, not dashed. A spent ping is "this is not here any more",
            and a dashed outline says that in wireframe grammar - the same
            grammar that made the achievement grid read as a mock-up. A fill
            one step below the page says it as a material: the bubble is still a
            bubble, it has just sunk into the background.
          */
          'bg-hover',
          'text-text-tertiary animate-fade-in',
        )}
      >
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-full bg-sunken"
        >
          <CameraIcon size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-caption font-medium text-text-secondary">
            {mine ? 'Ping delivered' : 'Ping opened'}
          </span>
          <span className="block text-[0.6875rem] text-text-tertiary">Gone from chat</span>
        </span>
      </div>
    );
  }

  // ---- open ---------------------------------------------------------------

  if (state === 'open' && url) {
    return (
      <div className="animate-fade-in w-fit max-w-[min(70vw,18rem)]">
        <div
          className={cn(
            'overflow-hidden rounded-[1.125rem]',
            'bg-sunken shadow-[0_8px_28px_rgb(0_0_0/0.12)]',
            'ring-1 ring-black/5',
          )}
        >
          <img
            src={url}
            alt="Ping"
            draggable={false}
            onLoad={() => setPingReady(true)}
            className={cn(
              'max-h-80 w-full object-cover select-none',
              'transition-[filter,opacity] duration-200 ease-standard',
              pingReady ? 'opacity-100' : 'opacity-80 blur-[2px]',
            )}
          />
        </div>
        <div className="mt-2 flex items-center gap-2.5 px-0.5">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className={cn(
              'focus-ring flex items-center gap-1.5 rounded-full',
              'glass-water px-3.5 py-1.5 text-caption font-medium text-ink',
              'shadow-[0_1px_3px_rgb(0_0_0/0.06)]',
              'transition-transform duration-[160ms] ease-standard',
              'active:scale-[0.97]',
              'disabled:opacity-50',
            )}
          >
            <StorageIcon size={14} />
            {saving ? 'Saving…' : 'Save'}
          </button>

          <span
            className={cn(
              'text-[0.6875rem] tabular-nums',
              viewsLeft === 0 ? 'text-danger' : 'text-text-tertiary',
            )}
            aria-live="polite"
          >
            {viewsLeft === 0
              ? 'Expired'
              : `${viewsLeft} view${viewsLeft === 1 ? '' : 's'} left`}
          </span>
        </div>
      </div>
    );
  }

  // ---- closed (mine) ------------------------------------------------------

  if (mine) {
    return (
      <div
        className={cn(
          'relative flex w-[13.5rem] items-center gap-3 overflow-hidden',
          'rounded-[1.125rem] px-3.5 py-3',
          'bg-brand-glass text-on-brand',
          'shadow-[0_4px_14px_color-mix(in_srgb,var(--gradient-from,#111113)_28%,transparent)]',
        )}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              'radial-gradient(120% 90% at 0% 0%, rgb(255 255 255 / 0.22) 0%, transparent 55%)',
          }}
        />
        <span
          aria-hidden
          className="relative grid size-9 shrink-0 place-items-center rounded-full bg-white/18 ring-1 ring-white/25"
        >
          <CameraIcon size={16} />
        </span>
        <span className="relative min-w-0 flex-1">
          <span className="block text-caption font-semibold tracking-[-0.01em]">
            {t('thread.pingSent')}
          </span>
          <span className="mt-0.5 block text-[0.6875rem] text-white/70">{viewsLabel}</span>
        </span>
      </div>
    );
  }

  // ---- closed (theirs) ----------------------------------------------------

  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={state === 'opening'}
      aria-label={`New Ping, ${
        ping.views === 1 ? 'one view' : 'two views'
      }. Opening it spends a view.`}
      className={cn(
        'focus-ring relative flex w-[13.5rem] items-center gap-3 overflow-hidden',
        'rounded-[1.125rem] px-3.5 py-3 text-left',
        'bg-brand-glass text-on-brand',
        'shadow-[0_4px_14px_color-mix(in_srgb,var(--gradient-from,#111113)_28%,transparent)]',
        'transition-transform duration-[160ms] ease-standard',
        'active:scale-[0.97]',
        'disabled:opacity-80',
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            'radial-gradient(120% 90% at 0% 0%, rgb(255 255 255 / 0.22) 0%, transparent 55%)',
        }}
      />
      <span
        aria-hidden
        className={cn(
          'relative grid size-9 shrink-0 place-items-center rounded-full',
          'bg-white/18 ring-1 ring-white/25',
          state === 'opening' && 'animate-pulse',
        )}
      >
        <CameraIcon size={16} />
      </span>

      <span className="relative min-w-0 flex-1">
        <span className="block text-caption font-semibold tracking-[-0.01em]">
          {state === 'opening' ? 'Opening…' : 'New Ping'}
        </span>
        {state !== 'opening' && (
          <span className="mt-0.5 block text-[0.6875rem] text-white/75">
            Tap to open · {viewsLabel}
          </span>
        )}
      </span>
    </button>
  );
}
