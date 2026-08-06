/**
 * The pipeline's ports, wired to the real app.
 *
 * `pipeline.ts` is written against interfaces so its failures — a lying server,
 * a dropped upload, a short proof — can be produced on demand. This is the file
 * where those interfaces meet Supabase, IndexedDB and Drive, and it is
 * deliberately thin: every decision worth arguing about lives in the module it
 * belongs to, and what is left here is queries.
 *
 * ## Counting is not fetching
 *
 * Every count below is a `head` request with `count: 'exact'`, which returns a
 * count and no rows. Preflight and the completeness proof both run over an
 * entire account, so a count that transferred rows would download the account
 * twice to report on it once.
 */
import { openRecord, openRow, sealRecord, writeMessageRows } from '../crypto/session.js';
import { toMessage } from '../supabase/chat-service.js';
import type { MessageRow } from '../supabase/types.js';
import {
  STORE,
  localCount,
  localDelete,
  localGet,
  localSet,
  messageRowRange,
} from '../local/db.js';
import { getSupabaseClient } from '../supabase/client.js';
import type { BackfillCursor, BackfillRow, BackfillSink, BackfillSource, CursorStore } from './backfill.js';
import type { CursorReader, LocalCounts, ProofSource } from './completeness.js';
import type { LocalSample, PreflightSource } from './preflight.js';

type Client = ReturnType<typeof getSupabaseClient>;

const CURSOR_PREFIX = 'backfill:';

/**
 * Conversations this account can read.
 *
 * From `conversation_members` rather than `conversations`, because membership
 * is what RLS grants on and therefore what "everything this user may read"
 * actually means. Asking the conversations table directly would return what
 * exists, not what is permitted.
 */
async function conversationIds(client: Client, userId: string): Promise<string[]> {
  const { data, error } = await client
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', userId);

  if (error || !data) return [];
  return [...new Set(data.map((row) => row.conversation_id as string))];
}

/**
 * Server-side counts for the "Ready to Back Up" summary.
 *
 * Each figure is one aggregate query for the whole account. Failures are left
 * to `runPreflight`, which degrades the figure rather than the summary.
 */
