import { useEffect, useState } from 'react';

import { Sheet, SheetCancel } from '../../components/Sheet.js';
import { PeoplePicker } from './PeoplePicker.js';
import { useStories } from './StoryContext.js';

/**
 * Who counts as a close friend.
 *
 * One-directional and private: nobody is told they are on the list, and nobody
 * can read it but its owner. That is the whole reason the feature is usable  - 
 * a list people could see would be a public ranking of one's friendships.
 *
 * Writes on every tick rather than on a Save. This is a setting, not a form:
 * there is no coherent half-finished state to protect, and a Save button would
 * invite somebody to tick six names and then lose them to a back gesture.
 */

export function CloseFriendsSheet({ onClose }: { onClose: () => void }) {
  const { service } = useStories();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void service
      .listCloseFriends()
      .then((ids) => {
        if (active) {
          setSelected(new Set(ids));
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
    // Applied first, so a tick lands under the finger rather than a beat later.
    setSelected((previous) => {
      const updated = new Set(previous);
      if (next) updated.add(userId);
      else updated.delete(userId);
      return updated;
    });
    setBusy(true);
    setError(undefined);
    try {
      await service.setCloseFriend(userId, next);
    } catch {
      setError('That did not save. Try again.');
      setSelected((previous) => {
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
    <Sheet
      title="Close friends"
      description="They see a green ring, and only they see stories you send to this list. Nobody is told."
      onClose={onClose}
    >
      {!loaded ? (
        <p className="py-8 text-center text-caption text-text-tertiary">Loading…</p>
      ) : (
        <PeoplePicker
          selected={selected}
          onToggle={(userId, next) => void toggle(userId, next)}
          emptyLabel="Nobody to add yet."
          busy={busy}
        />
      )}

      {error && (
        <p role="alert" className="mt-2 text-caption text-danger">
          {error}
        </p>
      )}

      <div className="mt-2">
        <SheetCancel onClick={onClose} label="Done" />
      </div>
    </Sheet>
  );
}
