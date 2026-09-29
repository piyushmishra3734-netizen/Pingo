import { Avatar, CheckIcon, LinkIcon, ShareIcon, StorageIcon, cn } from '@pingo/ui';
import { MoreHorizontal } from 'lucide-react';
import { useRef, useState } from 'react';

import { AppLogo } from '../../components/AppLogo.js';
import { Overlay } from '../../components/Overlay.js';
import { profileLink } from './ShareProfileSheet.js';
import { FallingPetals, Petal, SakuraBackdrop } from './SakuraScene.js';
import { VoxelCat, catEdge } from './VoxelCat.js';
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
    <Overlay onDismiss={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Your QR code"
        className="qr-scene-in fixed inset-0 z-[600] overflow-hidden"
        onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <SakuraBackdrop />
        <FallingPetals />

        <div
          className="relative flex h-full items-center justify-center px-[7%] pt-[max(4.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]"
          onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <div className="qr-card-in relative w-full max-w-[21rem]">
            <div ref={cardRef} className="qr-card rounded-[1.9rem] px-5 pb-[15px]">
              {/* The brand, top left. */}
              <span className="absolute top-[18px] left-[24px] flex items-center gap-2.5">
                <AppLogo size={32} alt="" />
                <span className="text-[16px] font-extrabold tracking-[0.24em]">PINGO</span>
              </span>

              {/* A small glass pill of a menu, top right. */}
              <span className="absolute top-[20px] right-[16px] z-20">
                <button
                  type="button"
                  aria-label="More"
                  aria-expanded={menu}
                  onClick={() => setMenu((m) => !m)}
                  className="qr-glass focus-ring grid h-[24px] w-[34px] place-items-center rounded-full text-[#8e86a0]"
                >
                  <MoreHorizontal size={18} strokeWidth={2.6} />
                </button>
                {menu && (
                  <span role="menu" className="qr-glass absolute top-8 right-0 flex w-44 flex-col overflow-hidden rounded-2xl py-1 text-[14px] font-semibold">
                    <button type="button" role="menuitem" onClick={() => { setMenu(false); setReplay((n) => n + 1); }} className="px-4 py-2.5 text-left hover:bg-white/50">
                      Play the tree again
                    </button>
                    <button type="button" role="menuitem" onClick={() => { setMenu(false); void copy(); }} className="px-4 py-2.5 text-left hover:bg-white/50">
                      Copy link
                    </button>
                  </span>
                )}
              </span>

              {/* Petals that have landed on the glass - never over the code. */}
              {CARD_PETALS.map((p, i) => (
                <Petal key={i} size={p.size} className="pointer-events-none absolute" style={{ left: `${p.x}%`, top: `${p.y}%`, transform: `rotate(${p.r}deg)`, opacity: p.o }} />
              ))}

              <div className="relative flex flex-col items-center pt-[40px]">
                <span className="qr-ring">
                  <Avatar name={displayName} id={userId} src={avatarUrl} size="xl" className="!size-[80px]" />
                </span>
                <p className="mt-0.5 max-w-full truncate text-[23px] font-extrabold leading-[1.15] tracking-[-0.01em]">{displayName}</p>
                <p className="qr-muted text-[13.5px] font-semibold leading-[1.1]">@{username}</p>

                {/*
                  The plate. Frosted glass around a code that stays on white in
                  every theme - scanners assume the light modules are light.
                */}
                <div className="qr-glass mt-[10px] grid h-[241px] w-[260px] max-w-full place-items-center rounded-[22px]">
                  <div className="rounded-[14px] bg-white/85">
                    <VoxelQr key={replay} value={link} size={222} autoPlay caption="" label={`QR code for ${displayName} on PINGO`} />
                  </div>
                </div>

                <p className="mt-[6px] text-[12.5px] font-medium text-[#6f6a7d]">Scan to connect on PINGO</p>

                {error && (
                  <p role="alert" className="mt-1 text-center text-caption text-danger">
                    {error}
                  </p>
                )}

                <div className="mt-[7px] grid w-full grid-cols-3 gap-[10px]">
                  <Action label="Share" tint="#ee4fa3" onClick={() => void share()}>
                    <ShareIcon size={25} />
                  </Action>
                  <Action label={saved ? 'Saved' : 'Save'} tint="#9d6cf6" onClick={() => void save()}>
                    {saved ? <CheckIcon size={25} /> : <StorageIcon size={25} />}
                  </Action>
                  <Action label={copied ? 'Copied' : 'Copy link'} tint="#f5a524" onClick={() => void copy()}>
                    {copied ? <CheckIcon size={25} /> : <LinkIcon size={25} />}
                  </Action>
                </div>
              </div>
            </div>

            {/* The cat, lying on the card's top edge: paws over the front, tail hanging down. */}
            <VoxelCat size={CAT_SIZE} className="pointer-events-none absolute z-10" style={{ left: CAT_LEFT, top: -catEdge(CAT_SIZE).top, transform: 'rotate(-4deg)', transformOrigin: `${catEdge(CAT_SIZE).left}px ${catEdge(CAT_SIZE).top}px` }} />
            {/* Petals that have landed on the cat: one on its back, one at the tip of its tail, one beside a paw. */}
            <Petal size={22} className="pointer-events-none absolute z-20" style={{ left: `calc(${CAT_HEAD} + 90px)`, top: -30, transform: 'rotate(60deg)' }} />
            <Petal size={20} className="pointer-events-none absolute z-20" style={{ left: `calc(${CAT_HEAD} + 66px)`, top: 72, transform: 'rotate(-30deg)' }} />
            <Petal size={16} className="pointer-events-none absolute z-20" style={{ left: `calc(${CAT_HEAD} - 20px)`, top: -12, transform: 'rotate(25deg)' }} />
          </div>
        </div>
      </div>
    </Overlay>
  );
}

