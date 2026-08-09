import { useEffect, useState } from 'react';

import { Sheet, SheetCancel } from '../../components/Sheet.js';
import { useT } from '../i18n/useT.js';
import { PeoplePicker } from './PeoplePicker.js';
import { useStories } from './StoryContext.js';

/**
 * Hide my stories from these people.
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
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void service
      .listHiddenFrom()
      .then((ids) => {
        if (active) {
          setHidden(new Set(ids));
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [service]);

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

  return (
    <Sheet title={t('story.hideTitle')} description={t('story.hideDesc')} onClose={onClose}>
      {!loaded ? (
        <p className="py-8 text-center text-caption text-text-tertiary">{t('common.loading')}</p>
      ) : (
        <PeoplePicker
          selected={hidden}
          onToggle={(userId, next) => void toggle(userId, next)}
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
