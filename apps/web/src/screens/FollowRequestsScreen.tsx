import { useProfile, type Profile } from '@pingo/core';
import {
  Avatar,
  ChevronLeftIcon,
  EmptyState,
  IconButton,
  LoadingState,
  UsersIcon,
  cn,
} from '@pingo/ui';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useT } from '../features/i18n/useT.js';

/**
 * People waiting on you.
 *
 * ## Why accepting does not follow back
 *
 * Accept grants *them* access to your calls, Pings and stories. It does not
 * give you theirs, because that needs your own follow - so the row stays,
 * offering "Follow back", until you decide. Collapsing the two into one tap
 * would be the app quietly deciding on your behalf.
 *
 * ## Why a rejected request disappears rather than being marked
 *
 * There is no `rejected` status. Rejecting deletes the row, which means the
 * other person sees "Follow" again rather than "Rejected" - they are never told
 * they were turned down, and they can ask again later. Storing the refusal
 * would be keeping a record whose only use is telling someone they were
 * refused.
 */
export function FollowRequestsScreen() {
  const t = useT();
  const navigate = useNavigate();
  const { service } = useProfile();

  const [requests, setRequests] = useState<Profile[]>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    void service
      .listFollowRequests()
      .then(setRequests)
      .catch((cause: unknown) => {
        setRequests([]);
        setError(cause instanceof Error ? cause.message : 'Could not load requests.');
      });
  }, [service]);

  useEffect(load, [load]);

  const respond = async (person: Profile, accept: boolean) => {
    if (busy) return;
    setBusy(person.id);
    setError(undefined);
    try {
      await (accept ? service.acceptFollow(person.id) : service.removeFollow(person.id));
      // Removed locally rather than refetching: the row is gone either way, and
      // a round trip would leave it on screen for a beat after the tap.
      setRequests((all) => all?.filter((p) => p.id !== person.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not go through.');
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-page">
      <header
        className={cn(
          'sticky top-0 z-100 shrink-0',
          'glass-surface border-x-0 border-t-0 border-b-line',
          'flex items-center gap-1 px-3 pt-4 pb-3',
          'pt-[max(1rem,env(safe-area-inset-top))]',
        )}
      >
        <IconButton label="Back" variant="ghost" onClick={() => navigate(-1)}>
          <ChevronLeftIcon size={22} />
        </IconButton>
        <h1 className="text-h2 text-ink">{t('profile.followRequests')}</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {error && (
          <p
            role="alert"
            className="mb-2 rounded-lg bg-danger-soft px-3 py-2 text-caption text-danger"
          >
            {error}
          </p>
        )}

        {!requests ? (
          <LoadingState label="Loading requests" />
        ) : requests.length === 0 ? (
          <EmptyState
            title="No requests"
            description="When someone asks to follow you, they will appear here."
            icon={<UsersIcon size={26} />}
          />
        ) : (
          <ul className="space-y-0.5">
            {requests.map((person, index) => (
              <li
                key={person.id}
                style={{ animationDelay: `${Math.min(index, 8) * 28}ms` }}
                className={cn(
                  'animate-row-in',
                  'flex items-center gap-3 rounded-lg px-2 py-2.5',
                  'transition-opacity duration-instant',
                  busy === person.id && 'opacity-50',
                )}
              >
                <Avatar
                  name={person.displayName}
                  id={person.id}
                  src={person.avatarUrl}
                  size="md"
                />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-body text-ink">{person.displayName}</p>
                  <p className="mt-0.5 truncate text-caption text-text-secondary">
                    @{person.username} wants to follow you
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void respond(person, true)}
                    disabled={Boolean(busy)}
                    className={cn(
                      'focus-ring rounded-full bg-brand-gradient px-4 py-1.5',
                      'text-caption font-medium text-white shadow-brand',
                      'transition-transform duration-instant active:scale-[0.96]',
                      'disabled:opacity-60',
                    )}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => void respond(person, false)}
                    disabled={Boolean(busy)}
                    className={cn(
                      'focus-ring rounded-full px-3 py-1.5 text-caption',
                      'text-text-secondary hover:bg-hover disabled:opacity-60',
                    )}
                  >
                    Ignore
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
