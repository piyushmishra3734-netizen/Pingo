/**
 * The backup lifecycle, as one sequence with gates between the steps.
 *
 *     preflight → backfill → proof → archive → upload → verify → receipt → clean
 *
 * Each arrow is a gate rather than a step. The proof refuses to archive while
 * anything is short; verification refuses to let the clean run on a generation
 * it could not read back; the receipt is written only after verification
 * passes. So a receipt reading `verified · proven` cannot exist for a backup
 * that was neither — not by convention, but because there is no path through
 * this function that produces one.
 *
 * ## Why the collaborators are injected
 *
 * The same reason as everywhere else in this directory: the failures worth
 * testing are a server that lies, a Drive that drops an upload, and a proof
 * that comes back short. None of those are reachable through a real Drive
 * account on demand, and all of them are reachable in a second against a
 * stand-in.
 *
 * ## Stages are honest
 *
 * The stage names map one-to-one onto the modules above, so the progress a user
 * watches is the work actually happening rather than a bar tuned to feel right.
 */
import type { BackfillAudit, BackfillResult } from './backfill.js';
import {
  completenessHeader,
  formatProof,
  type CompletenessProof,
} from './completeness.js';
import type { PreflightSummary } from './preflight.js';
import {
  computeArchiveHash,
  computeManifestHash,
  sealReceipt,
  sealedReceiptHash,
  type BackupMode,
  type BackupReceipt,
  type SealedReceipt,
} from './receipt.js';
import { verificationHeadline, type VerificationResult } from './verification.js';
import type { ArchiveManifest } from './drive/archive.js';

export type BackupStage =
  | 'preparing'
  | 'downloading'
  | 'proving'
  | 'encrypting'
  | 'uploading'
  | 'verifying'
  | 'recording'
  | 'done';

export interface BackupProgress {
  stage: BackupStage;
  /** What to show under the stage name. Never invented. */
  detail?: string;
  done?: number;
  total?: number;
}

/** What the archive step reports back once the generation is committed. */
export interface ArchiveOutcome {
  generation: number;
  manifest: ArchiveManifest;
  archiveBytes: number;
  /** Run after HEAD and before the clean. See `verification.ts`. */
  verification: VerificationResult;
}

export interface BackupPorts {
  preflight(): Promise<PreflightSummary>;
  backfill(signal: { cancelled: boolean }, onPage: (fetched: number, total: number) => void): Promise<BackfillResult>;
  prove(): Promise<CompletenessProof>;
  /**
   * Seal, upload, commit HEAD, verify, and clean — in that order.
   *
   * One port rather than four because the ordering between them is a
   * correctness property, not a caller's choice: verification has to happen
   * after the pointer moves and before the old generation is deleted.
   */
  archive(
    completeness: { conversations: number; messages: number; provenAt: number },
    onProgress: (progress: BackupProgress) => void,
  ): Promise<ArchiveOutcome>;
  /** The newest receipt already stored, for the chain. */
  previousReceipt(): Promise<{ sealed: SealedReceipt; receipt: BackupReceipt } | undefined>;
  storeReceipt(sealed: SealedReceipt): Promise<void>;
  /** Identity of the account's recovery key, and how the archive is protected. */
  recoveryPublicKey: string;
  mode: BackupMode;
  keyVersion: number;
  /** Fresh id per backup. Injected so a test can assert on it. */
  newBackupId(): string;
}

export type BackupOutcome = 'complete' | 'incomplete' | 'unverified' | 'cancelled';

export interface BackupRun {
  outcome: BackupOutcome;
  /** One line, already safe to show. */
  headline: string;
  preflight?: PreflightSummary;
  audit?: BackfillAudit[];
  backfill?: BackfillResult;
  proof?: CompletenessProof;
  verification?: VerificationResult;
  receipt?: BackupReceipt;
  generation?: number;
  /** Why the run stopped, when it did not complete. */
  detail?: string;
}

/**
 * Run one backup, start to finish.
 *
 * Returns rather than throws for every expected failure — a short proof and a
 * failed verification are outcomes a user needs described, not exceptions a
 * caller has to remember to catch and translate. Genuine faults still throw.
 */
