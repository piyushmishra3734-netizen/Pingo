import { Avatar, CheckIcon, LinkIcon, ShareIcon, StorageIcon, cn } from '@pingo/ui';
import { MoreHorizontal } from 'lucide-react';
import { useRef, useState } from 'react';

import { AppLogo } from '../../components/AppLogo.js';
import { Sheet } from '../../components/Sheet.js';
import { profileLink } from './ShareProfileSheet.js';
import { VoxelQr } from './VoxelQr.js';
import './qr-card.css';

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
 * The entrance - fade and scale, once - is over before anyone points a camera.
 *
 * ## The code arrives as a tree
 *
 * The plate holds `VoxelQr`, which opens on a cherry tree standing on the code
 * and takes a second and a half to come apart into it. The motion is over
 * before a camera is up, and it buys the one thing a QR never gets, which is
 * somebody looking at it. Everything after it has settled is the same flat,
 * overhead, full-contrast scan target the plate always held.
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
  const [menu, setMenu] = useState(false);
  /** Bumped to play the tree coming apart into the code once more. */
  const [replay, setReplay] = useState(0);

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
   * Saves the code as a PNG.
   *
   * Copied off the live canvas rather than re-rendered, so what lands in the
   * camera roll is the settled frame the person was looking at. It is copied
   * rather than exported directly because the canvas is transparent outside the
   * lawn, and a transparent QR saved to a camera roll shows on whatever the
   * viewer's app uses - which can be black, the one thing that must never
   * happen to a code.
   */
  const save = async () => {
    const source = cardRef.current?.querySelector('canvas');
    if (!source) return;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = source.width;
      canvas.height = source.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('no 2d context');

      context.fillStyle = '#FFFFFF';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source, 0, 0);

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
    <Sheet title="Your QR code" hideTitle onClose={onClose} className="border-0 bg-transparent p-1.5 shadow-none sm:p-1.5">
      <div className="flex flex-col items-center">
        {/* Fade and scale, once, on entry - the small rise is what makes it feel handed over. */}
        <div ref={cardRef} className="qr-card w-full max-w-[22rem] rounded-[2rem] px-5 pt-5 pb-5 shadow-[0_24px_60px_-24px_rgba(80,40,140,0.35)] motion-safe:animate-qr-in">
          {/* The brand, and a small menu. */}
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <AppLogo size={30} alt="" />
              <span className="text-[15px] font-bold tracking-[0.22em]">PINGO</span>
            </span>
            <span className="relative">
              <button
                type="button"
                aria-label="More"
                aria-expanded={menu}
                onClick={() => setMenu((m) => !m)}
                className="focus-ring qr-muted grid size-9 place-items-center rounded-full hover:bg-black/5"
              >
                <MoreHorizontal size={20} />
              </button>
              {menu && (
                <span role="menu" className="qr-glass absolute top-10 right-0 z-10 flex w-44 flex-col overflow-hidden rounded-2xl py-1 text-[14px]">
                  <button type="button" role="menuitem" onClick={() => { setMenu(false); setReplay((n) => n + 1); }} className="px-4 py-2.5 text-left hover:bg-black/5">
                    Play the tree again
                  </button>
                  <button type="button" role="menuitem" onClick={() => { setMenu(false); void copy(); }} className="px-4 py-2.5 text-left hover:bg-black/5">
                    Copy link
                  </button>
                </span>
              )}
            </span>
          </div>

          <div className="mt-3 flex flex-col items-center gap-2.5">
            <span className="qr-ring">
              <Avatar name={displayName} id={userId} src={avatarUrl} size="xl" />
            </span>
            <div className="text-center">
              <p className="text-[24px] font-bold leading-tight tracking-[-0.02em]">{displayName}</p>
              <p className="qr-muted text-[14px]">@{username}</p>
            </div>
          </div>

          {/*
            The plate. White in both themes on purpose - scanners assume the
            light modules are light - and frosted at the edge so it sits in the
            card rather than on it.
          */}
          <div className="mx-auto mt-4 w-fit rounded-[1.75rem] bg-white p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.9),0_16px_40px_-18px_rgba(80,40,140,0.35)]">
            <VoxelQr key={replay} value={link} size={236} autoPlay caption="" label={`QR code for ${displayName} on PINGO`} />
          </div>

          <p className="qr-muted mt-3 text-center text-[13.5px]">Scan to connect on PINGO</p>

          {error && (
            <p role="alert" className="mt-2 text-center text-caption text-danger">
              {error}
            </p>
          )}

          <div className="mt-4 grid grid-cols-3 gap-2.5">
            <Action label="Share" tint="#e0559b" onClick={() => void share()}>
              <ShareIcon size={22} />
            </Action>
            <Action label={saved ? 'Saved' : 'Save'} tint="#8b5dff" onClick={() => void save()}>
              {saved ? <CheckIcon size={22} /> : <StorageIcon size={22} />}
            </Action>
            <Action label={copied ? 'Copied' : 'Copy link'} tint="#f0a020" onClick={() => void copy()}>
              {copied ? <CheckIcon size={22} /> : <LinkIcon size={22} />}
            </Action>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

/** One of the three actions: a frosted tile, the icon in its own colour. */
function Action({
  label,
  tint,
  onClick,
  children,
}: {
  label: string;
  tint: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'qr-glass focus-ring flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3.5',
        'text-[13.5px] font-medium',
        'transition-transform duration-quick ease-standard active:scale-[0.96]',
      )}
    >
      <span style={{ color: tint }}>{children}</span>
      <span className="opacity-80">{label}</span>
    </button>
  );
}
