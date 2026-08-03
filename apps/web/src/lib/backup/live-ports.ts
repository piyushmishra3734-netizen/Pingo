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
import { openRecord, sealRecord, writeMessageRows } from '../crypto/session.js';
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
     * Media size is the one figure that cannot come from a count, and it is the
     * least important one on the screen — it is shown for context and is not
     * part of the archive in v1. A sum aggregate that some deployments do not
     * expose should not be able to fail a backup, so an unsupported response
     * becomes zero through the same path as any other unavailable figure.
     */
    async mediaBytes() {
      const conversations = await ids;
      if (conversations.length === 0) return 0;
      const { data, error } = await client
        .from('messages')
        .select('file_size.sum()')
        .in('conversation_id', conversations);
      if (error) throw error;
      const row = (data as Array<{ sum?: number | null }> | null)?.[0];
      return row?.sum ?? 0;
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
      let query = client
        .from('messages')
        .select('id, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit);

      if (before) {
        const at = await timestampOf(conversationId, before);
        // A cursor pointing at a message that no longer exists must not silently
        // restart the walk from the newest end; it would loop forever.
        if (at === undefined) return [];
        query = query.lt('created_at', at);
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
        query = query.lt('created_at', at);
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
    await writeMessageRows(
      conversationId,
      rows.map((row) => ({ id: row.id, createdAt: Date.parse(row.created_at) })),
    );
    return (await localCount(STORE.messageRows, range)) - before;
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
        const match = new RegExp(`^${RECEIPT_PREFIX}(\d+)\.json$`).exec(file.name);
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

    async backfill(signal) {
      return runBackfill(backfillSource, liveBackfillSink, liveCursorStore, { signal });
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
