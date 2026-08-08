import type { Story } from '@pingo/core';
import {
  ArchiveIcon,
  BlockIcon,
  FlagIcon,
  LinkIcon,
  MuteIcon,
  ShareIcon,
  StorageIcon,
  TrashIcon,
  UsersIcon,
} from '@pingo/ui';

import { Sheet, SheetCancel, SheetItem } from '../../components/Sheet.js';
import { useT } from '../i18n/useT.js';

/**
 * The `⋯` on a story - two different menus for two different situations.
 *
 * Your own story is a thing you can manage: take it down, keep a copy, see who
 * watched it. Somebody else's is a thing you can pass on or step away from.
 * They share only "Share", so building them as one menu with half its rows
 * hidden would be one component pretending to be two.
 */

export function MyStoryMenu({
  onDelete,
  onSave,
  onArchive,
  onInsights,
  onShare,
  onClose,
}: {
  onDelete: () => void;
  onSave: () => void;
  onArchive: () => void;
  onInsights: () => void;
  onShare: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Sheet title={t('stories.yourStory')} hideTitle onClose={onClose} elevated>
      <div className="flex flex-col gap-1">
        <SheetItem
          icon={<UsersIcon size={20} />}
          label={t('stories.viewInsights')}
          onClick={onInsights}
        />
        <SheetItem icon={<ShareIcon size={20} />} label={t('stories.share')} onClick={onShare} />
        <SheetItem
          icon={<StorageIcon size={20} />}
          label={t('stories.save')}
          hint="Downloads the picture to this device"
          onClick={onSave}
        />
        <SheetItem
          icon={<ArchiveIcon size={20} />}
          label={t('stories.archive')}
          onClick={onArchive}
        />
        <SheetItem
          icon={<TrashIcon size={20} />}
          label={t('stories.delete')}
          tone="danger"
          onClick={onDelete}
        />
        <SheetCancel onClick={onClose} />
      </div>
    </Sheet>
  );
}

export function OtherStoryMenu({
  story,
  muted,
  onShare,
  onCopyLink,
  onMute,
  onReport,
  onClose,
}: {
  story: Story;
  muted: boolean;
  onShare: () => void;
  onCopyLink: () => void;
  onMute: () => void;
  onReport: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const first = story.authorName.split(' ')[0];

  return (
    <Sheet title={story.authorName} hideTitle onClose={onClose} elevated>
      <div className="flex flex-col gap-1">
        <SheetItem icon={<ShareIcon size={20} />} label={t('stories.share')} onClick={onShare} />
        <SheetItem
          icon={<LinkIcon size={20} />}
          label={t('stories.copyLink')}
          onClick={onCopyLink}
        />
        <SheetItem
          icon={muted ? <BlockIcon size={20} /> : <MuteIcon size={20} />}
          label={muted ? `Unmute ${first}'s stories` : `Mute ${first}'s stories`}
          hint={
            muted
              ? 'Their circle comes back to your rail'
              : 'Their circle stops appearing. They are not told'
          }
          onClick={onMute}
        />
        <SheetItem
          icon={<FlagIcon size={20} />}
          label={t('stories.report')}
          tone="danger"
          onClick={onReport}
        />
        <SheetCancel onClick={onClose} />
      </div>
    </Sheet>
  );
}
