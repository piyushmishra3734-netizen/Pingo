/**
 * What the Secure Backup screen shows, and what its buttons do.
 *
 * The screen renders this and nothing else decides anything. That split is
 * deliberate: "connected", "backing up", "token expired" and "network gone" are
 * states a user will actually meet, and they are worth testing without a
 * browser. A state machine in a component is one that gets verified by hand,
 * once, on the happy path.
 *
 * Nothing here reaches Drive directly — it drives a `GoogleDriveBackupTarget`,
 * which is the same object the verification suites exercise.
 */
import { openRecord, sealRecord } from '../../crypto/session.js';
import { STORE, localDelete, localGet, localSet } from '../../local/db.js';
import { DriveAuthError } from './auth.js';
import { DriveError } from './client.js';
import type { StoredPackage } from '../target.js';
import type { ArchiveProgress, GoogleDriveBackupTarget } from './drive-target.js';

const STATE_KEY = 'drive-backup';

export interface DriveBackupState {
  connected: boolean;
  lastBackupAt?: number;
  /** Sealed size on Drive, which is what the user's quota actually pays for. */
  bytes?: number;
  generation?: number;
  /**
   * Kept apart from `lastBackupAt` on purpose.
   *
   * "When did a backup last work" and "when did one last fail, and why" are
   * different questions, and a single timestamp answers neither well. Someone
   * reporting "backup is broken" can be asked one thing and get a date and a
   * reason, instead of a support conversation that starts from nothing.
   */
  lastSuccessAt?: number;
  lastFailure?: { reason: string; at: number };
}

export interface DriveStateStore {
  read(): Promise<DriveBackupState | undefined>;
  write(state: DriveBackupState): Promise<void>;
  clear(): Promise<void>;
}

export const sealedDriveStore: DriveStateStore = {
  async read() {
    return openRecord<DriveBackupState>(await localGet<unknown>(STORE.meta, STATE_KEY));
  },
  async write(state) {
    await localSet(STORE.meta, STATE_KEY, await sealRecord(state));
  },
  async clear() {
    await localDelete(STORE.meta, STATE_KEY);
  },
};

export type DrivePhase =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'backing-up'
  | 'restoring'
  | 'error';

export interface DriveView {
  phase: DrivePhase;
  connected: boolean;
  lastBackupAt?: number;
  bytes?: number;
  generation?: number;
  progress?: ArchiveProgress;
  /** Set in `error`. Written for a person, not a log. */
  message?: string;
  /**
   * True when the failure is fixed by reconnecting rather than retrying.
   *
   * The two look identical in a spinner and are completely different to the
   * user: one is "try again in a minute", the other is "Google needs you".
   */
  needsReconnect?: boolean;
  lastSuccessAt?: number;
  lastFailure?: { reason: string; at: number };
  /** Android only. Undefined on web, where nothing is scheduled. */
  nextScheduledAt?: number;
  /** True while a backup or restore holds the lock. */
  busy?: boolean;
}

/**
 * Turns a thrown thing into something worth showing.
 *
 * Every branch here exists because the alternative is a screen that says
 * "something went wrong" for four unrelated problems, three of which the user
 * could have fixed.
 */
function describe(cause: unknown): { message: string; needsReconnect: boolean } {
  if (cause instanceof DriveAuthError) {
    switch (cause.code) {
      case 'cancelled':
        return { message: 'Google Drive was not connected.', needsReconnect: true };
      case 'unconfigured':
        return { message: cause.message, needsReconnect: false };
      case 'expired':
        return { message: 'Google Drive access expired. Reconnect to continue.', needsReconnect: true };
      default:
        return { message: 'Google Drive access was refused.', needsReconnect: true };
    }
  }

  if (cause instanceof DriveError) {
    if (cause.code === 'auth') {
      return { message: 'Google Drive access expired. Reconnect to continue.', needsReconnect: true };
    }
    if (cause.code === 'not-found') {
      return { message: 'There is no backup in Google Drive yet.', needsReconnect: false };
    }
    return { message: cause.message, needsReconnect: false };
  }

  /*
   * A TypeError is not proof of being offline.
   *
   * `fetch` rejects with one when the network is gone — and so does any
   * ordinary bug in the code above it. Reporting both as "no connection" sent
   * a real investigation looking at CSP, CORS and service workers for an
   * exception that had nothing to do with the network: a direct fetch from the
   * same page reached Google and came back 401, while the backup kept claiming
   * to be offline.
   *
   * So offline is only claimed when the browser actually says so, and anything
   * else is reported as what it is, name included, because a message that
   * describes the wrong failure is worse than one that admits it is unexpected.
   */
  /*
   * `=== false` rather than falsy: where `onLine` is undefined the browser has
   * not said anything, and "no opinion" must not be read as "offline".
   */
  if (cause instanceof TypeError && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { message: 'No connection. Backup will work again once you are online.', needsReconnect: false };
  }

  if (cause instanceof Error) {
    return { message: `Backup failed — ${cause.name}: ${cause.message}`, needsReconnect: false };
  }

  return { message: `Backup failed — ${String(cause)}`, needsReconnect: false };
}

