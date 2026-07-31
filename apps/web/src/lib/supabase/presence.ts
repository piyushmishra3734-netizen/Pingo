import type { PresenceState, UserId } from '@pingo/core';

import type { PingoSupabaseClient } from './client.js';

/**
 * Who is online, and who is typing - both over Realtime, neither in the database.
 *
 * ## Why nothing is stored
 *
 * Presence and typing are true for seconds and wrong forever after. A row saying
 * "online" outlives the tab that wrote it: close the laptop lid and the database
 * still insists you are there, because the write that would correct it never
 * happens. Realtime Presence is tied to the *socket* instead, so hanging up the
 * connection is what marks you away - including the cases nobody writes code
 * for, like a phone losing signal.
 *
 * Typing is the same argument at a shorter timescale. Persisting a flag that is
 * meaningless three seconds later would mean a write, a delete, and a stuck
 * indicator whenever the delete is the message that goes missing.
 *
 * ## Two channels, not one
 *
 * Presence is global - one channel, everyone. Typing is per conversation, and
 * broadcasting every keystroke in the app to every user so each client can
 * discard 99% of it is the kind of thing that works fine until it does not.
 */

/** How long a typing signal stands before it is assumed stale. */
const TYPING_TIMEOUT_MS = 4_000;

/** Re-broadcast no faster than this while someone keeps typing. */
const TYPING_THROTTLE_MS = 2_000;

export interface PresenceHandlers {
  onPresence: (userId: UserId, state: PresenceState) => void;
  onTyping: (conversationId: string, userIds: UserId[]) => void;
}

export class PresenceHub {
  readonly #client: PingoSupabaseClient;
  readonly #handlers: PresenceHandlers;

  #presence: ReturnType<PingoSupabaseClient['channel']> | undefined;
  #typing = new Map<string, ReturnType<PingoSupabaseClient['channel']>>();

  /** Per conversation: who is typing, and when their signal expires. */
  #typists = new Map<string, Map<UserId, number>>();
  #sweeper: ReturnType<typeof setInterval> | undefined;
  #lastSent = new Map<string, number>();
  #userId: UserId | undefined;

  constructor(client: PingoSupabaseClient, handlers: PresenceHandlers) {
    this.#client = client;
    this.#handlers = handlers;
  }

  // -- presence -------------------------------------------------------------

  start(userId: UserId): void {
    if (this.#presence) return;
    this.#userId = userId;

    const channel = this.#client.channel('pingo:presence', {
      config: { presence: { key: userId } },
    });

    /*
     * `sync` rather than join/leave alone.
     *
     * Join and leave are deltas, and a client that reconnects after a dropped
     * socket has missed however many happened while it was away. `sync` carries
     * the whole current state, so a reconnect corrects itself instead of
     * accumulating ghosts.
     */
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      const online = new Set(Object.keys(state));
      for (const id of online) this.#handlers.onPresence(id, 'online');
      this.#lastOnline = online;
    });

    channel.on('presence', { event: 'leave' }, ({ key }) => {
      this.#handlers.onPresence(key as UserId, 'offline');
    });

    void channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      // Tracked only once subscribed; tracking earlier is dropped silently.
      void channel.track({ at: Date.now() });
    });

    this.#presence = channel;
    this.#startSweeper();
  }

  #lastOnline = new Set<UserId>();

  // -- typing ---------------------------------------------------------------

  /** Subscribes to typing for one conversation. Safe to call repeatedly. */
  watchTyping(conversationId: string): void {
    if (this.#typing.has(conversationId)) return;

    const channel = this.#client
      .channel(`typing:${conversationId}`, {
        /*
         * `self: true` is load-bearing, and the reason typing did not work.
         *
         * A keystroke usually arrives before the channel has finished joining,
         * so `send()` falls back to Realtime's HTTP broadcast endpoint - and
         * with `self` at its default the client discards what arrives that way.
         * The call signalling channel hit exactly this; the fix is the same.
         * Echoing our own typing back is harmless, because the handler below
         * ignores anything from this user.
         */
        config: { broadcast: { self: true } },
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const { userId, typing } = payload as { userId: UserId; typing: boolean };
        if (userId === this.#userId) return;

        const map = this.#typists.get(conversationId) ?? new Map<UserId, number>();
        if (typing) map.set(userId, Date.now() + TYPING_TIMEOUT_MS);
        else map.delete(userId);
        this.#typists.set(conversationId, map);
        this.#publish(conversationId);
      });

    void channel.subscribe();
    this.#typing.set(conversationId, channel);
  }

  /**
   * Announces that this user is typing.
   *
   * Throttled, because a keypress handler fires per character and a socket
   * message per character is a lot of traffic to say one thing. Stopping is
   * always sent immediately - a late "still typing" is harmless, a late "stopped"
   * leaves the indicator up.
   */
  async setTyping(conversationId: string, typing: boolean): Promise<void> {
    this.watchTyping(conversationId);
    const channel = this.#typing.get(conversationId);
    if (!channel || !this.#userId) return;

    const now = Date.now();
    if (typing && now - (this.#lastSent.get(conversationId) ?? 0) < TYPING_THROTTLE_MS) return;
    this.#lastSent.set(conversationId, typing ? now : 0);

    await channel.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: this.#userId, typing },
    });
  }

  /**
   * Expires stale typists.
   *
   * A client that closes mid-sentence never sends the stopping signal, so the
   * indicator would stay up forever. Every signal carries an expiry and this
   * sweeps past them - the timeout is the correctness mechanism, not a fallback.
   */
  #startSweeper(): void {
    this.#sweeper ??= setInterval(() => {
      const now = Date.now();
      for (const [conversationId, map] of this.#typists) {
        let changed = false;
        for (const [userId, expires] of map) {
          if (expires <= now) {
            map.delete(userId);
            changed = true;
          }
        }
        if (changed) this.#publish(conversationId);
      }
    }, 1_000);
  }

  #publish(conversationId: string): void {
    this.#handlers.onTyping(conversationId, [
      ...(this.#typists.get(conversationId)?.keys() ?? []),
    ]);
  }

  stop(): void {
    if (this.#presence) void this.#client.removeChannel(this.#presence);
    this.#presence = undefined;

    for (const channel of this.#typing.values()) void this.#client.removeChannel(channel);
    this.#typing.clear();
    this.#typists.clear();
    this.#lastOnline.clear();

    if (this.#sweeper) clearInterval(this.#sweeper);
    this.#sweeper = undefined;
    this.#userId = undefined;
  }
}
