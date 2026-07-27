import {
  BlockIcon,
  EditIcon,
  FlagIcon,
  LinkIcon,
  MuteIcon,
  QrIcon,
  SettingsIcon,
  cn,
} from '@pingo/ui';

import { Sheet, SheetCancel, SheetItem } from './Sheet.js';

/**
 * The two profile menus.
 *
 * Your own profile has a ☰ and someone else's has a ⋯, which is not decoration:
 * one opens the things you can do *to your account*, the other the things you
 * can do *about a person*. Two different questions deserve two different
 * glyphs, and the pair is the convention every messaging app has landed on.
 *
 * ## Why Settings is in here rather than a button
 *
 * The header used to carry a "Settings" text button, which spent a permanent
 * slot on a destination the dock already reaches. The menu holds it alongside
 * the two things that genuinely belong to this screen — editing the profile and
 * sharing it — and gives the header back to the profile itself.
 */

export function MyProfileMenu({
  onEdit,
  onShare,
  onSettings,
  onClose,
}: {
  onEdit: () => void;
  onShare: () => void;
  onSettings: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Profile" hideTitle onClose={onClose}>
      <div className="flex flex-col gap-1">
        <SheetItem icon={<EditIcon size={20} />} label="Edit profile" onClick={onEdit} />
        <SheetItem icon={<QrIcon size={20} />} label="Share profile" onClick={onShare} />
        <SheetItem
          icon={<SettingsIcon size={20} />}
          label="Settings and privacy"
          onClick={onSettings}
        />
        <SheetCancel onClick={onClose} />
      </div>
    </Sheet>
  );
}

export function PersonMenu({
  name,
  muted,
  blocked,
  onShare,
  onCopyLink,
  onMute,
  onBlock,
  onReport,
  onClose,
}: {
  name: string;
  /** Undefined while the conversation's state is still unknown. */
  muted: boolean | undefined;
  blocked: boolean;
  onShare: () => void;
  onCopyLink: () => void;
  onMute: () => void;
  onBlock: () => void;
  onReport: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title={name} hideTitle onClose={onClose}>
      <div className="flex flex-col gap-1">
        <SheetItem icon={<QrIcon size={20} />} label="Share profile" onClick={onShare} />
        <SheetItem icon={<LinkIcon size={20} />} label="Copy link" onClick={onCopyLink} />

        {/*
          Absent, not disabled, until the conversation is known. A mute control
          that does not yet know whether it says "Mute" or "Unmute" would have
          to guess, and it would be wrong half the time.
        */}
        {muted !== undefined && (
          <SheetItem
            icon={<MuteIcon size={20} />}
            label={muted ? `Unmute ${name}` : `Mute ${name}`}
            hint={muted ? 'Notifications are off for this chat' : undefined}
            onClick={onMute}
          />
        )}

        <SheetItem
          icon={<BlockIcon size={20} />}
          label={blocked ? `Unblock ${name}` : `Block ${name}`}
          tone={blocked ? 'normal' : 'danger'}
          onClick={onBlock}
        />
        <SheetItem
          icon={<FlagIcon size={20} />}
          label={`Report ${name}`}
          tone="danger"
          onClick={onReport}
        />

        <SheetCancel onClick={onClose} />
      </div>
    </Sheet>
  );
}

/**
 * One question, two answers, and the destructive one named rather than "OK".
 *
 * Every confirmation in the product says what will happen on the button itself,
 * because "Are you sure? / OK" is the pattern people learn to dismiss without
 * reading.
 */
export function ConfirmSheet({
  title,
  description,
  confirmLabel,
  tone = 'danger',
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'danger' | 'normal';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet title={title} description={description} onClose={onCancel}>
      <div className="mt-4 flex flex-col gap-1.5">
        <button
          type="button"
          onClick={onConfirm}
          className={cn(
            'focus-ring w-full rounded-full px-5 py-3 text-body font-medium',
            'transition-transform duration-instant active:scale-[0.98]',
            tone === 'danger'
              ? 'bg-danger text-white shadow-sm'
              : 'bg-brand-gradient text-white shadow-brand',
          )}
        >
          {confirmLabel}
        </button>
        <SheetCancel onClick={onCancel} />
      </div>
    </Sheet>
  );
}