export class DriveBackupController {
  #view: DriveView = { phase: 'disconnected', connected: false };
  #listeners = new Set<(view: DriveView) => void>();

  constructor(
    private readonly target: GoogleDriveBackupTarget,
    private readonly store: DriveStateStore = sealedDriveStore,
  ) {}

  get view(): DriveView {
    return this.#view;
  }

  subscribe(listener: (view: DriveView) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #set(patch: Partial<DriveView>): void {
    this.#view = { ...this.#view, ...patch };
    for (const listener of this.#listeners) listener(this.#view);
  }

  /**
   * Read persisted state without touching the network.
   *
   * `nextScheduledAt` is only produced when the policy actually schedules
   * something. On the web it stays undefined, so the screen has nothing to
   * render rather than a date it would not honour.
   */
  async load(
    policy?: { triggers: readonly string[]; minimumIntervalMs: number },
    hasToken?: () => Promise<boolean>,
  ): Promise<DriveView> {
    const saved = await this.store.read();
    const schedules = policy?.triggers.includes('periodic') ?? false;

    /*
     * Connected means a usable token, not a remembered intention.
     *
     * Persisted state alone said "Connected" while the token had been lost to a
     * reload, so every button was offered and every one of them failed with
     * "access expired". Asking the auth layer keeps the screen honest: if there
     * is no token, the only thing offered is Reconnect.
     */
    const usable = hasToken ? await hasToken() : true;
    if (saved?.connected && !usable) {
      this.#set({
        phase: 'connected',
        connected: true,
        needsReconnect: true,
        message: 'Google Drive needs reconnecting on this device.',
        lastBackupAt: saved.lastBackupAt,
        bytes: saved.bytes,
        generation: saved.generation,
        lastSuccessAt: saved.lastSuccessAt,
        lastFailure: saved.lastFailure,
        busy: false,
      });
      return this.#view;
    }

