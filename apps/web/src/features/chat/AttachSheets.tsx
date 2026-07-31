import { useChat, type EventRef, type LocationRef } from '@pingo/core';
import { Avatar, cn } from '@pingo/ui';
import { useEffect, useState } from 'react';

import { Overlay } from '../../components/Overlay.js';
import { useReturnFocus } from '../conversations/focus-restore.js';

/**
 * The three small sheets behind Location, Contact and Event.
 *
 * Each is deliberately the smallest thing that produces a real message: a
 * position, a person, a title and a time. None of them is a screen, because
 * none of them is a task - they are one field's worth of decision reached from
 * a menu, and a full page for that would be heavier than the thing itself.
 */

function Sheet({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useReturnFocus();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <Overlay>
      <div
        className="fixed inset-0 z-500 flex items-end justify-center sm:items-center"
        onPointerDown={onClose}
      >
        <div className="absolute inset-0 bg-ink/[0.18] animate-fade-in" />

        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onPointerDown={(event) => event.stopPropagation()}
          className={cn(
            'animate-panel-in relative flex w-full max-w-sm flex-col',
            'max-h-[70vh] rounded-t-xl border border-line bg-surface shadow-lg',
            'pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:rounded-xl sm:pb-3',
          )}
        >
          <div className="shrink-0 px-4 pt-4 pb-2">
            <h2 className="text-h2 text-ink">{title}</h2>
            {description && (
              <p className="mt-1 text-caption text-text-secondary">{description}</p>
            )}
          </div>
          {children}
        </div>
      </div>
    </Overlay>
  );
}

const FIELD = cn(
  'focus-ring w-full rounded-lg border border-line bg-page',
  'px-3 py-2.5 text-body text-ink placeholder:text-text-tertiary',
);

const PRIMARY = cn(
  'focus-ring w-full rounded-full bg-brand-gradient px-5 py-2.5',
  'text-body font-medium text-white shadow-brand',
  'transition-transform duration-instant active:scale-[0.98]',
  'disabled:opacity-50 disabled:active:scale-100',
);

/**
 * Sharing where you are.
 *
 * The browser's own permission prompt is the only gate - there is no in-app
 * "may we?" first, because two prompts for one decision is worse than one, and
 * the browser's is the one that actually controls access.
 */
export function LocationSheet({
  onClose,
  onSend,
}: {
  onClose: () => void;
  onSend: (location: LocationRef) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [label, setLabel] = useState('');

  const share = () => {
    setBusy(true);
    setError(undefined);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        onSend({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          ...(label.trim() ? { label: label.trim() } : {}),
        });
      },
      (cause) => {
        setBusy(false);
        setError(
          cause.code === cause.PERMISSION_DENIED
            ? 'PINGO needs location access to share where you are.'
            : 'Your location could not be found.',
        );
      },
      // A fix good enough to point at a building, and no waiting past ten
      // seconds - a location that arrives after the conversation moved on is
      // not worth the spinner.
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  return (
    <Sheet
      title="Share location"
      description="Your current position, as a card they can open in a map."
      onClose={onClose}
    >
      <div className="space-y-2 px-4 pb-2">
        {error && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-caption text-danger">
            {error}
          </p>
        )}
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Name this place (optional)"
          aria-label="Place name"
          maxLength={80}
          className={FIELD}
        />
        <button type="button" onClick={share} disabled={busy} className={PRIMARY}>
          {busy ? 'Finding you…' : 'Share current location'}
        </button>
      </div>
    </Sheet>
  );
}

/**
 * Passing on somebody's details.
 *
 * People you already have conversations with, because that is who this app
 * knows about. The device's address book needs the Contact Picker API, which
 * exists on one browser on one platform - offering it as the primary path would
 * make the feature absent for most people, and offering both would be two
 * pickers for one idea.
 */
export function ContactSheet({
  onClose,
  onSend,
}: {
  onClose: () => void;
  onSend: (contact: { name: string; handle?: string; userId?: string }) => void;
}) {
  const { users, currentUser } = useChat();
  const [query, setQuery] = useState('');

  const people = users
    .filter((person) => person.id !== currentUser?.id)
    .filter((person) =>
      `${person.name} ${person.handle}`.toLowerCase().includes(query.trim().toLowerCase()),
    );

  return (
    <Sheet title="Share contact" onClose={onClose}>
      <div className="shrink-0 px-4 pb-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search people"
          aria-label="Search people"
          className={FIELD}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {people.length === 0 ? (
          <p className="px-2 py-6 text-center text-caption text-text-tertiary">
            Nobody to share.
          </p>
        ) : (
          people.map((person) => (
            <button
              key={person.id}
              type="button"
              onClick={() =>
                onSend({
                  name: person.name,
                  ...(person.handle ? { handle: person.handle } : {}),
                  userId: person.id,
                })
              }
              className={cn(
                'focus-ring flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left',
                'transition-colors duration-instant hover:bg-hover',
              )}
            >
              <Avatar name={person.name} id={person.id} src={person.avatarUrl} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-ink">{person.name}</span>
                <span className="block truncate text-caption text-text-secondary">
                  @{person.handle}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </Sheet>
  );
}

/** A title and a time, which is all an event has to be to be worth sending. */
export function EventSheet({
  onClose,
  onSend,
}: {
  onClose: () => void;
  onSend: (event: EventRef) => void;
}) {
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [where, setWhere] = useState('');

  const startsAt = when ? new Date(when).getTime() : Number.NaN;
  const ready = title.trim().length > 0 && Number.isFinite(startsAt);

  return (
    <Sheet
      title="Share event"
      description="They can add it to their calendar in one tap."
      onClose={onClose}
    >
      <div className="space-y-2 px-4 pb-2">
        <input
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="What is it?"
          aria-label="Event title"
          maxLength={120}
          className={FIELD}
        />
        <input
          type="datetime-local"
          value={when}
          onChange={(event) => setWhen(event.target.value)}
          aria-label="Starts at"
          className={FIELD}
        />
        <input
          value={where}
          onChange={(event) => setWhere(event.target.value)}
          placeholder="Where (optional)"
          aria-label="Event location"
          maxLength={120}
          className={FIELD}
        />
        <button
          type="button"
          disabled={!ready}
          onClick={() =>
            onSend({
              title: title.trim(),
              startsAt,
              ...(where.trim() ? { location: where.trim() } : {}),
            })
          }
          className={PRIMARY}
        >
          Send event
        </button>
      </div>
    </Sheet>
  );
}
