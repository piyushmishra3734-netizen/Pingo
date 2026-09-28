import { Star } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Sheet, SheetCancel, SheetItem } from '../../components/Sheet.js';
import { useT } from '../i18n/useT.js';
import { CloseFriendsSheet } from './CloseFriendsSheet.js';
import { PeoplePicker } from './PeoplePicker.js';
import { useStories } from './StoryContext.js';

/**
 * Story settings: the close friends list, and who never sees your stories.
 *
 * It used to be the hide list alone, drawn from the people the chat had loaded
 * - which on most accounts was nobody, so the sheet opened empty. It now lists
 * your friends (only friends can see a story in the first place) and puts the
 * close friends list, the other story setting, at the top.
 *
 * ## Hide my stories from these people
 *
 * An account-level list rather than a per-story one, which is what the control
 * actually means: you do not decide afresh every time whether a colleague sees
 * this. It applies to every story, including one addressed to somebody by name
 * - hiding is the stronger statement, and `can_see_story()` enforces that
 * order at the database.
 *
 * ## The other half of privacy is not here
 *
 * Muting somebody else's stories is a decision about *your* rail and lives on
 * their story's menu, where you are already looking at the thing you want to
 * stop seeing. Putting both in one sheet would file "what they see of me" and
 * "what I see of them" under one heading, which is how people end up muting
 * when they meant to hide.
 */

export function StoryPrivacySheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { service } = useStories();

  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [friends, setFriends] = useState<string[]>([]);
  const [closeCount, setCloseCount] = useState<number>();
  const [closeOpen, setCloseOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void Promise.all([
      service.listHiddenFrom().catch(() => [] as string[]),
      service.listFriends().catch(() => [] as string[]),
      service.listCloseFriends().catch(() => [] as string[]),
    ]).then(([hiddenIds, friendIds, closeIds]) => {
      if (!active) return;
      setHidden(new Set(hiddenIds));
      setFriends(friendIds);
      setCloseCount(closeIds.length);
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [service, closeOpen]);

  const toggle = async (userId: string, next: boolean) => {
    setHidden((previous) => {
      const updated = new Set(previous);
      if (next) updated.add(userId);
      else updated.delete(userId);
      return updated;
    });
    setBusy(true);
    setError(undefined);
    try {
      await service.setHiddenFrom(userId, next);
    } catch {
      setError(t('story.saveFail'));
      setHidden((previous) => {
        const rolledBack = new Set(previous);
        if (next) rolledBack.delete(userId);
        else rolledBack.add(userId);
        return rolledBack;
      });
    } finally {
      setBusy(false);
    }
  };

  if (closeOpen) return <CloseFriendsSheet onClose={() => setCloseOpen(false)} />;

  return (
    <Sheet title="Story settings" onClose={onClose} elevated>
      <div className="mt-3">
        <SheetItem
          icon={<Star size={18} />}
          label={t('story.closeFriendsTitle')}
          hint={closeCount === undefined ? t('common.loading') : closeCount === 1 ? '1 person' : `${closeCount} people`}
          onClick={() => setCloseOpen(true)}
        />
      </div>

      <h3 className="mt-4 px-1 text-body font-semibold text-ink">{t('story.hideTitle')}</h3>
      <p className="px-1 pt-0.5 text-caption text-text-secondary">{t('story.hideDesc')}</p>

      {!loaded ? (
        <p className="py-8 text-center text-caption text-text-tertiary">{t('common.loading')}</p>
      ) : (
        <PeoplePicker
          selected={hidden}
          onToggle={(userId, next) => void toggle(userId, next)}
          ids={[...new Set([...friends, ...hidden])]}
          emptyLabel={t('story.nobodyHide')}
          busy={busy}
        />
      )}

      {error && (
        <p role="alert" className="mt-2 text-caption text-danger">
          {error}
        </p>
      )}

      <div className="mt-2">
        <SheetCancel onClick={onClose} label={t('common.done')} />
      </div>
    </Sheet>
  );
}