export async function runBackup(
  ports: BackupPorts,
  options: {
    signal?: { cancelled: boolean };
    onProgress?: (progress: BackupProgress) => void;
  } = {},
): Promise<BackupRun> {
  const signal = options.signal ?? { cancelled: false };
  const report = (progress: BackupProgress) => options.onProgress?.(progress);

  const cancelled = (detail: string): BackupRun => ({
    outcome: 'cancelled',
    headline: 'Backup stopped.',
    detail,
  });

  report({ stage: 'preparing', detail: 'Preparing chats' });
  const preflight = await ports.preflight();
  if (signal.cancelled) return cancelled('stopped before downloading');

  /*
   * An account with nothing in it is not an error and not a backup. Running the
   * whole lifecycle to produce an archive of nothing would still commit a
   * generation and write a receipt, which is a lot of machinery to record that
   * a new user has not sent a message yet.
   */
  if (preflight.empty) {
    return {
      outcome: 'complete',
      headline: 'Nothing to back up yet.',
      preflight,
    };
  }

  report({
    stage: 'downloading',
    detail: 'Downloading older history',
    done: 0,
    total: preflight.toDownload,
  });
  const backfill = await ports.backfill(signal, (fetched, total) =>
    report({ stage: 'downloading', detail: 'Downloading older history', done: fetched, total }),
  );
  if (signal.cancelled) {
    return { ...cancelled('stopped while downloading'), backfill, audit: backfill.audit, preflight };
  }

  /*
   * The gate that matters most.
   *
   * Everything downstream is cheap to redo and expensive to get wrong: an
   * archive built on an incomplete store verifies perfectly, restores cleanly,
   * and is missing history nobody will notice until they look for it.
   */
  report({ stage: 'proving', detail: 'Checking nothing is missing' });
  const proof = await ports.prove();

  if (proof.status !== 'proven') {
    return {
      outcome: 'incomplete',
      headline:
        proof.status === 'short'
          ? `Backup stopped: ${proof.shortfall.messages.toLocaleString()} messages are still missing.`
          : 'Backup stopped: some chats could not be checked.',
      detail: formatProof(proof),
      preflight,
      backfill,
      audit: backfill.audit,
      proof,
    };
  }

  // Throws unless proven, which is why it is called rather than constructed.
  const completeness = completenessHeader(proof);

  report({ stage: 'encrypting', detail: 'Encrypting' });
  const archived = await ports.archive(completeness, report);

  if (archived.verification.status !== 'verified') {
    return {
      outcome: 'unverified',
      headline: verificationHeadline(archived.verification),
      detail: archived.verification.failures.join(' '),
      preflight,
      backfill,
      audit: backfill.audit,
      proof,
      verification: archived.verification,
      generation: archived.generation,
    };
  }

  /*
   * The receipt is last, and only here.
   *
   * It records that this backup was verified and proven, so writing it before
   * either had happened would make it a statement of intent — which is exactly
   * what a receipt exists not to be.
   */
  report({ stage: 'recording', detail: 'Recording what was backed up' });
  const previous = await ports.previousReceipt();

  const receipt: BackupReceipt = {
    receiptVersion: 1,
    backupId: ports.newBackupId(),
    createdAt: Date.now(),
    generation: archived.generation,
    conversations: proof.totals.conversations,
    messages: proof.totals.localMessages,
    mediaFiles: preflight.photos + preflight.videos + preflight.documents + preflight.voiceNotes,
    archiveBytes: archived.archiveBytes,
    manifestHash: await computeManifestHash(archived.manifest),
    archiveHash: await computeArchiveHash(archived.manifest.chunks),
    mode: ports.mode,
    keyVersion: ports.keyVersion,
    verification: archived.verification.digests.sampled ? 'sampled' : 'verified',
    completeness: 'proven',
    ...(previous ? { previousHash: await sealedReceiptHash(previous.sealed) } : {}),
  };

  await ports.storeReceipt(await sealReceipt(receipt, ports.recoveryPublicKey));

  report({ stage: 'done', detail: 'Backup complete' });
  return {
    outcome: 'complete',
    headline: verificationHeadline(archived.verification),
    preflight,
    backfill,
    audit: backfill.audit,
    proof,
    verification: archived.verification,
    receipt,
    generation: archived.generation,
  };
}

/**
 * What the user sees while it runs.
 *
 * Kept beside the stages so a new stage cannot be added without deciding what
 * it is called — a progress label invented at the call site is how "Encrypting"
 * ends up shown during an upload.
 */
export const STAGE_LABELS: Record<BackupStage, string> = {
  preparing: 'Preparing chats…',
  downloading: 'Downloading older history…',
  proving: 'Checking nothing is missing…',
  encrypting: 'Encrypting…',
  uploading: 'Uploading to Google Drive…',
  verifying: 'Checking the backup…',
  recording: 'Recording what was backed up…',
  done: 'Backup complete',
};