export function livePreflightSource(client: Client, userId: string): PreflightSource {
  const ids = conversationIds(client, userId);

  const count = async (apply?: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => {
    const conversations = await ids;
    if (conversations.length === 0) return 0;
    const query = base(conversations);
    const { count: total, error } = await (apply ? apply(query) : query);
    if (error) throw error;
    return total ?? 0;
  };

  const base = (conversations: string[]) =>
    client
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .in('conversation_id', conversations);

  return {
    async countConversations() {
      return (await ids).length;
    },
    countMessages: () => count(),
    countPhotos: () => count((q) => q.in('kind', ['photo', 'snap'])),
    countVideos: () => count((q) => q.eq('kind', 'document').like('file_mime', 'video/%')),
    countDocuments: () => count((q) => q.eq('kind', 'document').not('file_mime', 'like', 'video/%')),
    countVoiceNotes: () => count((q) => q.eq('kind', 'voice')),
    /*
     * Media size, when the project will answer for it.
     *
     * Measured against production: this Supabase project has aggregates turned
     * off, and `file_size.sum()` comes back `PGRST123 — Use of aggregate
     * functions is not allowed`. That is a permanent property of the
     * deployment, not a transient failure, so letting it throw would mark every
     * preflight for every user `partial` and print "Could not measure: media
     * size" under a summary that is otherwise complete.
     *
     * A warning that is always on is a warning nobody reads, and the line it
     * would train people to ignore is the one that matters: a failed *message*
     * count. So an unavailable sum returns zero and stays silent — the figure
     * is contextual, media is not in the v1 archive at all, and
     * `formatPreflight` omits the row entirely when it is zero.
     */
    async mediaBytes() {
      const conversations = await ids;
      if (conversations.length === 0) return 0;
      try {
        const { data, error } = await client
          .from('messages')
          .select('file_size.sum()')
          .in('conversation_id', conversations);
        if (error) return 0;
        const row = (data as Array<{ sum?: number | null }> | null)?.[0];
        return row?.sum ?? 0;
      } catch {
        return 0;
      }
    },
  };
}

/**
 * Paging a conversation backwards, oldest-first.
 *
 * `before` is a message id, and the ordering key is `created_at`, so the id is
 * resolved to its timestamp first. Ordering by id would be ordering by a uuid,
 * which is ordering by nothing.
 */
/**
 * Strictly older than one exact message, ties included.
 *
 * A bare `created_at < X` is wrong at a page boundary. Two messages can share a
 * timestamp, and if the boundary falls between them the filter excludes both —
 * the one already fetched and the one never fetched. `countOlderThan` uses the
 * same predicate, so the count agrees with the omission, the walk terminates,
 * and the cursor says complete while history is missing.
 *
 * The completeness proof catches it, because it compares the local store
 * against an unfiltered server count. But it catches it as a permanent
 * shortfall: every retry would resume from the same cursor and skip the same
 * rows, so the account could never be backed up at all.
 *
 * Keyset pagination instead — order by `(created_at, id)` and compare on the
 * pair. Measured on production data: one thousand consecutive messages had one
 * thousand distinct microsecond timestamps, so this is rare rather than
 * theoretical, and unrecoverable when it happens.
 */
function olderThan(createdAt: string, id: string): string {
  return `created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`;
}

export function liveBackfillSource(client: Client, userId: string): BackfillSource {
  const timestampOf = async (conversationId: string, id: string): Promise<string | undefined> => {
    const { data } = await client
      .from('messages')
      .select('created_at')
      .eq('conversation_id', conversationId)
      .eq('id', id)
      .maybeSingle();
    return (data as { created_at?: string } | null)?.created_at;
  };

  return {
    async conversations() {
      return conversationIds(client, userId);
    },

    async page(conversationId, before, limit) {
      /*
       * The whole row, not just the paging keys.
       *
       * This selected `id, created_at` and the sink stored exactly that, so a
       * backfilled message reached the archive as an id and a timestamp with no
       * text. The backup verified perfectly, the counts matched to the message,
       * and half the history had no content in it — the precise failure this
       * pipeline exists to prevent, reached through the code meant to prevent
       * it. `BackfillRow` documents that extra fields ride along to the sink.
       */
      let query = client
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit);

      if (before) {
        const at = await timestampOf(conversationId, before);
        // A cursor pointing at a message that no longer exists must not silently
        // restart the walk from the newest end; it would loop forever.
        if (at === undefined) return [];
        query = query.or(olderThan(at, before));
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as BackfillRow[];
    },

    async countOlderThan(conversationId, before) {
      let query = client
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conversationId);

      if (before) {
        const at = await timestampOf(conversationId, before);
        if (at === undefined) return 0;
        query = query.or(olderThan(at, before));
      }

      const { count, error } = await query;
      if (error) throw error;
      return count ?? 0;
    },
  };
}

/**
 * Rows land in the same sealed store the app already reads from.
 *
 * The return value is measured rather than taken from `writeMessageRows`, which
 * reports how many rows it *wrote* — and it writes over a row it already had
 * without saying so. The sink contract is how many were genuinely new, and the
 * difference is exactly what the audit calls duplicates. Handing back the write
 * count would report every repeated page as fresh history and leave the
 * duplicate column permanently zero.
 *
 * Two range counts, which IndexedDB answers without reading or decrypting a
 * single row.
 */
