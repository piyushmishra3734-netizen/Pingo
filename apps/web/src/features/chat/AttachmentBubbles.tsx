import {
  formatDuration,
  formatEventTime,
  type ContactRef,
  type EventRef,
  type CallLogRef,
  type LocationRef,
} from '@pingo/core';
import { Avatar, ChevronRightIcon, PhoneIcon, VideoIcon, cn } from '@pingo/ui';
import { Link } from 'react-router-dom';

/**
 * Cards for the three attachment kinds that carry no file.
 *
 * All three are the same object: a title, a supporting line, and somewhere to
 * go. Keeping them in one file makes that obvious, and makes it obvious when
 * one of them starts drifting away from the pattern for no reason.
 *
 * ## Why none of them embeds a map, an address book or a calendar
 *
 * A static map needs a keyed tile service, a reverse-geocoded address needs a
 * geocoder, and a real calendar entry needs the device's. Each is a dependency
 * with its own key, cost and privacy story - sending coordinates to a third
 * party to draw a thumbnail is a decision, not a detail. So each card carries
 * the fact and hands off to whatever the reader already uses: their maps app,
 * their chat, their calendar.
 */

function Card({
  onOpen,
  mine,
  children,
}: {
  onOpen?: string;
  mine: boolean;
  children: React.ReactNode;
}) {
  const className = cn(
    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left',
    'transition-opacity duration-instant hover:opacity-90',
    mine ? 'bg-brand-glass text-white' : 'glass-water text-ink',
  );

  if (!onOpen) return <div className={className}>{children}</div>;

  return (
    <a
      href={onOpen}
      target="_blank"
      rel="noopener noreferrer"
      // The bubble's own tap opens the reaction bar; this one has a job.
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      className={cn(className, 'focus-ring')}
    >
      {children}
    </a>
  );
}

function Icon({ mine, children }: { mine: boolean; children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-full text-[1.1rem]',
        mine ? 'bg-white/20' : 'bg-hover',
      )}
    >
      {children}
    </span>
  );
}

export function LocationBubble({ location, mine }: { location: LocationRef; mine: boolean }) {
  const { lat, lng, label } = location;
  // A plain `geo:` URI is handled natively on phones and by nothing on desktop,
  // so this uses the query form every maps site understands.
  const href = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

  return (
    <Card onOpen={href} mine={mine}>
      <Icon mine={mine}>📍</Icon>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body">{label ?? 'Shared location'}</span>
        <span className={cn('block truncate text-caption', mine ? 'text-white/70' : 'text-text-secondary')}>
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </span>
      </span>
      <ChevronRightIcon size={16} className={mine ? 'text-white/60' : 'text-text-tertiary'} />
    </Card>
  );
}

export function ContactBubble({ contact, mine }: { contact: ContactRef; mine: boolean }) {
  const body = (
    <>
      <Avatar name={contact.name} id={contact.userId ?? contact.name} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body">{contact.name}</span>
        {contact.handle && (
          <span
            className={cn(
              'block truncate text-caption',
              mine ? 'text-white/70' : 'text-text-secondary',
            )}
          >
            @{contact.handle}
          </span>
        )}
      </span>
      <ChevronRightIcon size={16} className={mine ? 'text-white/60' : 'text-text-tertiary'} />
    </>
  );

  /*
   * A shared PINGO user opens their chat, which is an in-app route and cannot
   * be an external link. Someone with no account is a name on a card and
   * nothing to open - the arrow is still there, but it goes nowhere, so it is
   * dropped rather than left as a promise.
   */
  if (!contact.userId) {
    return (
      <div
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2.5',
          mine ? 'bg-brand-glass text-white' : 'glass-water text-ink',
        )}
      >
        <Avatar name={contact.name} id={contact.name} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body">{contact.name}</span>
          {contact.handle && (
            <span
              className={cn(
                'block truncate text-caption',
                mine ? 'text-white/70' : 'text-text-secondary',
              )}
            >
              @{contact.handle}
            </span>
          )}
        </span>
      </div>
    );
  }

  return (
    <Link
      to={`/profile/${contact.userId}`}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      className={cn(
        'focus-ring flex w-full items-center gap-3 rounded-lg px-3 py-2.5',
        'transition-opacity duration-instant hover:opacity-90',
        mine ? 'bg-brand-glass text-white' : 'glass-water text-ink',
      )}
    >
      {body}
    </Link>
  );
}

export function EventBubble({ event, mine }: { event: EventRef; mine: boolean }) {
  /*
   * A Google Calendar template link rather than a downloaded `.ics`.
   *
   * An `.ics` is the portable answer and the worse one on a phone, where a
   * downloaded file often lands in a folder rather than in a calendar. This
   * opens somewhere the event can be saved in one tap, and the card still shows
   * everything for anyone who would rather type it in themselves.
   */
  const stamp = (ms: number) =>
    new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, '');
  const ends = event.startsAt + 60 * 60 * 1000;

  const href =
    'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    `&text=${encodeURIComponent(event.title)}` +
    `&dates=${stamp(event.startsAt)}/${stamp(ends)}` +
    (event.location ? `&location=${encodeURIComponent(event.location)}` : '');

  return (
    <Card onOpen={href} mine={mine}>
      <Icon mine={mine}>📅</Icon>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body">{event.title}</span>
        <span
          className={cn(
            'block truncate text-caption',
            mine ? 'text-white/70' : 'text-text-secondary',
          )}
        >
          {formatEventTime(event.startsAt)}
          {event.location ? ` · ${event.location}` : ''}
        </span>
      </span>
      <ChevronRightIcon size={16} className={mine ? 'text-white/60' : 'text-text-tertiary'} />
    </Card>
  );
}

/**
 * A finished call, in the thread where it happened.
 *
 * Reads as a record rather than as an action: it says what occurred and when,
 * and does not offer to call back. The header already has call buttons two
 * inches away, and a log entry that redials on a stray tap is the one thing a
 * call log must never do.
 *
 * The arrow points the way the call went, so direction is legible without
 * reading - which is what makes a column of these scannable.
 */
export function CallBubble({
  call,
  mine,
  outgoing,
}: {
  call: CallLogRef;
  mine: boolean;
  outgoing: boolean;
}) {
  const missed = call.outcome !== 'answered';

  const label =
    call.outcome === 'answered'
      ? // Labelled, not bare. A lone "2:34" under a call reads as a timestamp
        // at a glance, which is the one thing it is not.
        `Duration ${formatDuration(call.durationSeconds)}`
      : call.outcome === 'declined'
        ? 'Declined'
        : call.outcome === 'cancelled'
          ? 'Cancelled'
          : call.outcome === 'unreachable'
            ? 'Not reachable'
            : outgoing
              ? 'No answer'
              : 'Missed';

  return (
    <div
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5',
        mine ? 'bg-brand-glass text-white' : 'glass-water text-ink',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-full',
          mine ? 'bg-white/20' : missed ? 'bg-danger-soft text-danger' : 'bg-hover text-brand',
        )}
      >
        {call.callKind === 'video' ? <VideoIcon size={17} /> : <PhoneIcon size={17} />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-body">
          {outgoing ? 'Outgoing' : 'Incoming'} {call.callKind} call
        </span>
        <span
          className={cn(
            'block truncate text-caption',
            mine ? 'text-white/70' : missed ? 'text-danger' : 'text-text-secondary',
          )}
        >
          {label}
        </span>
      </span>
    </div>
  );
}
