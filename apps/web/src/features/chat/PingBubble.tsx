import { useChat, type Message, type PingRef } from '@pingo/core';
import { CameraIcon, StorageIcon, cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

import { useT } from '../i18n/useT.js';

/**
 * A Ping in the thread: closed, open, or gone.
 *
 * ## Why the image is never in the message
 *
 * A Ping can be opened once or twice, whichever the sender chose. If the URL
 * arrived with the message, the viewer would hold a copy that outlives every
 * view and the limit would be theatre. So the bubble starts closed and asks the
 * server for the image - and asking is what spends the view. The count is
 * server-side; nothing here can be edited to get another look.
 *
 * ## Why it does not look like a photo
 *
 * A Ping is a different promise to a picture in a chat, and looking like one
 * would be a lie told by the layout. It is a card that has to be *decided*
 * about, and it says how many views it costs before you spend one - a single
 * view is a different thing to accept than two, and finding that out afterwards
 * is too late.
 *
 * ## What happens on reload
 *
 * The open image is deliberately not persisted anywhere. Navigate away and the
 * Ping is closed again - with whatever views the server says are left. If they
 * are gone, opening it returns nothing and the bubble says so.
 *
 * ## Saving
 *
 * Saving goes to the device, never to a PINGO server, and it is a decision
 * rather than a side effect of looking - so it is its own button. Once the file
 * is on the device the server copy is destroyed: the receiver keeps it, the app
 * does not. That is why a saved Ping does not reappear in the thread or in any
 * gallery. There is nothing left to show.
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

      // Gone from the app the moment it is on the device. Keeping it visible
      // would contradict the promise the feature makes.
      setUrl(undefined);
      setState('gone');
    } finally {
      setSaving(false);
    }
  };

  // ---- gone ---------------------------------------------------------------

  if (state === 'gone') {
    return (
      <div
        className={cn(
          'flex w-56 items-center gap-2.5 rounded-lg px-4 py-3',
          'border border-dashed border-line-strong text-text-tertiary',
          // Fades rather than snapping, so a Ping ending reads as an event and
          // not as the bubble having been swapped out behind your back.
          'animate-fade-in',
        )}
      >
        <CameraIcon size={18} />
        <span className="text-caption">
          {/*
            The sender is told it arrived; the receiver is told it is spent.
            Neither learns anything about the other - "opened at 4:12" would be
            a fact about a person, and this is not a read receipt.
          */}
          {mine ? 'Ping delivered' : 'Ping opened'}
        </span>
      </div>
    );
  }

  // ---- open ---------------------------------------------------------------

  if (state === 'open' && url) {
    return (
      <div className="animate-fade-in w-fit">
        <img
          src={url}
          alt="Ping"
          draggable={false}
          className="max-h-80 w-auto max-w-[70vw] rounded-lg object-contain select-none"
        />
        <div className="mt-1.5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className={cn(
              'focus-ring flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5',
              'text-caption font-medium text-ink shadow-sm',
              'transition-transform duration-instant active:scale-95',
              'disabled:opacity-50',
            )}
          >
            <StorageIcon size={14} />
            {saving ? 'Saving…' : 'Save to gallery'}
          </button>

          <span
            className={cn('text-caption', viewsLeft === 0 ? 'text-danger' : 'text-text-tertiary')}
            aria-live="polite"
          >
            {viewsLeft === 0
              ? 'Expired'
              : `${viewsLeft} view${viewsLeft === 1 ? '' : 's'} remaining`}
          </span>
        </div>
      </div>
    );
  }

  // ---- closed -------------------------------------------------------------

  /*
   * The sender's own Ping is not a thing to open.
   *
   * They took the picture; there is nothing to reveal, and letting them tap it
   * would spend nothing while looking as though it had. So their side is a
   * status card rather than a button.
   */
  if (mine) {
    return (
      <div
        className={cn(
          'flex w-56 items-center gap-2.5 rounded-lg px-4 py-3',
          'bg-brand-glass text-white',
        )}
      >
        <CameraIcon size={18} />
        <span className="min-w-0 flex-1">
          <span className="block text-caption font-medium">{t('thread.pingSent')}</span>
          <span className="block text-caption text-white/70">
            {ping.views === 1 ? '1 view' : '2 views'}
          </span>
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={state === 'opening'}
      aria-label={`New Ping, ${
        ping.views === 1 ? 'one view' : 'two views'
      }. Opening it spends a view.`}
      className={cn(
        'focus-ring flex w-56 items-center gap-2.5 rounded-lg px-4 py-3',
        'bg-brand-glass text-white',
        // Lifts under the finger. The one bubble in a thread that costs
        // something to open should feel like it is waiting to be pressed.
        'transition-transform duration-quick ease-standard',
        'hover:scale-[1.02] active:scale-[0.97]',
        'disabled:opacity-70',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-full bg-white/20',
          state === 'opening' && 'animate-pulse',
        )}
      >
        <CameraIcon size={17} />
      </span>

      <span className="min-w-0 flex-1 text-left">
        <span className="block text-caption font-medium">
          {state === 'opening' ? 'Opening…' : 'New Ping'}
        </span>
        {state !== 'opening' && (
          <span className="block text-caption text-white/75">
            Tap to view · {ping.views === 1 ? '1 view' : '2 views'}
          </span>
        )}
      </span>
    </button>
  );
}