const CAT_SIZE = 4.1;
/**
 * Where the cat's head starts, from the card's left. Measured back from the
 * right edge, so on any width the tail hangs just left of the menu pill.
 */
const CAT_HEAD = `(100% - ${Math.round(17 * CAT_SIZE + 64)}px)`;
const CAT_LEFT = `calc(${CAT_HEAD} - ${catEdge(CAT_SIZE).left}px)`;

/** Where petals rest on the card, in % of its box. Kept off the code in the middle. */
const CARD_PETALS = [
  { x: 9, y: 17, size: 24, r: -40, o: 1 },
  { x: 12, y: 29, size: 19, r: 25, o: 1 },
  { x: 7, y: 44, size: 16, r: -65, o: 0.95 },
  { x: 11, y: 58, size: 21, r: 35, o: 1 },
  { x: 3, y: 73, size: 20, r: -15, o: 1 },
  { x: 85, y: 17, size: 26, r: 30, o: 1 },
  { x: 81, y: 30, size: 16, r: -10, o: 0.95 },
  { x: 89, y: 43, size: 20, r: 55, o: 1 },
  { x: 86, y: 57, size: 17, r: -40, o: 0.95 },
  { x: 90, y: 71, size: 22, r: 15, o: 1 },
  { x: 35, y: 94, size: 18, r: -70, o: 1 },
  { x: 60, y: 95, size: 15, r: 25, o: 0.95 },
  { x: 4, y: 91, size: 16, r: 60, o: 0.95 },
  { x: 91, y: 93, size: 20, r: -35, o: 1 },
];

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
        'qr-glass focus-ring flex h-[62px] flex-col items-center justify-center gap-1 rounded-[16px] px-2',
        'text-[14px] font-bold text-[#2e2a3a]',
        'transition-transform duration-quick ease-standard active:scale-[0.96]',
      )}
    >
      <span style={{ color: tint }}>{children}</span>
      <span>{label}</span>
    </button>
  );
}
