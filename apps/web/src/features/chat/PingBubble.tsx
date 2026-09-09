import { useChat, type Message, type PingRef } from '@pingo/core';
import { CameraIcon, StorageIcon, cn } from '@pingo/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ImageViewer } from '../profile/ImageViewer.js';
import { useT } from '../i18n/useT.js';
import { secureScreen } from '../native/secure-screen.js';

/**
 * A Ping in the thread: closed, open, or gone.
 *
 * Visually a sealed card - not a photo bubble - so the limited-view promise
 * is obvious before anyone taps. Gone state is a quiet capsule, not a hole.
 *
 * ## Opening grows out of the capsule
 *
 * It used to reveal the image inline, in place of the bubble, with a plain
 * `animate-fade-in`. That was the odd one out: the view-once *photo* - the
 * sibling feature, same promise, same lifecycle - has always opened into
 * `ImageViewer`, which morphs out of the exact rect the person tapped and
 * collapses back into it, re-measuring on close in case the thread scrolled.
 *
 * So this does not build a morph, it stops declining to use the one already
 * shipping. Save and the view counter move into the viewer's footer, which is
 * what that prop is for.
 *
 * The inline reveal also had the bug `PhotoBubble` had already fixed: the
 * picture stayed in the thread after the view was spent, so pressing back
 * brought you straight to a photograph the ledger said was gone. Closing here
 * either returns the sealed capsule - when a view remains - or the spent one.
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
  const objectUrl = useRef<string | undefined>(undefined);

  /*
   * The capsule the viewer grows out of, sealed or spent. One ref for both
   * because they are never on screen together, and the viewer only wants the
   * box the person actually tapped.
   */
  const sourceRef = useRef<HTMLElement | null>(null);
  const sourceRect = useCallback(() => sourceRef.current?.getBoundingClientRect(), []);

  useEffect(() => {
    return () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  /*
   * No screenshots while a Ping is open.
   *
   * A Ping is view-once by definition, so this is the same rule the view-once
   * photo follows and for the same reason - see `secureScreen`. It is on only
   * while one is open, because the flag belongs to the whole window: left on it
   * would take the screenshot of an ordinary conversation away from everybody
   * and send black frames into a shared screen.
   *
   * Saving is untouched. `savePing` is a deliberate button that tells the
   * sender it happened; this is about the copy the platform hands over without
   * telling anybody.
   *
   * Nothing on the web, where no browser offers this at all.
   */
  useEffect(() => {
    if (state !== 'open') return undefined;

    void secureScreen(true);
    return () => {
      void secureScreen(false);
    };
  }, [state]);

  const open = async () => {
    if (state !== 'closed') return;
    setState('opening');

    /*
     * `gone` is terminal - nothing below re-opens from it - so it is only ever
     * reached from an answer that actually means the Ping is spent.
     *
     * A failure throws instead, and puts the bubble back to `closed` so it can
     * be tapped again. Nothing has been lost by trying: the server owns the view
     * count, so a retry that finds it spent gets `undefined` and lands on `gone`
     * for the right reason.
     */
    try {
      const view = await service.openPing(message.id);
      if (!view) {
        setState('gone');
        return;
      }

      setUrl(view.url);
      setViewsLeft(view.viewsLeft);
      setState('open');
    } catch (cause) {
      console.warn('Could not open the Ping.', cause);
      setState('closed');
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      // Same split as `open`: no blob means spent, a throw means it did not
      // arrive - and a download that did not arrive leaves the Ping on screen.
      const blob = await service.savePing(message.id).catch((cause: unknown) => {
        console.warn('Could not save the Ping.', cause);
        return null;
      });
      if (blob === null) return;
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
        ref={(el) => { sourceRef.current = el; }}
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

  /*
   * The viewer, rendered alongside whichever capsule is on screen.
   *
   * It is a portal, so the capsule underneath stays mounted - which is exactly
   * what the morph needs: something to grow out of, and something to come back
   * to when it closes.
   */
  const viewer =
    state === 'open' && url ? (
      <ImageViewer
        originRect={sourceRect}
        src={url}
        alt="Ping"
        onClose={() => {
          /*
           * A spent Ping does not stay on screen. `viewsLeft` is the server's
           * answer from `open_ping`, so zero means this reader has used the
           * last one and the capsule below should say so; anything above zero
           * re-seals, and the next tap spends the next view.
           */
          setUrl(undefined);
          setState(viewsLeft !== undefined && viewsLeft <= 0 ? 'gone' : 'closed');
        }}
        footer={
          <div className="flex flex-col items-center gap-3">
            <span
              className={cn(
                'text-caption tabular-nums',
                viewsLeft === 0 ? 'text-danger' : 'text-white/70',
              )}
              aria-live="polite"
            >
              {viewsLeft === 0
                ? 'Expired'
                : `${viewsLeft} view${viewsLeft === 1 ? '' : 's'} left`}
            </span>

            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className={cn(
                'focus-ring flex items-center gap-1.5 rounded-full',
                'bg-white/12 px-4 py-2 text-caption font-medium text-white',
                'transition-transform duration-[160ms] ease-standard',
                'active:scale-[0.97] disabled:opacity-50',
              )}
            >
              <StorageIcon size={14} />
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        }
      />
    ) : null;

  // ---- closed (mine) ------------------------------------------------------

  if (mine) {
    return (
      <div
        ref={(el) => { sourceRef.current = el; }}
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
    <>
      <button
        ref={(el) => { sourceRef.current = el; }}
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

      {viewer}
    </>
  );
}