export const liveBackfillSink: BackfillSink = {
  async write(conversationId, rows) {
    const range = messageRowRange(conversationId);
    const before = await localCount(STORE.messageRows, range);

    /*
     * Decrypted here, and stored in the same shape chat-service stores.
     *
     * `openRow` rewrites `row.body` in place — plaintext when it opens, and the
     * `UNREADABLE` placeholder when it does not. `session.ts` records what
     * happens if a caller caches the second kind: a transient failure becomes
     * the stored text and is then served ahead of the network for ever. An
     * archive is that cache with a longer memory, so a row that will not open
     * is skipped rather than backed up as the sentence "Sent before you added
     * this device."
     *
     * Skipping is the honest outcome, not a workaround. A device can only back
     * up what it can read, and the completeness proof will report the shortfall
     * instead of an archive full of placeholders that verifies perfectly.
     */
    const full = rows as unknown as MessageRow[];
    const readable: MessageRow[] = [];
    for (const row of full) {
      if (await openRow(row)) readable.push(row);
    }

    await writeMessageRows(
      conversationId,
      readable.map((row) => toMessage(row, undefined) as unknown as { id: string; createdAt: number }),
    );

    return {
      written: (await localCount(STORE.messageRows, range)) - before,
      unreadable: full.length - readable.length,
    };
  },
};

/**
 * Cursors, sealed like everything else in `meta`.
 *
 * Beside the rows they describe rather than in a table of their own, so an
 * interrupted backfill has exactly one piece of state to be consistent with.
 */
export const liveCursorStore: CursorStore & CursorReader = {
  async read(conversationId) {
    return openRecord<BackfillCursor>(
      await localGet<unknown>(STORE.meta, `${CURSOR_PREFIX}${conversationId}`),
    );
  },
  async write(conversationId, cursor) {
    await localSet(STORE.meta, `${CURSOR_PREFIX}${conversationId}`, await sealRecord(cursor));
  },
};

/** Drop every cursor, so the next backfill walks from the newest end again. */
export async function clearBackfillCursors(conversationIdsToClear: string[]): Promise<void> {
  for (const id of conversationIdsToClear) {
    await localDelete(STORE.meta, `${CURSOR_PREFIX}${id}`);
  }
}

/** What the server says, per conversation, asked fresh for the proof. */
export function liveProofSource(client: Client, userId: string): ProofSource {
  return {
    async conversations() {
      return conversationIds(client, userId);
    },
    async countMessages(conversationId) {
      const { count, error } = await client
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conversationId);
      if (error) throw error;
      return count ?? 0;
    },
  };
}

/**
 * What this device actually holds.
 *
 * Counted with an IndexedDB range count, so proving an account of forty
 * thousand messages does not decrypt forty thousand rows to count them.
 */
export const liveLocalCounts: LocalCounts = {
  /*
   * Conversations this device has walked, read from the cursor keys in `meta`.
   *
   * The obvious implementation — scan every key in `message-rows` and take the
   * conversation id off the front — reads the entire row store to produce a
   * list of a few hundred strings, on a phone, before a backup. The cursors
   * name the same conversations and there are as many of them as there are
   * chats.
   */
  async conversations() {
    const { localEntries } = await import('../local/db.js');
    const entries = await localEntries<unknown>(STORE.meta);
    return entries
      .map(([key]) => key)
      .filter((key) => key.startsWith(CURSOR_PREFIX))
      .map((key) => key.slice(CURSOR_PREFIX.length));
  },
  async countMessages(conversationId) {
    return localCount(STORE.messageRows, messageRowRange(conversationId));
  },
};

/**
 * A measurement of how large this account's rows serialise, for the estimate.
 *
 * Taken from whatever is already stored rather than assumed. Capped because
 * this runs before a backup on a phone and the answer stops improving long
 * before the whole store has been read.
 */
export async function liveLocalSample(limit = 500): Promise<LocalSample> {
  const { localEntries } = await import('../local/db.js');
  try {
    const entries = await localEntries<unknown>(STORE.messageRows);
    const sampled = entries.slice(0, limit);
    let bytes = 0;
    for (const [key, value] of sampled) {
      bytes += key.length + JSON.stringify(value).length + 40; // record envelope
    }
    return { rows: sampled.length, bytes };
  } catch {
    return { rows: 0, bytes: 0 };
  }
}

