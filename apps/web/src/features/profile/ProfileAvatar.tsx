import { Avatar, CameraIcon, TrashIcon, cn } from '@pingo/ui';
import { useRef, useState } from 'react';

import { ImageViewer } from './ImageViewer.js';
import { Sheet, SheetCancel, SheetItem } from '../../components/Sheet.js';

/**
 * The profile photo.
 *
 * ## Hold to view (Instagram-style)
 *
 * A short tap does not open the full picture - that surprised people who only
 * meant to rest a finger on the page. A deliberate hold expands the photo to
 * full screen, which is the same gesture people already know from Instagram.
 *
 * ## Changing your own photo
 *
 * Hold-to-view owns the long press when a photo exists. Add / change / remove
 * still live in Edit profile, and when there is no photo yet a hold (or tap)
 * opens the add sheet so an empty avatar is not a dead control.
 *
 * ## Why there is no shared-element transition
 *
 * The viewer is portalled to `document.body` so it cannot be clipped by an
 * ancestor transform. That layout split rules out a true shared-element flight;
 * a fade that always works beats a flight that lands wrong after scroll.
 */

/** How long a press must last to mean "show the photo". */
const HOLD_MS = 480;
/** Drift past this cancels the hold - it is a scroll, not a press. */
const MOVE_CANCEL_PX = 10;

export function ProfileAvatar({
  name,
  id,
  src,
  online,
  isSelf,
  onChangePhoto,
  onRemovePhoto,
}: {
  name: string;
  id: string;
  src: string | undefined;
  online: boolean;
  isSelf: boolean;
  onChangePhoto: () => void;
  onRemovePhoto: () => void;
}) {
  const [viewing, setViewing] = useState(false);
  const [menu, setMenu] = useState(false);

  const timer = useRef<number | undefined>(undefined);
  const held = useRef(false);
  const origin = useRef<{ x: number; y: number } | undefined>(undefined);

  const clearTimer = () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
  };

  const onPointerDown = (event: React.PointerEvent) => {
    // Nothing to hold for: other people with no photo.
    if (!src && !isSelf) return;

    held.current = false;
    origin.current = { x: event.clientX, y: event.clientY };
    clearTimer();

    timer.current = window.setTimeout(() => {
      held.current = true;
      if (src) {
        // Instagram: press-and-hold expands the profile photo.
        setViewing(true);
        navigator.vibrate?.(8);
      } else if (isSelf) {
        // Empty avatar: hold still offers "Add photo".
        setMenu(true);
        navigator.vibrate?.(8);
      }
    }, HOLD_MS);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!origin.current || timer.current === undefined) return;
    const moved = Math.hypot(
      event.clientX - origin.current.x,
      event.clientY - origin.current.y,
    );
    if (moved > MOVE_CANCEL_PX) clearTimer();
  };

  const onPointerUp = () => {
    clearTimer();
    origin.current = undefined;
  };

  const onClick = () => {
    clearTimer();
    // The hold already opened the viewer or the add sheet; the click after is noise.
    if (held.current) {
      held.current = false;
      return;
    }
    // Tap never opens the full photo. Empty own avatar: short path to add one.
    if (isSelf && !src) {
      setMenu(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(event) => {
          // Long-press would open the browser menu over our viewer / sheet.
          if (src || isSelf) event.preventDefault();
        }}
        aria-label={
          src
            ? isSelf
              ? 'Your profile photo. Hold to view full size. Change it from Edit profile.'
              : `${name}'s profile photo. Hold to view full size.`
            : isSelf
              ? 'Add a profile photo'
              : `${name} has no profile photo`
        }
        className={cn(
          // Soft face plate: ring reads as depth, not a sticker on the page.
          'focus-ring rounded-full shadow-sm',
          'transition-transform duration-quick ease-standard active:scale-[0.97]',
          /*
            Own profile: a little more air and emphasis without growing the face
            - "this is my identity" rather than a denser stranger portrait.
          */
          isSelf
            ? 'ring-[5px] ring-surface p-0.5 shadow-md'
            : 'ring-[3px] ring-surface',
        )}
      >
        <Avatar
          name={name}
          id={id}
          src={src}
          size="xl"
          presence={online ? 'online' : undefined}
        />
      </button>

      {viewing && src && (
        <ImageViewer src={src} alt={`${name}'s profile photo`} onClose={() => setViewing(false)} />
      )}

      {menu && (
        <Sheet title="Profile photo" onClose={() => setMenu(false)}>
          <div className="mt-3 flex flex-col gap-1">
            <SheetItem
              icon={<CameraIcon size={20} />}
              label={src ? 'Change photo' : 'Add photo'}
              onClick={() => {
                setMenu(false);
                onChangePhoto();
              }}
            />
            {src && (
              <SheetItem
                icon={<TrashIcon size={20} />}
                label="Remove photo"
                hint="Your monogram takes its place"
                tone="danger"
                onClick={() => {
                  setMenu(false);
                  onRemovePhoto();
                }}
              />
            )}
            <SheetCancel onClick={() => setMenu(false)} />
          </div>
        </Sheet>
      )}
    </>
  );
}
