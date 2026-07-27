import { ArchiveIcon, PlusIcon, ShieldIcon, TrashIcon, UsersIcon } from '@pingo/ui';
import { useState } from 'react';

import { useConfirm } from '../../components/ConfirmProvider.js';
import { Sheet, SheetCancel, SheetItem } from '../../components/Sheet.js';
import { CloseFriendsSheet } from './CloseFriendsSheet.js';
import { useStories } from './StoryContext.js';
import { StoryPrivacySheet } from './StoryPrivacySheet.js';

/**
 * Holding your own circle in the rail.
 *
 * The spec asks for delete and archive. Adding another, editing the close
 * friends list and reaching the privacy settings are here too, because this is
 * the only place a person is already thinking about their own story — putting
 * "who sees my stories" three screens away in Settings is how a privacy control
 * ends up never being found.
 *
 * ## Why deleting takes the newest
 *
 * "Delete current story" is unambiguous when there is one. With several, the
 * newest is the one the circle is showing and the one somebody has just decided
 * against — and anything older is reachable from the viewer's own menu, one
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
      title: count > 1 ? 'Delete your latest story?' : 'Delete your story?',
      description:
        count > 1
          ? `The other ${count - 1} stay up. It goes along with its views and likes.`
          : 'It goes now rather than at the end of the day, along with its views and likes.',
      confirmLabel: 'Delete',
    });
    if (!go) return;
    await service.remove(newest.id);
    await refresh();
  };

  if (closeFriends) return <CloseFriendsSheet onClose={onClose} />;
  if (privacy) return <StoryPrivacySheet onClose={onClose} />;

  return (
    <Sheet
      title="Your story"
      description={count === 1 ? '1 story, live for 24 hours' : `${count} stories, live for 24 hours`}
      onClose={onClose}
    >
      <div className="mt-3 flex flex-col gap-1">
        <SheetItem icon={<PlusIcon size={20} />} label="Add to your story" onClick={onAdd} />
        <SheetItem
          icon={<UsersIcon size={20} />}
          label="Close friends"
          hint="They see a green ring"
          onClick={() => setCloseFriends(true)}
        />
        <SheetItem
          icon={<ShieldIcon size={20} />}
          label="Story privacy"
          hint="Hide your stories from certain people"
          onClick={() => setPrivacy(true)}
        />
        <SheetItem
          icon={<ArchiveIcon size={20} />}
          label="Story archive"
          hint="Only you can see it"
          onClick={onArchive}
        />

        {newest && (
          <SheetItem
            icon={<TrashIcon size={20} />}
            label={count > 1 ? 'Delete latest story' : 'Delete story'}
            tone="danger"
            onClick={() => void removeNewest()}
          />
        )}

        <SheetCancel onClick={onClose} />
      </div>
    </Sheet>
  );
}