    this.#set({
      phase: saved?.connected ? 'connected' : 'disconnected',
      connected: Boolean(saved?.connected),
      lastBackupAt: saved?.lastBackupAt,
      bytes: saved?.bytes,
      generation: saved?.generation,
      lastSuccessAt: saved?.lastSuccessAt,
      lastFailure: saved?.lastFailure,
      nextScheduledAt:
        schedules && saved?.connected
          ? (saved?.lastSuccessAt ?? Date.now()) + (policy?.minimumIntervalMs ?? 0)
          : undefined,
      message: undefined,
      needsReconnect: undefined,
      busy: false,
    });
    return this.#view;
  }

  async connect(authorize: () => Promise<unknown>): Promise<DriveView> {
    this.#set({ phase: 'connecting', message: undefined, needsReconnect: undefined });
    try {
      await authorize();
      const saved = (await this.store.read()) ?? { connected: false };
      await this.store.write({ ...saved, connected: true });
      this.#set({ phase: 'connected', connected: true });
    } catch (cause) {
      const { message, needsReconnect } = describe(cause);
      this.#set({ phase: 'error', message, needsReconnect });
    }
    return this.#view;
  }

  async disconnect(): Promise<DriveView> {
    try {
      await this.target.remove();
    } catch {
      /*
       * Deliberately swallowed. If Drive cannot be reached, the user still
       * asked to disconnect, and a device that keeps claiming to be connected
       * is the worse of the two outcomes. The blob left behind is ciphertext.
       */
    }
    await this.target.disconnect();
    await this.store.clear();
    this.#set({
      phase: 'disconnected',
      connected: false,
      lastBackupAt: undefined,
      bytes: undefined,
      generation: undefined,
      progress: undefined,
      message: undefined,
      needsReconnect: undefined,
    });
    return this.#view;
  }

  /**
   * One at a time.
   *
   * Two backups running together would race for the same generation number and
   * could interleave their chunk uploads under names the other is about to
   * commit — a way to corrupt the very thing being protected. The lock is held
   * by the controller rather than the button, because a disabled button is a
   * suggestion and a second tab, a background trigger and a manual press are
   * three ways to arrive here at once.
   */
  #inFlight: Promise<DriveView> | undefined;

  get busy(): boolean {
    return this.#inFlight !== undefined;
  }

  async #exclusive(run: () => Promise<DriveView>): Promise<DriveView> {
    if (this.#inFlight) return this.#inFlight;
    const work = run().finally(() => {
      this.#inFlight = undefined;
      this.#set({ busy: false });
    });
    this.#inFlight = work;
    this.#set({ busy: true });
    return work;
  }

  async #recordFailure(cause: unknown): Promise<void> {
    const { message, needsReconnect } = describe(cause);
    const saved = await this.store.read();
    const failure = { reason: message, at: Date.now() };
    if (saved) await this.store.write({ ...saved, lastFailure: failure });
    this.#set({ phase: 'error', message, needsReconnect, progress: undefined, lastFailure: failure });
  }

  async backupNow(plaintext: Uint8Array, recoveryPublicKey: string): Promise<DriveView> {
    return this.#exclusive(async () => {
      this.#set({ phase: 'backing-up', message: undefined, needsReconnect: undefined, progress: undefined });
      try {
        const result = await this.target.backupArchive(plaintext, recoveryPublicKey, (progress) =>
          this.#set({ progress }),
        );
        const saved = await this.store.read();
        const now = Date.now();
        const state: DriveBackupState = {
          ...(saved ?? {}),
          connected: true,
          lastBackupAt: now,
          lastSuccessAt: now,
          bytes: result.bytes,
          generation: result.generation,
        };
        await this.store.write(state);
        this.#set({
          phase: 'connected',
          connected: true,
          lastBackupAt: now,
          lastSuccessAt: now,
          bytes: state.bytes,
          generation: state.generation,
          progress: undefined,
        });
      } catch (cause) {
        await this.#recordFailure(cause);
      }
      return this.#view;
    });
  }

  /**
   * Back up by building and uploading together.
   *
   * This is what the button calls. `backupNow` above takes a finished archive
   * and exists for callers that already have one; using it here would mean
   * holding every message in memory to hand it over, which is the thing the
   * builder was written to avoid.
   */
  async backupStreaming(
    recoveryPublicKey: string,
    /**
     * The sealed recovery package, mirrored to Drive alongside the archive.
     *
     * Without it Drive holds an archive nobody can open. The server keeps a
     * copy but deliberately will not hand it back — that is the request the
     * recovery request flow exists to slow down — so a device that has never
     * seen this account has no other way to obtain the key. Measured on the
     * first real backup: chunks, manifest and HEAD were all in appDataFolder
     * and `pingo.recovery.json` was not.
     *
     * It is the same bytes the server holds, sealed under the 12-word code.
     * Drive can no more open it than we can.
     */
    storedPackage?: StoredPackage,
  ): Promise<DriveView> {
    return this.#exclusive(async () => {
      this.#set({ phase: 'backing-up', message: undefined, needsReconnect: undefined, progress: undefined });
      try {
        if (storedPackage) await this.target.put(storedPackage);
        const { buildArchive, archiveLines } = await import('../archive-builder.js');

        const result = await this.target.backupArchiveStreaming(
          recoveryPublicKey,
          (publicKey, generation, onChunk) =>
            buildArchive(publicKey, generation, onChunk, () => archiveLines()),
          (progress) => this.#set({ progress }),
        );

        const saved = await this.store.read();
        const now = Date.now();
        await this.store.write({
          ...(saved ?? {}),
          connected: true,
          lastBackupAt: now,
          lastSuccessAt: now,
          bytes: result.bytes,
          generation: result.generation,
        });

        this.#set({
          phase: 'connected',
          connected: true,
          lastBackupAt: now,
          lastSuccessAt: now,
          bytes: result.bytes,
          generation: result.generation,
          progress: undefined,
          /*
           * A backup that could not read part of the database is not a clean
           * success, and saying so is the whole reason the count exists.
           */
          message:
            result.skipped > 0
              ? `Backed up ${result.records} records. ${result.skipped} could not be read on this device and were not included.`
              : undefined,
        });
      } catch (cause) {
        await this.#recordFailure(cause);
      }
      return this.#view;
    });
  }

  async restore(
    recoveryPrivateKey: CryptoKey,
    apply: (plaintext: Uint8Array) => Promise<void>,
  ): Promise<DriveView> {
    return this.#exclusive(async () => {
      this.#set({ phase: 'restoring', message: undefined, needsReconnect: undefined, progress: undefined });
      try {
        const saved = await this.store.read();
        const { plaintext, generation } = await this.target.restoreArchive(
          recoveryPrivateKey,
          saved?.generation ?? 0,
          (progress) => this.#set({ progress }),
        );

        /*
         * Applied before the generation is recorded. Writing the generation
         * first would mark a restore as done that then failed to land, and the
         * next attempt would be refused as a rollback.
         */
        await apply(plaintext);
        await this.store.write({ ...(saved ?? { connected: true }), connected: true, generation });
        this.#set({ phase: 'connected', connected: true, generation, progress: undefined });
      } catch (cause) {
        await this.#recordFailure(cause);
      }
      return this.#view;
    });
  }
}
