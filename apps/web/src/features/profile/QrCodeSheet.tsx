import { Avatar, CheckIcon, LinkIcon, ShareIcon, StorageIcon, cn } from '@pingo/ui';
import { useRef, useState } from 'react';

import { Sheet } from '../../components/Sheet.js';
import { QrArt } from './QrArt.js';
import { profileLink } from './ShareProfileSheet.js';

/**
 * The profile QR, as something you would want to hold up.
 *
 * ## The card adapts to the theme; the code does not
 *
 * The whole surface is themed except the square in the middle of it, which
 * stays white in dark mode. That looks like an oversight and is the opposite:
 * scanners threshold a camera frame into light and dark and assume the *light*
 * modules are genuinely light. A dark-mode QR reverses that relationship, and
 * while good readers cope, plenty of cheap ones and several in-app scanners do
 * not. The card carries the theme so the code does not have to.
 *
 * ## The glow is on the card, never on the code
 *
 * A soft gradient bloom sits behind the card. It is deliberately outside the
 * white plate and deliberately still: anything animating over or around a QR
 * gives a rolling-shutter camera a moving target, and a code that has to be
 * held steady for a second longer is a worse code however good it looks.
 * The entrance — fade and scale, once — is over before anyone points a camera.
 *
 * ## Three actions, because they are three situations
 *
 * Share is for the device's own sheet. Save writes a PNG, which is what someone
 * putting this in a bio or a poster actually needs. Copy link is for pasting
 * into something PINGO knows nothing about.
 */
export function QrCodeSheet({
  username,
  displayName,
  avatarUrl,
  userId,
  onClose,
}: {
  username: string;
  displayName: string;
  avatarUrl?: string;
  userId: string;
  onClose: () => void;
}) {
  const link = profileLink(username);
  const cardRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Could not copy the link.');
    }
  };

  const share = async () => {
    if (!navigator.share) {
      await copy();
      return;
    }
    try {
      await navigator.share({ title: displayName, text: `${displayName} on PINGO`, url: link });
    } catch {
      // Dismissing the share sheet rejects. Not an error worth reporting.
    }
  };

  /**
   * Saves the card as a PNG.
   *
   * The SVG is serialised and drawn to a canvas rather than screenshotting the
   * DOM, which keeps it dependency-free and gives a crisp result at any size —
   * vectors rasterise at whatever scale we ask for, so this exports at 3× and
   * stays sharp when somebody prints it.
   */
  const save = async () => {
    const svg = cardRef.current?.querySelector('svg');
    if (!svg) return;

    try {
      const source = new XMLSerializer().serializeToString(svg);
      const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));

      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('render failed'));
        image.src = url;
      });

      const scale = 3;
      const canvas = document.createElement('canvas');
      canvas.width = 320 * scale;
      canvas.height = 320 * scale;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('no 2d context');

      // White under everything: a PNG with a transparent background saved to a
      // camera roll shows on whatever the viewer's app uses, which for a QR can
      // be black — and that is the one thing that must never happen to it.
      context.fillStyle = '#FFFFFF';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png'),
      );
      if (!blob) throw new Error('encode failed');

      const download = document.createElement('a');
      download.href = URL.createObjectURL(blob);
      download.download = `pingo-${username}.png`;
      download.click();
      URL.revokeObjectURL(download.href);

      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch {
      setError('Could not save the image.');
    }
  };

  return (
    <Sheet title="Your QR code" hideTitle onClose={onClose}>
      <div className="flex flex-col items-center pb-1">
        {/*
          Fade and scale, once, on entry. `animate-fade-in` alone would leave
          the card feeling like it was already there; the small rise is what
          makes it feel handed over.
        */}
        <div
          ref={cardRef}
          className={cn(
            'relative isolate w-full max-w-[19rem]',
            'motion-safe:animate-qr-in',
          )}
        >
          {/*
            The glow. Behind the card, blurred, and static — see the note at the
            top. `-z-10` keeps it strictly under the white plate so it can never
            tint the code itself.
          */}
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute -inset-6 -z-10 rounded-[2.5rem] blur-2xl',
              'bg-[radial-gradient(60%_60%_at_50%_40%,rgba(124,58,237,0.42),rgba(37,99,235,0.28)_55%,transparent_75%)]',
            )}
          />

          <div
            className={cn(
              'flex flex-col items-center gap-4 rounded-[1.75rem] p-6',
              'bg-surface shadow-lg ring-1 ring-line',
            )}
          >
            <div className="flex flex-col items-center gap-2">
              <Avatar name={displayName} id={userId} src={avatarUrl} size="xl" />
              <div className="text-center">
                <p className="text-h2 leading-tight text-ink">{displayName}</p>
                <p className="text-caption text-text-tertiary">@{username}</p>
              </div>
            </div>

            {/*
              The white plate. Explicitly `#FFFFFF` rather than a surface token,
              because the token follows the theme and this must not.
            */}
            <div className="rounded-2xl bg-white p-3 shadow-sm">
              <QrArt
                value={link}
                size={216}
                level="H"
                logo
                title={`QR code for ${displayName} on PINGO`}
              />
            </div>

            <p className="text-caption text-text-secondary">Scan to connect on PINGO</p>
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-caption text-danger">
            {error}
          </p>
        )}

        <div className="mt-5 flex w-full max-w-[19rem] items-center gap-2">
          <Action label="Share" onClick={() => void share()}>
            <ShareIcon size={18} />
          </Action>
          <Action label={saved ? 'Saved' : 'Save'} onClick={() => void save()}>
            {saved ? <CheckIcon size={18} /> : <StorageIcon size={18} />}
          </Action>
          <Action label={copied ? 'Copied' : 'Copy link'} onClick={() => void copy()}>
            {copied ? <CheckIcon size={18} /> : <LinkIcon size={18} />}
          </Action>
        </div>
      </div>
    </Sheet>
  );
}

function Action({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-1 flex-col items-center gap-1.5 rounded-xl px-2 py-3',
        'bg-surface-sunken text-caption text-text-secondary',
        'transition-transform duration-quick ease-standard',
        'hover:bg-surface-hover active:scale-[0.97]',
        'focus-ring',
      )}
    >
      <span className="text-brand">{children}</span>
      {label}
    </button>
  );
}
