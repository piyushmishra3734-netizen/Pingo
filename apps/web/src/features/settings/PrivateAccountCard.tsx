import { Button } from '@pingo/ui';
import { Eye, Lock, UserCheck } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Group, ToggleRow } from './controls.js';

/**
 * Private account, at the top of Privacy.
 *
 * ## A row like every other row
 *
 * It sits in the same kind of group, with the same switch and the same note
 * under it, as everything else on these pages. It was a card of its own with a
 * glow and a list - louder than the setting needed, and out of step with the
 * page it lived on. The note says what it does in one sentence.
 *
 * ## Asked, both ways
 *
 * Flipping it opens a sheet saying what will change before it changes: going
 * private takes the profile away from people who could see it a moment ago,
 * and going public hands it to everybody. Neither should happen from a thumb
 * brushing a switch.
 */
export function PrivateAccountCard({
  isPrivate,
  onChange,
}: {
  isPrivate: boolean;
  onChange: (next: boolean) => void;
}) {
  const [asking, setAsking] = useState<boolean>();

  return (
    <>
      <Group
        title="Account privacy"
        note={
          isPrivate
            ? 'Only followers you approve can see your posts, bio and details. Anyone can still find your name, photo and username to ask.'
            : 'Anyone on PINGO can see your posts, bio and details. Following you still needs your approval.'
        }
      >
        <ToggleRow label="Private account" checked={isPrivate} onChange={(next) => setAsking(next)} />
      </Group>

      {asking !== undefined && (
        <Confirm
          toPrivate={asking}
          onCancel={() => setAsking(undefined)}
          onConfirm={() => {
            onChange(asking);
            setAsking(undefined);
          }}
        />
      )}
    </>
  );
}

/** What switching will do, said before it is done: three lines, one column. */
function Confirm({
  toPrivate,
  onCancel,
  onConfirm,
}: {
  toPrivate: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const points: [ReactNode, string][] = toPrivate
    ? [
        [<Lock key="a" size={20} />, 'Only followers you approve can see your posts, bio and details.'],
        [<UserCheck key="b" size={20} />, 'People who already follow you keep seeing everything.'],
        [<Eye key="c" size={20} />, 'Your name, photo and username can still be found.'],
      ]
    : [
        [<Eye key="a" size={20} />, 'Anyone on PINGO can see your posts, bio and details.'],
        [<UserCheck key="b" size={20} />, 'Following you still needs your approval.'],
        [<Lock key="c" size={20} />, 'Stories, calls and Pings stay with people you both follow.'],
      ];

  return (
    <div
      className="fixed inset-0 z-[700] flex items-end justify-center bg-black/45 sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="private-confirm-title"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-t-[24px] bg-surface px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-[24px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div aria-hidden className="mx-auto mb-4 h-1 w-9 rounded-full bg-line-strong sm:hidden" />
        <h2 id="private-confirm-title" className="text-center text-[17px] font-semibold text-ink">
          {toPrivate ? 'Switch to a private account?' : 'Switch to a public account?'}
        </h2>

        <ul className="mt-5 flex flex-col gap-4">
          {points.map(([icon, text]) => (
            <li key={text} className="grid grid-cols-[24px_1fr] items-start gap-3.5 text-[15px] leading-snug text-ink">
              <span aria-hidden className="pt-px text-text-secondary">
                {icon}
              </span>
              {text}
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-col gap-2">
          <Button variant="primary" size="lg" onClick={onConfirm} className="w-full">
            {toPrivate ? 'Switch to private' : 'Switch to public'}
          </Button>
          <Button variant="text" size="lg" onClick={onCancel} className="w-full">
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
