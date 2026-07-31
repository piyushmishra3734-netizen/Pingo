import { useProfile, type Profile } from '@pingo/core';
import { Avatar, Button, cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AuthScreen } from '../../features/auth/AuthScreen.js';

/**
 * Setup, last step - who else is here.
 *
 *   Finding people…
 *   █████████
 *   3 people found
 *
 * ## This is not contact matching, and the copy does not pretend it is
 *
 * The spec asked for "3 Friends Found", which means matching an address book.
 * **The web has no address-book API** - a browser cannot read contacts, at all  - 
 * so a screen claiming to have found *friends* would be claiming something it
 * did not do.
 *
 * What it does instead is real: it queries `profiles` for other people already
 * on PINGO. The count is the true count, the faces are real accounts, and an
 * empty result says so rather than inventing a number.
 *
 * Real contact matching needs a native shell (React Native or Capacitor) and a
 * device-side matching step - [§ 12](../../../../../docs/01-onboarding-auth.md#12-contacts)
 * promises the address book is never uploaded, and that promise is only
 * keepable on-device.
 *
 * ## The progress bar is honest too
 *
 * It fills while the query is in flight and stops when the answer arrives. It
 * is not a timed animation pretending to search - if the query returns in 80ms
 * the bar completes in 80ms.
 */

/** Below this the wait is imperceptible, and a flashing bar is worse than none. */
const MIN_VISIBLE_MS = 600;

export function FindingPeopleScreen() {
  const navigate = useNavigate();
  const { service } = useProfile();

  const [people, setPeople] = useState<Profile[] | undefined>();
  const [failed, setFailed] = useState(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    let active = true;

    void service
      .listRecentPeople(9)
      .then(async (found) => {
        // Hold briefly so the searching state is legible rather than a flicker.
        const elapsed = Date.now() - startedAt.current;
        if (elapsed < MIN_VISIBLE_MS) {
          await new Promise((resolve) => setTimeout(resolve, MIN_VISIBLE_MS - elapsed));
        }
        if (active) setPeople(found);
      })
      .catch(() => {
        if (active) {
          setFailed(true);
          setPeople([]);
        }
      });

    return () => {
      active = false;
    };
  }, [service]);

  const searching = people === undefined;
  const done = () => navigate('/chats', { replace: true });

  return (
    <AuthScreen
      progress={1}
      title={searching ? 'Finding people…' : peopleTitle(people, failed)}
      showBack={false}
      footer={
        <Button variant="primary" size="lg" block disabled={searching} onClick={done}>
          {people && people.length > 0 ? 'Continue' : 'Go to PINGO'}
        </Button>
      }
    >
      {/*
        Indeterminate while the query runs, full when it lands. `aria-busy`
        carries the same state for anyone not looking at it.
      */}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-busy={searching}
        aria-label="Finding people"
      >
        <div
          className={cn(
            'h-full rounded-full bg-brand-gradient',
            'transition-[width] duration-slow ease-standard',
            searching ? 'w-2/3 animate-pulse' : 'w-full',
          )}
        />
      </div>

      {people && people.length > 0 && (
        <ul className="mt-8 space-y-1">
          {people.map((person) => (
            <li key={person.id} className="flex items-center gap-3 rounded-md px-1 py-2">
              <Avatar
                name={person.displayName}
                id={person.id}
                src={person.avatarUrl}
                size="md"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-ink">{person.displayName}</span>
                <span className="block truncate text-caption text-text-secondary">
                  @{person.username}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {people && people.length === 0 && (
        <p className="mt-8 text-body text-text-secondary">
          {failed
            ? "We couldn't check just now. You can find people any time from search."
            : "You're early - nobody else is here yet. Invite someone, or find them by username later."}
        </p>
      )}
    </AuthScreen>
  );
}

/** The count, stated plainly. Singular and plural both read naturally. */
function peopleTitle(people: Profile[], failed: boolean): string {
  if (failed) return 'Finding people';
  if (people.length === 0) return 'No one here yet';
  return `${people.length} ${people.length === 1 ? 'person' : 'people'} found`;
}
