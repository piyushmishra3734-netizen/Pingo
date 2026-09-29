import { Avatar } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

import { Overlay } from '../../components/Overlay.js';
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
  /** The code's size in px: the artwork gives it 560 of its 979 px of width. */
  const [qrSize, setQrSize] = useState(220);
  useEffect(() => {
    const el = cardRef.current; if (!el) return;
    const fit = () => setQrSize(Math.round((el.getBoundingClientRect().width * 560) / ART_W));
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

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
      <div role="dialog" aria-modal="true" aria-label="Your QR code" className="qr-scene-in fixed inset-0 z-[600] overflow-hidden bg-[#f3cdd8]">
        {/* The scene carried on past the edges of the artwork, soft, on screens taller or wider than it. */}
        <img src={SCENE} alt="" aria-hidden className="absolute inset-0 size-full scale-110 object-cover blur-2xl" />

        <div className="relative grid h-full place-items-center" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          {/*
            The card, drawn at the artwork's own proportions (979 x 1606) and
            scaled to the screen. Every position below is the artwork's pixel,
            as a share of it, so the live parts land exactly where the design
            has them.
          */}
          <div
            ref={cardRef}
            className="qr-card-in relative [container-type:inline-size]"
            style={{ width: 'min(100vw, 460px, calc((100dvh - 8px) * 979 / 1606))', aspectRatio: '979 / 1606' }}
            onPointerDown={(e) => {
              // Outside the glass card itself is the scene: a tap there closes.
              const box = e.currentTarget.getBoundingClientRect();
              const x = ((e.clientX - box.left) / box.width) * 979;
              const y = ((e.clientY - box.top) / box.height) * 1606;
              if (x < 67 || x > 910 || y < 195 || y > 1484) onClose();
            }}
          >
            {/* Its top and bottom edges fade into the softened scene behind, for screens taller than the artwork. */}
            <img src={SCENE} alt="" aria-hidden className="qr-art absolute inset-0 size-full select-none" draggable={false} />

            {/* The avatar in its ring: an 8px sweep of colour, a 7px gap, the photo. */}
            <span className="qr-ring absolute" style={at(380, 294, 220, 220)}>
              <Avatar name={displayName} id={userId} src={avatarUrl} size="xl" className="!size-full !text-[7cqw]" />
            </span>

            <p className="absolute truncate text-center font-extrabold leading-none tracking-[-0.01em] text-[#1f2340]" style={{ ...at(300, 519, 379, 50), fontSize: cq(43), fontFamily: "'Manrope', var(--font-sans)" }}>
              {displayName}
            </p>
            <p className="absolute truncate text-center font-semibold leading-none text-[#7c7a8c]" style={{ ...at(300, 566, 379, 34), fontSize: cq(27), fontFamily: "'Manrope', var(--font-sans)" }}>
              @{username}
            </p>

            {/* The code, in the middle of the frosted tile. */}
            <div className="absolute grid place-items-center" style={at(174, 630, 629, 585)}>
              <div className="rounded-[3cqw] bg-white/70">
                <VoxelQr key={`${replay}-${qrSize}`} value={link} size={qrSize} autoPlay caption="" label={`QR code for ${displayName} on PINGO`} />
              </div>
            </div>

            {/* The menu pill, drawn in the artwork; this is what makes it a button. */}
            <button type="button" aria-label="More" aria-expanded={menu} onClick={() => setMenu((m) => !m)} className="focus-ring absolute rounded-full active:bg-white/30" style={at(792, 245, 80, 55)} />
            {menu && (
              <span role="menu" className="qr-glass absolute z-10 flex flex-col overflow-hidden rounded-2xl py-1 text-[14px] font-semibold text-[#2e2a3a]" style={{ right: pct(979 - 872, 979), top: pct(310, 1606) }}>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); setReplay((n) => n + 1); }} className="px-4 py-2.5 text-left whitespace-nowrap hover:bg-white/50">
                  Play the tree again
                </button>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); void copy(); }} className="px-4 py-2.5 text-left whitespace-nowrap hover:bg-white/50">
                  Copy link
                </button>
              </span>
            )}

            {/* Share, Save and Copy link are drawn in the artwork too; these are their touch areas. */}
            <PressArea label="Share" box={[116, 1290, 235, 153]} onClick={() => void share()} />
            <PressArea label="Save" box={[374, 1290, 231, 153]} onClick={() => void save()} />
            <PressArea label="Copy link" box={[628, 1290, 234, 153]} onClick={() => void copy()} />

            {(copied || saved || error) && (
              <span role="status" className="absolute left-1/2 -translate-x-1/2 rounded-full bg-[#2a2640]/85 px-3.5 py-1.5 text-[12.5px] font-semibold whitespace-nowrap text-white shadow-lg" style={{ top: pct(1236, 1606) }}>
                {error ?? (copied ? 'Link copied' : 'Saved to your phone')}
              </span>
            )}
          </div>
        </div>
      </div>
    </Overlay>
  );
}

/** The artwork's size, which every position here is measured in. */
const ART_W = 979;
const ART_H = 1606;
const SCENE = '/qr/sakura-invite.webp';

const pct = (v: number, of: number) => `${(v / of) * 100}%`;
/** A font size in the artwork's pixels, as a share of the card's width. */
const cq = (px: number) => `${(px / ART_W) * 100}cqw`;
/** A box in the artwork's pixels, placed on the card. */
const at = (x: number, y: number, w: number, h: number): React.CSSProperties => ({
  left: pct(x, ART_W),
  top: pct(y, ART_H),
  width: pct(w, ART_W),
  height: pct(h, ART_H),
});

/** An invisible button over something the artwork draws, with a soft flash when pressed. */
function PressArea({ label, box, onClick }: { label: string; box: [number, number, number, number]; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="focus-ring absolute rounded-[3.8cqw] transition-colors duration-100 active:bg-white/35"
      style={at(...box)}
    />
  );
}

