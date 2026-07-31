/**
 * Presentation helpers shared by web and (later) native.
 *
 * These live in core rather than in the UI package because the formatting rules
 * are product decisions, not styling decisions - "yesterday" instead of a date,
 * relative times that stop being relative after a week, and so on.
 */

import type { Conversation, Message, User, UserId } from './types.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Whole calendar days between two instants, ignoring clock time. */
function calendarDaysAgo(ms: number, now = Date.now()): number {
  return Math.round((startOfDay(now) - startOfDay(ms)) / DAY);
}

/** "11:30 AM" - the timestamp shown beside a message. */
export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * When something *happened to* a message - an edit, a deletion.
 *
 * Not `formatTime`, because these are the one timestamp in a thread that can
 * disagree with its position. A message sits under the day divider it was sent
 * on, but it can be edited a week later, and "Edited 1:24 AM" beneath
 * yesterday's divider reads as a message out of sequence rather than as an
 * event with its own date. Same day as the reader's today, the clock is enough;
 * beyond that the date has to come with it.
 */
export function formatEventTime(ms: number, now = Date.now()): string {
  const then = new Date(ms);
  const today = new Date(now);

  const sameDay =
    then.getFullYear() === today.getFullYear() &&
    then.getMonth() === today.getMonth() &&
    then.getDate() === today.getDate();

  if (sameDay) return formatTime(ms);

  return then.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Timestamps in the conversation list, per the board: today shows a clock time,
 * yesterday says so in words, this week shows a weekday, older shows a date.
 * Words beat numbers when a human can read them at a glance.
 */
export function formatConversationTimestamp(ms: number, now = Date.now()): string {
  const days = calendarDaysAgo(ms, now);
  if (days === 0) return formatTime(ms);
  if (days === 1) return 'Yesterday';
  if (days < 7) return new Date(ms).toLocaleDateString(undefined, { weekday: 'short' });
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** The centred divider inside a thread: "Today", "Yesterday", or a full date. */
export function formatDayDivider(ms: number, now = Date.now()): string {
  const days = calendarDaysAgo(ms, now);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return new Date(ms).toLocaleDateString(undefined, { weekday: 'long' });
  return new Date(ms).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: calendarDaysAgo(ms, now) > 365 ? 'numeric' : undefined,
  });
}

/** "0:12" / "1:24:00" - voice notes and call durations. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "2.4 MB". Decimal units, because that is what users' file managers show. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Presence line under a name in the chat header. */
export function formatPresence(user: User, now = Date.now()): string {
  if (user.presence.state === 'online') return 'online';
  if (user.presence.state === 'away') return 'away';

  const elapsed = now - user.presence.lastSeenAt;
  if (elapsed < MINUTE) return 'last seen just now';
  if (elapsed < HOUR) return `last seen ${Math.floor(elapsed / MINUTE)}m ago`;
  if (calendarDaysAgo(user.presence.lastSeenAt, now) === 0) {
    return `last seen at ${formatTime(user.presence.lastSeenAt)}`;
  }
  if (calendarDaysAgo(user.presence.lastSeenAt, now) === 1) {
    return `last seen yesterday at ${formatTime(user.presence.lastSeenAt)}`;
  }
  return `last seen ${formatConversationTimestamp(user.presence.lastSeenAt, now)}`;
}

/**
 * The one-line preview under a conversation title.
 *
 * Attachment-only messages get a description rather than blank space, and group
 * messages are prefixed with the sender - both visible on the branding board.
 */
export function messagePreview(
  message: Message | undefined,
  options: { conversation: Conversation; currentUserId: UserId; users: User[] },
): string {
  if (!message) return 'No messages yet';

  const { conversation, currentUserId, users } = options;

  /*
   * A deleted message has an empty body, so without this it fell through to the
   * generic "Message" - the list saying nothing about the one thing that just
   * happened to the thread.
   */
  if (message.deleted) {
    return message.authorId === currentUserId
      ? 'You deleted this message'
      : 'This message was deleted';
  }

  let text = message.body.trim();
  // Attachment kinds carry no body, so each says what it is.
  if (!text && message.photo) text = 'Photo';
  if (!text && message.location) text = message.location.label ?? 'Location';
  if (!text && message.contact) text = message.contact.name;
  if (!text && message.event) text = message.event.title;
  if (!text && message.call) {
    const kind = message.call.callKind === 'video' ? 'Video' : 'Voice';
    text =
      message.call.outcome === 'answered'
        ? `${kind} call`
        : `Missed ${kind.toLowerCase()} call`;
  }
  if (!text) {
    const attachment = message.attachments[0];
    switch (attachment?.kind) {
      case 'audio':
        text = 'Voice message';
        break;
      case 'image':
        text = 'Photo';
        break;
      case 'video':
        text = 'Video';
        break;
      case 'file':
        text = `Shared ${attachment.fileName}`;
        break;
      default:
        text = 'Message';
    }
  }

  if (message.system) return text;

  // Only group and community threads need attribution - in a direct chat the
  // other party is already the row's title.
  if (conversation.kind !== 'direct') {
    const author =
      message.authorId === currentUserId
        ? 'You'
        : (users.find((u) => u.id === message.authorId)?.name.split(' ')[0] ??
          'Someone');
    return `${author}: ${text}`;
  }

  return text;
}

/** "Anaya is typing" / "Anaya and Alex are typing" / "3 people are typing". */
export function formatTypingLabel(userIds: UserId[], users: User[]): string {
  const names = userIds
    .map((id) => users.find((u) => u.id === id)?.name.split(' ')[0])
    .filter((n): n is string => Boolean(n));

  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} is typing`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
  return `${names.length} people are typing`;
}

/**
 * Groups a thread into runs that should render as one visual cluster: same
 * author, within five minutes, no day boundary crossed. Clustering is what stops
 * a busy conversation from looking like a wall of separate cards.
 */
export function groupMessages(messages: Message[]): Message[][] {
  const CLUSTER_WINDOW = 5 * MINUTE;
  const groups: Message[][] = [];

  for (const message of messages) {
    const currentGroup = groups[groups.length - 1];
    const previous = currentGroup?.[currentGroup.length - 1];

    const continuesRun =
      previous !== undefined &&
      currentGroup !== undefined &&
      previous.authorId === message.authorId &&
      previous.system === message.system &&
      message.createdAt - previous.createdAt < CLUSTER_WINDOW &&
      calendarDaysAgo(previous.createdAt) === calendarDaysAgo(message.createdAt);

    if (continuesRun) currentGroup.push(message);
    else groups.push([message]);
  }

  return groups;
}
