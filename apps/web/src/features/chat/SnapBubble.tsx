import { useChat, type Message, type SnapRef } from '@pingo/core';
import { CameraIcon, cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

/**
 * A snap in the thread: closed, open, or gone.
 *
 * ## Why the image is never in the message
 *
 * A snap can be opened twice. If the URL arrived with the message, the viewer
 * would hold a copy that outlives both views and the limit would be theatre.
 * So the bubble starts closed and asks the server for the image — and asking is
 * what spends a view. The count is server-side; nothing here can be edited to
 * get a third look.
 *
 * ## What happens on reload
 *
 * The open image is deliberately *not* persisted anywhere. Navigate away, and
 * the snap is closed again — with whatever views the server says are left. If
 * they are gone, opening it returns nothing and the bubble says so.
 *
 * ## Download
 *
 * Downloading is a decision, not a side effect of looking, so it is its own
 * button. Once the file is on the device the server copy is destroyed — the
 * receiver keeps it, the app does not. That is why a downloaded snap does not
 * reappear in the thread or in any gallery: there is nothing left to show.
 */
export function SnapBubble({
  message,
  snap,
  mine,
}: {
  message: Message;
  snap: SnapRef;
  mine: boolean;
}) {
  const { service } = useChat();

  const [url, setUrl] = useState<string>();
  const [viewsLeft, setViewsLeft] = useState<number>();
  const [state, setState] = useState<'closed' | 'opening' | 'open' | 'gone'>(
    snap.gone ? 'gone' : 'closed',
  );
  const [saving, setSaving] = useState(false);
  const objectUrl = useRef<string | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  const open = async () => {
    if (state !== 'closed') return;
    setState('opening');

    const view = await service.openSnap(message.id).catch(() => undefined);
    if (!view) {
      setState('gone');
      return;
    }

    setUrl(view.url);
    setViewsLeft(view.viewsLeft);
    setState('open');
  };

  const download = async () => {
    setSaving(true);
    try {
      const blob = await service.downloadSnap(message.id);
      if (!blob) {
        setState('gone');
        return;
      }

      const href = URL.createObjectURL(blob);
      objectUrl.current = href;
      const link = document.createElement('a');
      link.href = href;
      link.download = `pingo-snap-${message.id}.jpg`;
      link.click();

      // Gone from the app the moment it is on the device. Keeping it visible
      // would contradict the promise the feature makes.
      setUrl(undefined);
      setState('gone');
    } finally {
      setSaving(false);
    }
  };

  if (state === 'gone') {
    return (
      <div
        className={cn(
          'flex w-56 items-center gap-2.5 rounded-lg px-4 py-3',
          'border border-dashed border-line-strong text-text-tertiary',
        )}
      >
        <CameraIcon size={18} />
        <span className="text-caption">
          {mine ? 'Snap delivered' : 'Snap opened — it’s gone'}
        </span>
      </div>
    );
  }

  if (state === 'open' && url) {
    return (
      <div className="w-fit">
        <img
          src={url}
          alt="Snap"
          draggable={false}
          className="max-h-80 w-auto max-w-[70vw] rounded-lg object-contain select-none"
        />
        <div className="mt-1.5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void download()}
            disabled={saving}
            className={cn(
              'focus-ring rounded-full bg-surface px-3 py-1.5 text-caption font-medium text-ink',
              'shadow-sm disabled:opacity-50',
            )}
          >
            {saving ? 'Saving…' : 'Download'}
          </button>
          <span className="text-caption text-text-tertiary">
            {viewsLeft === 0
              ? 'Last look'
              : `${viewsLeft} view${viewsLeft === 1 ? '' : 's'} left`}
          </span>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={state === 'opening'}
      className={cn(
        'focus-ring flex w-56 items-center gap-2.5 rounded-lg px-4 py-3',
        'bg-brand text-white shadow-sm',
        'transition-transform duration-instant active:scale-[0.98]',
        'disabled:opacity-70',
      )}
    >
      <CameraIcon size={18} />
      <span className="text-caption font-medium">
        {state === 'opening' ? 'Opening…' : mine ? 'Snap sent' : 'Tap to view'}
      </span>
    </button>
  );
}
