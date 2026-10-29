import { getSupabaseClient, type PingoSupabaseClient } from './client.js';

/**
 * One socket for everything outside the chat thread.
 *
 * ## Why a hub rather than a channel per feature
 *
 * Stories, posts, profiles, follows and the conversation list all want to know
 * when their table changes. Each opening its own Realtime channel would mean
 * five subscriptions, five join round trips and five things to tear down on
 * sign-out - and Realtime bills and rate-limits by channel, so the cost is real
 * rather than tidy-mindedness.
 *
 * More importantly, `postgres_changes` bindings must all be declared *before*
 * `subscribe()`. A channel that lets features register whenever they mount
 * cannot exist; the list of tables has to be fixed up front. So it is fixed
 * here, once, and features attach handlers to it whenever they like.
 *
 * ## Deliberately not the chat service's channel
 *
 * That one carries the contract `ChatService` promises - messages, receipts,
 * conversations. A story appearing is not a chat event and putting it on that
 * stream would mean `ChatEvent` growing a `story:changed` member, which is the
 * service boundary leaking. Two channels, each with one job.
 *
 * ## What it does not do
 *
 * It does not interpret rows. A handler gets the change and decides what to do
 * with it, which is almost always "reload the thing I own". That is coarse  - 
 * one story appearing re-reads the rail - but it is correct by construction,
 * and a wrong incremental update is much worse than a redundant fetch.
 */

/**
 * Tables this hub watches. Fixed, because bindings precede subscription.
 *
 * `conversations` and `conversation_members` are deliberately absent: the chat
 * service already holds a channel for them and already emits a fully-formed
 * `Conversation` when either changes. Watching them here as well would deliver
 * every change twice and give two different components the job of deciding what
 * a group rename means.
 */
const TABLES = ['stories', 'posts', 'profiles', 'follows'] as const;

/**
 * Notifications arrive by broadcast, not `postgres_changes`.
 *
 * Every chat message wrote one notification row per recipient - 8,400 a day,
 * 92% of them from one fourteen-person group - and each insert, read and
 * prune went through Realtime although nothing on this side displays a chat
 * notification. The table left the publication
 * (`20261117000000_notifications_by_broadcast.sql`); the activity kinds are
 * sent by the database to the owner's private `notifications:{userId}` topic.
 * Handlers see the same shape as before: an INSERT with the new row.
 */
type LiveTableName = (typeof TABLES)[number] | 'notifications';

export type LiveTable = LiveTableName;

export interface TableChange {
  table: LiveTable;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  /** The row after the change. Empty on DELETE. */
  row: Record<string, unknown>;
  /** The row before it. Only primary keys unless replica identity is full. */
  previous: Record<string, unknown>;
}

type Handler = (change: TableChange) => void;

class RealtimeHub {
  readonly #client: PingoSupabaseClient;
  #channel: ReturnType<PingoSupabaseClient['channel']> | undefined;
  /** The private `notifications:{userId}` topic - see `#openNotifications`. */
  #notifications: ReturnType<PingoSupabaseClient['channel']> | undefined;
  #notificationsOpening = false;
  #handlers = new Map<LiveTable, Set<Handler>>();

  constructor(client: PingoSupabaseClient = getSupabaseClient()) {
    this.#client = client;
  }

  /**
   * Attaches a handler and returns the detach.
   *
   * Opening the channel is lazy - nothing subscribes until something is
   * actually listening, so a signed-out visitor on the welcome screen never
   * opens a socket.
   */
  on(table: LiveTable, handler: Handler): () => void {
    const existing = this.#handlers.get(table) ?? new Set<Handler>();
    existing.add(handler);
    this.#handlers.set(table, existing);

    if (table === 'notifications') void this.#openNotifications();
    else this.#open();

    return () => {
      existing.delete(handler);
      /*
       * The channel stays open when the last handler goes.
       *
       * React unmounts and remounts constantly - StrictMode does it twice on
       * purpose - and closing the socket on every empty moment would mean
       * rejoining on every navigation, with a window in the middle where
       * changes are missed. It closes on sign-out, which is the only time it is
       * genuinely not wanted.
       */
    };
  }

  #open(): void {
    if (this.#channel) return;

    let channel = this.#client.channel('pingo:live');

    for (const table of TABLES) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload) => {
          this.#dispatch({
            table,
            eventType: payload.eventType as TableChange['eventType'],
            row: (payload.new ?? {}) as Record<string, unknown>,
            previous: (payload.old ?? {}) as Record<string, unknown>,
          });
        },
      );
    }

    this.#channel = channel.subscribe();
  }

  #dispatch(change: TableChange): void {
    for (const handler of this.#handlers.get(change.table) ?? []) {
      /*
       * One handler throwing must not stop the others. They belong to
       * unrelated features that happen to share a socket, and a story
       * failing to reload is not a reason for the profile to miss its
       * own change.
       */
      try {
        handler(change);
      } catch {
        // Swallowed on purpose - see above.
      }
    }
  }

  /**
   * The signed-in user's private notification topic.
   *
   * One channel for every listener: joining the same topic twice on one socket
   * makes Phoenix drop the first join, so the chat service's badge and the
   * Activity screen share this rather than each opening their own. Private,
   * like `call:{userId}`: RLS on `realtime.messages` lets only the owner read it.
   */
  async #openNotifications(): Promise<void> {
    if (this.#notifications || this.#notificationsOpening) return;
    this.#notificationsOpening = true;
    try {
      const { data } = await this.#client.auth.getSession();
      const me = data.session?.user.id;
      // Re-checked after the await: a sign-out may have closed the hub meanwhile.
      if (!me || this.#notifications || !this.#handlers.get('notifications')?.size) return;

      this.#notifications = this.#client
        .channel(`notifications:${me}`, {
          // `self: true` for the same reason as the call topic: the database
          // publishes through Realtime's own endpoint, and the default drops it.
          config: { private: true, broadcast: { self: true, ack: false } },
        })
        .on('broadcast', { event: 'notification' }, ({ payload }) => {
          this.#dispatch({
            table: 'notifications',
            eventType: 'INSERT',
            row: (payload ?? {}) as Record<string, unknown>,
            previous: {},
          });
        })
        .subscribe();
    } finally {
      this.#notificationsOpening = false;
    }
  }

  /** Called on sign-out. The next `on()` opens a fresh channel. */
  close(): void {
    if (this.#channel) void this.#client.removeChannel(this.#channel);
    this.#channel = undefined;
    if (this.#notifications) void this.#client.removeChannel(this.#notifications);
    this.#notifications = undefined;
    this.#handlers.clear();
  }
}

let hub: RealtimeHub | undefined;

export function getRealtimeHub(): RealtimeHub {
  hub ??= new RealtimeHub();
  return hub;
}