/**
 * Receipts, kept on Drive beside the archive they describe.
 *
 * Sealed, so Drive holds them without being able to read or forge one. Named by
 * generation so the newest is findable without opening any of them, and kept
 * rather than replaced — the chain is only worth having if the earlier links
 * survive.
 */
export function liveReceiptStore(drive: {
  find(name: string): Promise<{ id: string } | undefined>;
  list(prefix: string): Promise<Array<{ id: string; name: string }>>;
  upload(name: string, bytes: Uint8Array): Promise<unknown>;
  download(id: string): Promise<Uint8Array>;
}) {
  const RECEIPT_PREFIX = 'pingo.receipt.g';
  const name = (generation: number) => `${RECEIPT_PREFIX}${generation}.json`;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return {
    async newest(): Promise<SealedReceiptShape | undefined> {
      const files = await drive.list(RECEIPT_PREFIX);
      let best: { id: string; generation: number } | undefined;
      for (const file of files) {
        /*
         * `\\d`, not `\d`.
         *
         * This is a template literal, and JavaScript turns an unrecognised
         * escape into the bare character - so `\d` became `d` and the pattern
         * compiled to `^pingo.receipt.g(d+).json$`, looking for a literal
         * letter d where the generation number is. It never matched anything.
         *
         * Every receipt was written correctly and none was ever found, so a
         * restore said "Restored 5499 records across 4 stores. No backup record
         * was found, so it could not be verified." Both halves were true and
         * the second one was our own bug rather than a missing receipt.
         *
         * The `.` was silently wrong too: unescaped it matched any character,
         * which is harmless here and would not have stayed harmless.
         */
        const match = new RegExp(`^${RECEIPT_PREFIX}(\\d+)\\.json$`).exec(file.name);
        if (!match) continue;
        const generation = Number(match[1]);
        if (!best || generation > best.generation) best = { id: file.id, generation };
      }
      if (!best) return undefined;
      try {
        return JSON.parse(decoder.decode(await drive.download(best.id))) as SealedReceiptShape;
      } catch {
        // A receipt that will not parse is treated as no receipt: the chain
        // link is lost, which is worth knowing, but it must not stop a backup.
        return undefined;
      }
    },

    async put(sealed: SealedReceiptShape): Promise<void> {
      await drive.upload(name(sealed.generation), encoder.encode(JSON.stringify(sealed)));
    },
  };
}

/** Structural shape only; the real type lives in `receipt.ts`. */
interface SealedReceiptShape {
  generation: number;
}

/**
 * Everything the pipeline needs, assembled from the real app.
 *
 * The one place where Supabase, IndexedDB and Drive are named together. Kept
 * out of `pipeline.ts` so the lifecycle stays testable, and out of
 * `controller.ts` so screen state stays free of database queries.
 */
