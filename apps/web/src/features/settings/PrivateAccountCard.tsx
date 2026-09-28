import { Toggle, cn } from '@pingo/ui';
import { Globe, LayoutGrid, Lock, UserCheck, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';

/**
 * Private account: the switch, and what it means, at the top of Privacy.
 *
 * ## A card, not a row
 *
 * It is the one privacy choice that changes what other people see of you, so
 * it gets the room to say so: which way it is set, in words, and the three
 * things it decides. A row with a toggle and a sub-line hides the part people
 * actually need - that followers they already have keep seeing everything.
 *
 * ## Asked, both ways
 *
 * Flipping it opens a sheet saying what will change before it changes -
 * going private takes posts away from people who could see them a moment ago,
 * and going public hands them to everybody. Neither should happen from a thumb
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
      <section
        aria-labelledby="private-account-title"
        className="relative mb-7 overflow-hidden rounded-[22px] bg-surface p-4 shadow-sm"
      >
        <span
          aria-hidden
          className={cn(
            'bg-sweep pointer-events-none absolute -top-16 -right-16 size-44 rounded-full blur-3xl transition-opacity duration-500',
            isPrivate ? 'opacity-30' : 'opacity-10',
          )}
        />

        <div className="relative flex items-center gap-3.5">
          <span
            aria-hidden
            className={cn(
              'grid size-12 shrink-0 place-items-center rounded-[15px] text-white transition-colors duration-300',
              isPrivate ? 'bg-sweep' : 'bg-[#8a8d9a]',
            )}
          >
            {isPrivate ? <Lock size={22} /> : <Globe size={22} />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="private-account-title" className="text-[17px] font-semibold text-ink">
              Private account
            </h2>
            <p className="text-caption text-text-secondary">
              {isPrivate ? 'Only followers you approve see your posts' : 'Anyone on PINGO can see your posts'}
            </p>
          </div>
          <Toggle checked={isPrivate} onChange={(next) => setAsking(next)} label="Private account" />
        </div>

        <ul className="relative mt-4 flex flex-col gap-2.5 border-t border-line pt-4">
          <Fact icon={<LayoutGrid size={16} />} on={isPrivate}>
            {isPrivate ? 'Posts: followers you have approved' : 'Posts: everyone on PINGO'}
          </Fact>
          <Fact icon={<UserCheck size={16} />} on>
            New followers ask first, and you choose
          </Fact>
          <Fact icon={<Users size={16} />} on>
            Stories, calls and Pings: people you both follow
          </Fact>
        </ul>
      </section>

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

function Fact({ icon, on, children }: { icon: ReactNode; on: boolean; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 text-[14px] text-ink">
      <span
        aria-hidden
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-full',
          on ? 'bg-brand/10 text-brand' : 'bg-sunken text-text-tertiary',
        )}
      >
        {icon}
      </span>
      {children}
    </li>
  );
}

/** What switching will do, said before it is done. */
function Confirm({
  toPrivate,
  onCancel,
  onConfirm,
}: {
  toPrivate: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const points = toPrivate
    ? [
        'Only followers you approve will see your posts.',
        'People who already follow you keep seeing them.',
        'Your name, photo and bio can still be found.',
      ]
    : [
        'Anyone on PINGO will be able to see your posts.',
        'Follow requests still come to you to accept.',
        'Stories, calls and Pings stay with people you both follow.',
      ];

  return (
    <div
      className="fixed inset-0 z-[700] flex items-end justify-center bg-black/50 sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="private-confirm-title"
      onClick={onCancel}
    >
      <style>{'@keyframes pa-rise { from { transform: translateY(24px); opacity: 0 } } @media (prefers-reduced-motion: reduce) { .pa-rise { animation: none !important } }'}</style>
      <div
        className="pa-rise w-full max-w-md rounded-t-[28px] bg-surface px-6 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:rounded-[28px]"
        style={{ animation: 'pa-rise .34s cubic-bezier(.2,.8,.2,1)' }}
        onClick={(event) => event.stopPropagation()}
      >
        <span
          aria-hidden
          className={cn(
            'mx-auto grid size-14 place-items-center rounded-[18px] text-white',
            toPrivate ? 'bg-sweep' : 'bg-[#8a8d9a]',
          )}
        >
          {toPrivate ? <Lock size={26} /> : <Globe size={26} />}
        </span>
        <h2 id="private-confirm-title" className="mt-4 text-center text-[20px] font-bold text-ink">
          {toPrivate ? 'Switch to a private account?' : 'Switch to a public account?'}
        </h2>
        <ul className="mt-4 flex flex-col gap-2.5">
          {points.map((point) => (
            <li key={point} className="flex gap-2.5 text-[14.5px] leading-snug text-text-secondary">
              <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-brand" />
              {point}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={onConfirm}
          className="focus-ring bg-sweep mt-6 h-12 w-full rounded-full text-[16px] font-semibold text-white active:scale-[0.98]"
        >
          {toPrivate ? 'Switch to private' : 'Switch to public'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="focus-ring mt-2 h-11 w-full rounded-full text-[15px] font-medium text-text-secondary active:bg-sunken"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
