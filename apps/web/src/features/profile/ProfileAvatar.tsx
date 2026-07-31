import { Avatar, CameraIcon, TrashIcon, cn } from '@pingo/ui';
import { useRef, useState } from 'react';

import { ImageViewer } from './ImageViewer.js';
import { Sheet, SheetCancel, SheetItem } from '../../components/Sheet.js';

/**
 * The profile photo.
 *
 * ## Tap opens it, hold changes it
 *
 * Two gestures on one target, which is only acceptable because they mean
 * obviously different things: looking, and altering. The hold is offered on your
 * own profile alone - there is nothing to alter on somebody else's, so there it
 * is a plain button that opens the picture.
 *
 * ## Why a hold and not a small pencil badge
 *
 * A badge on the avatar is a 20px target on the one element people are most
 * likely to tap by accident, and it is permanently on screen for an action taken
 * roughly twice a year. The hold costs nothing visually, and the same actions
 * are also in Edit profile, which is where anyone who does not discover the hold
 * will look. Nothing is only reachable by gesture.
 *
 * ## Why there is no shared-element transition
 *
 * The picture opens with the viewer's own fade rather than flying from its
 * position on the page. A genuine shared-element animation needs the source and
 * destination in one layout, and the viewer is portalled to `document.body`
 * precisely so it cannot be clipped by an ancestor's transform, the two
 * requirements are in direct conflict. A fade that always works beats a flight
 * that lands in the wrong place whenever the page has scrolled.
 */

/** How long a press has to last to mean "change this". */
const HOLD_MS = 480;

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

  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = undefined;
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (!isSelf) return;
    held.current = false;
    origin.current = { x: event.clientX, y: event.clientY };
    timer.current = window.setTimeout(() => {
      held.current = true;
      setMenu(true);
      // The press has become a different gesture; say so the way a phone does.
      navigator.vibrate?.(8);
    }, HOLD_MS);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!origin.current) return;
    // A hold that drifts is a scroll starting, not a hold.
    const moved = Math.hypot(event.clientX, origin.current.x, event.clientY, origin.current.y);
    if (moved > 10) clear();
  };

  const onClick = () => {
    clear();
    // The hold already opened the menu; the click that follows it is noise.
    if (held.current) {
      held.current = false;
      return;
    }
    if (src) setViewing(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={clear}
        onPointerCancel={clear}
        onContextMenu={(event) => {
          // A long press on a touch screen also fires the browser's own context
          // menu, which would land on top of ours.
          if (isSelf) event.preventDefault();
        }}
        aria-label={
          src
            ? isSelf
              ? 'Your profile photo. Tap to view, hold to change.'
              : `${name}'s profile photo`
            : isSelf
              ? 'Add a profile photo'
              : `${name} has no profile photo`
        }
        className={cn(
          'focus-ring rounded-full ring-4 ring-surface',
          'transition-transform duration-quick ease-standard active:scale-[0.97]',
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
