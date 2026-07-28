import { getSupabaseClient, type PingoSupabaseClient } from './client.js';

/**
 * One socket for everything outside the chat thread.
 *
 * ## Why a hub rather than a channel per feature
 *
 * Stories, posts, profiles, follows and the conversation list all want to know
 * when their table changes. Each opening its own Realtime channel would mean
 * five subscriptions, five join round trips and five things to tear down on
 * sign-out — and Realtime bills and rate-limits by channel, so the cost is real
 * rather than tidy-mindedness.
 *
 * More importantly, `postgres_changes` bindings must all be declared *before*
 * `subscribe()`. A channel that lets features register whenever they mount
 * cannot exist; the list of tables has to be fixed up front. So it is fixed
 * here, once, and features attach handlers to it whenever they like.
 *
 * ## Deliberately not the chat service's channel
 *
 * That one carries the contract `ChatService` promises — messages, receipts,
 * conversations. A story appearing is not a chat event and putting it on that
 * stream would mean `ChatEvent` growing a `story:changed` member, which is the
 * service boundary leaking. Two channels, each with one job.
 *
 * ## What it does not do
 *
 * It does not interpret rows. A handler gets the change and decides what to do
 * with it, which is almost always "reload the thing I own". That is coarse —
 * one story appearing re-reads the rail — but it is correct by construction,
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
const TABLES = ['stories', 'posts', 'profiles', 'follows', 'notifications'] as const;

export type LiveTable = (typeof TABLES)[number];

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
  #handlers = new Map<LiveTable, Set<Handler>>();

  constructor(client: PingoSupabaseClient = getSupabaseClient()) {
    this.#client = client;
  }

  /**
   * Attaches a handler and returns the detach.
   *
   * Opening the channel is lazy — nothing subscribes until something is
   * actually listening, so a signed-out visitor on the welcome screen never
   * opens a socket.
   */
  on(table: LiveTable, handler: Handler): () => void {
    const existing = this.#handlers.get(table) ?? new Set<Handler>();
    existing.add(handler);
    this.#handlers.set(table, existing);

    this.#open();

    return () => {
      existing.delete(handler);
      /*
       * The channel stays open when the last handler goes.
       *
       * React unmounts and remounts constantly — StrictMode does it twice on
       * purpose — and closing the socket on every empty moment would mean
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
          const change: TableChange = {
            table,
            eventType: payload.eventType as TableChange['eventType'],
            row: (payload.new ?? {}) as Record<string, unknown>,
            previous: (payload.old ?? {}) as Record<string, unknown>,
          };
          for (const handler of this.#handlers.get(table) ?? []) {
            /*
             * One handler throwing must not stop the others. They belong to
             * unrelated features that happen to share a socket, and a story
             * failing to reload is not a reason for the profile to miss its
             * own change.
             */
            try {
              handler(change);
            } catch {
              // Swallowed on purpose — see above.
            }
          }
        },
      );
    }

    this.#channel = channel.subscribe();
  }

  /** Called on sign-out. The next `on()` opens a fresh channel. */
  close(): void {
    if (this.#channel) void this.#client.removeChannel(this.#channel);
    this.#channel = undefined;
    this.#handlers.clear();
  }
}

let hub: RealtimeHub | undefined;

export function getRealtimeHub(): RealtimeHub {
  hub ??= new RealtimeHub();
  return hub;
}
