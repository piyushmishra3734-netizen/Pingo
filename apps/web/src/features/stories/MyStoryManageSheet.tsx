import { ArchiveIcon, PlusIcon, ShieldIcon, TrashIcon, UsersIcon } from '@pingo/ui';
import { useState } from 'react';

import { useConfirm } from '../../components/ConfirmProvider.js';
import { Sheet, SheetCancel, SheetItem } from '../../components/Sheet.js';
import { useT } from '../i18n/useT.js';
import { CloseFriendsSheet } from './CloseFriendsSheet.js';
import { useStories } from './StoryContext.js';
import { StoryPrivacySheet } from './StoryPrivacySheet.js';

/**
 * Holding your own circle in the rail.
 *
 * The spec asks for delete and archive. Adding another, editing the close
 * friends list and reaching the privacy settings are here too, because this is
 * the only place a person is already thinking about their own story - putting
 * "who sees my stories" three screens away in Settings is how a privacy control
 * ends up never being found.
 *
 * ## Why deleting takes the newest
 *
 * "Delete current story" is unambiguous when there is one. With several, the
 * newest is the one the circle is showing and the one somebody has just decided
 * against - and anything older is reachable from the viewer's own menu, one
 * story at a time, where you can see what you are removing.
 */

export function MyStoryManageSheet({
  onClose,
  onAdd,
  onArchive,
}: {
  onClose: () => void;
  onAdd: () => void;
  onArchive: () => void;
}) {
  const t = useT();
  const { mine, service, refresh } = useStories();
  const confirm = useConfirm();

  const [closeFriends, setCloseFriends] = useState(false);
  const [privacy, setPrivacy] = useState(false);

  const newest = mine?.stories[mine.stories.length - 1];
  const count = mine?.stories.length ?? 0;

  const removeNewest = async () => {
    if (!newest) return;
    onClose();
    const go = await confirm({
      title: count > 1 ? t('story.deleteLatestQ') : t('story.deleteQ'),
      description:
        count > 1
          ? t('story.deleteLatestBody', { n: count - 1 })
          : t('story.deleteBody'),
      confirmLabel: t('select.delete'),
    });
    if (!go) return;
    await service.remove(newest.id);
    await refresh();
  };

  if (closeFriends) return <CloseFriendsSheet onClose={onClose} />;
  if (privacy) return <StoryPrivacySheet onClose={onClose} />;

  return (
    <Sheet
      title={t('story.manageTitle')}
      description={count === 1 ? t('story.oneLive') : t('story.nLive', { n: count })}
      onClose={onClose}
    >
      <div className="mt-3 flex flex-col gap-1">
        <SheetItem icon={<PlusIcon size={20} />} label={t('story.add')} onClick={onAdd} />
        <SheetItem
          icon={<UsersIcon size={20} />}
          label={t('story.closeFriends')}
          hint={t('story.closeFriendsHint')}
          onClick={() => setCloseFriends(true)}
        />
        <SheetItem
          icon={<ShieldIcon size={20} />}
          label={t('story.privacy')}
          hint={t('story.privacyHint')}
          onClick={() => setPrivacy(true)}
        />
        <SheetItem
          icon={<ArchiveIcon size={20} />}
          label={t('story.archive')}
          hint={t('story.archiveHint')}
          onClick={onArchive}
        />

        {newest && (
          <SheetItem
            icon={<TrashIcon size={20} />}
            label={count > 1 ? t('story.deleteLatest') : t('story.deleteStory')}
            tone="danger"
            onClick={() => void removeNewest()}
          />
        )}

        <SheetCancel onClick={onClose} />
      </div>
    </Sheet>
  );
}