export async function liveBackupPorts(options: {
  userId: string;
  target: {
    backupArchiveStreaming: LiveTarget['backupArchiveStreaming'];
    verificationStore: LiveTarget['verificationStore'];
    driveClient: Parameters<typeof liveReceiptStore>[0];
  };
  recoveryPublicKey: string;
  recoveryPrivateKey?: CryptoKey;
  mode: 'simple' | 'private';
  keyVersion: number;
}): Promise<import('./pipeline.js').BackupPorts> {
  const client = getSupabaseClient();
  const { runBackfill } = await import('./backfill.js');
  const { proveCompleteness } = await import('./completeness.js');
  const { runPreflight } = await import('./preflight.js');
  const { verifyBackup } = await import('./verification.js');
  const { buildArchive, archiveLines } = await import('./archive-builder.js');
  const { openArchiveHeader } = await import('./drive/archive.js');
  const { openReceipt } = await import('./receipt.js');

  const receipts = liveReceiptStore(options.target.driveClient);
  const backfillSource = liveBackfillSource(client, options.userId);
  const proofSource = liveProofSource(client, options.userId);

  return {
    async preflight() {
      const local = await liveLocalSample();
      let held = 0;
      for (const id of await liveLocalCounts.conversations()) {
        held += await liveLocalCounts.countMessages(id);
      }
      return runPreflight(livePreflightSource(client, options.userId), local, {
        messages: held,
        conversationsComplete: 0,
      });
    },

    /*
     * Progress is reported per conversation, not per message.
     *
     * Measured on a real account: this stage ran for minutes and sat at "0%"
     * the whole time, because the callback was accepted and never called. A bar
     * that never moves during the longest step reads as a hang, which is the
     * one thing an honest progress display exists to prevent.
     *
     * Conversations rather than messages because the message total is only
     * known per conversation as it is walked, so a message-based percentage
     * would jump backwards as each new chat is discovered.
     */
    async backfill(signal, onPage) {
      return runBackfill(backfillSource, liveBackfillSink, liveCursorStore, {
        signal,
        onProgress: (p) => onPage(p.conversationsDone, p.conversationsTotal),
      });
    },

    async prove() {
      return proveCompleteness(proofSource, liveLocalCounts, liveCursorStore);
    },

    async archive(completeness, onProgress) {
      let manifest: import('./drive/archive.js').ArchiveManifest | undefined;
      let verification: import('./verification.js').VerificationResult | undefined;
      let archiveBytes = 0;

      const result = await options.target.backupArchiveStreaming(
        options.recoveryPublicKey,
        async (publicKey, generation, onChunk) => {
          const built = await buildArchive(
            publicKey,
            generation,
            async (chunk) => {
              archiveBytes += chunk.bytes.length;
              await onChunk(chunk);
            },
            () => archiveLines(undefined, completeness),
          );
          manifest = built.manifest;
          return built;
        },
        (progress) =>
          onProgress({
            stage: 'uploading',
            done: progress.sent,
            total: progress.total,
          }),
        async (generation) => {
          onProgress({ stage: 'verifying' });
          const store = options.target.verificationStore();
          verification = await verifyBackup(
            store,
            { generation, completeness },
            {
              /*
               * Only supplied when the recovery key is in hand. Without it the
               * header check reports itself skipped rather than passing
               * quietly, and the headline says completeness was not confirmed.
               */
              ...(options.recoveryPrivateKey
                ? {
                    readHeader: async (g: number) => {
                      const raw = await store.readManifest(g);
                      const chunk = await store.readChunk(g, 0);
                      if (!raw || !chunk) return undefined;
                      const header = await openArchiveHeader(
                        JSON.parse(raw),
                        chunk,
                        options.recoveryPrivateKey!,
                      );
                      return header as { completeness?: typeof completeness } | undefined;
                    },
                  }
                : {}),
            },
          );
          return verification.status === 'verified';
        },
      );

      return {
        generation: result.generation,
        manifest: manifest!,
        archiveBytes,
        verification: verification!,
      };
    },

    async previousReceipt() {
      const sealed = await receipts.newest();
      if (!sealed || !options.recoveryPrivateKey) return undefined;
      try {
        const receipt = await openReceipt(sealed as never, options.recoveryPrivateKey);
        return { sealed: sealed as never, receipt };
      } catch {
        // A receipt that will not open breaks the chain link and nothing else.
        return undefined;
      }
    },

    async storeReceipt(sealed) {
      await receipts.put(sealed);
    },

    recoveryPublicKey: options.recoveryPublicKey,
    mode: options.mode,
    keyVersion: options.keyVersion,
    newBackupId: () =>
      `bk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
  };
}

type LiveTarget = import('./drive/drive-target.js').GoogleDriveBackupTarget;
