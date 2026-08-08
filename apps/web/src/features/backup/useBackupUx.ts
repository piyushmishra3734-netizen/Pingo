/**
 * What the backup surfaces need to know, in one place.
 *
 * Three screens ask the same questions - is backup on, is there a backup to
 * restore, should we be asking about it - and answering them separately is how
 * a reminder ends up on screen for somebody who turned backup on ten minutes
 * ago. This owns the state; the components render it.
 *
 * Stage 1 changes presentation only. Every call underneath is the existing
 * recovery implementation, unmodified.
 */
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';

import { openRecord, sealRecord } from '../../lib/crypto/session.js';
import { STORE, localGet, localSet } from '../../lib/local/db.js';
import { secureBackupStatus } from '../../lib/backup/secure-backup.js';
import { ServerBackupTarget } from '../../lib/backup/server-target.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';
import {
  INITIAL_REMINDERS,
  afterDismissed,
  afterEnabled,
  afterRestoreSkipped,
  afterShown,
  shouldShowReminder,
  shouldShowRestore,
  withInterval,
  type ReminderInterval,
  type ReminderState,
} from '../../lib/backup/reminders.js';
import { record } from '../../lib/backup/ux-telemetry.js';

/** "Today", "Yesterday", or a date. Nobody wants a timestamp here. */
function relativeDay(at: number, now = Date.now()): string {
  const days = Math.floor((new Date(now).setHours(0,0,0,0) - new Date(at).setHours(0,0,0,0)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const REMINDER_KEY = 'backup-reminders';

export interface BackupUx {
  /** Undefined until the first read finishes, so nothing flashes on screen. */
  ready: boolean;
  backupEnabled: boolean;
  /** True when the account has a package but this device is not set up. */
  restoreAvailable: boolean;
  reminders: ReminderState;
  /** The one-time prompt, shown only if it has never been shown. */
  showPrompt: boolean;
  /** The recurring home card. */
  showReminder: boolean;
  /** The "we found your chats" card. Latched, like the two above it. */
  showRestore: boolean;
  /** "Yesterday", when a previous backup time is known on this device. */
  backupWhen?: string;
  /** "52.5 MB", when known. */
  backupSize?: string;

  markPromptShown: () => Promise<void>;
  promptEnable: () => Promise<void>;
  promptNotNow: () => Promise<void>;
  reminderShown: () => Promise<void>;
  dismissReminder: () => Promise<void>;
  /** "Not now" on the restore card. Not "never" - see the note on the ref. */
  skipRestore: () => void;
  setInterval: (interval: ReminderInterval) => Promise<void>;
  markBackupEnabled: () => Promise<void>;
  refresh: () => Promise<void>;
}

async function readReminders(): Promise<ReminderState> {
  return (
    (await openRecord<ReminderState>(await localGet<unknown>(STORE.meta, REMINDER_KEY))) ??
    INITIAL_REMINDERS
  );
}

async function writeReminders(state: ReminderState): Promise<void> {
  await localSet(STORE.meta, REMINDER_KEY, await sealRecord(state));
}

export function useBackupUx(): BackupUx {
  const client = useMemo(() => getSupabaseClient(), []);
  const targets = useMemo(() => [new ServerBackupTarget(client)], [client]);

  const [ready, setReady] = useState(false);
  const [backupEnabled, setBackupEnabled] = useState(false);
  const [restoreAvailable, setRestoreAvailable] = useState(false);
  const [reminders, setReminders] = useState<ReminderState>(INITIAL_REMINDERS);

  /*
   * Latched, because recording that something was shown must not un-show it.
   *
   * Visibility used to be derived from `promptSeen`, and the effect that marks
   * it seen flipped that flag the moment the dialog mounted - so the prompt
   * appeared and closed itself in the same frame. Found by trying to
   * photograph it and getting an empty screen every time.
   *
   * Once open, these stay open until the user answers.
   */
  const [driveMeta, setDriveMeta] = useState<{ at?: number; bytes?: number }>({});
  const [promptOpen, setPromptOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);

  /**
   * Dismissed here, stays dismissed here.
   *
   * `dismissReminder` widens the schedule on disk, but `load` runs again on
   * every refresh and re-read the *old* schedule often enough to put the card
   * straight back — reported as a banner that would not go away however many
   * times it was closed. A dismissal is an answer to a question, and the
   * question is not asked twice in one session.
   */
  const dismissed = useRef(false);

  /**
   * The restore card's own latch, and it needed one of its own.
   *
   * The card rendered straight off `restoreAvailable`, which `refresh` recomputes
   * from the server every time it runs. Its "Not now" recorded a telemetry event
   * and changed nothing else, so the button was decorative: the card was still
   * there afterwards, and no amount of tapping moved it.
   *
   * Dismissal is for this session only, not written to disk. "Not now" means now
   * - and the one thing this card offers is chats that are otherwise not on the
   * device, which is too important to hide for ever on a single tap. It comes
   * back next launch, and Settings → Secure Backup can restore at any time.
   */
  const restoreSkipped = useRef(false);

  /**
   * The same latch for the one-time prompt.
   *
   * Answering it writes `promptSeen` to disk, and `refresh` re-reads that disk
   * to decide whether to open. Those are two different clocks: a refresh landing
   * in the gap between the tap and the write reads the *old* value and puts the
   * dialog straight back up. In memory the answer is already known, so the
   * memory is what is consulted.
   */
  const promptAnswered = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const status = await secureBackupStatus(targets);
      const stored = await readReminders();

      setBackupEnabled(status.enabled);
      /*
       * The account has a package and this device has no local enrolment: the
       * reinstall case. This is what turns the login prompt from "set up
       * backup" into "we found your chats".
       */
      const canRestore = !status.local && (status.targets.some((t) => t.present) ?? false);
      setRestoreAvailable(canRestore);
      /*
       * Answered *ever*, not answered this session.
       *
       * The skip lived in a ref, so it lasted exactly as long as the page did
       * and the card came back on every launch - which is the pop-up on the
       * chat list, and it took no notice of the reminder interval at all.
       */
      setRestoreOpen(shouldShowRestore(stored, canRestore) && !restoreSkipped.current);
      setReminders(stored);

      // Whatever this device already knows about the last backup, for the card.
      const drive = await openRecord<{ lastSuccessAt?: number; bytes?: number }>(
        await localGet<unknown>(STORE.meta, 'drive-backup'),
      );
      setDriveMeta({ at: drive?.lastSuccessAt, bytes: drive?.bytes });

      /*
       * Decide once, from what was on disk before this session touched it.
       * Later writes update the schedule without closing what is on screen.
       */
      if (
        !status.enabled &&
        !canRestore &&
        !stored.promptSeen &&
        !promptAnswered.current
      ) {
        setPromptOpen(true);
      } else if (
        !status.enabled &&
        !canRestore &&
        stored.promptSeen &&
        shouldShowReminder(stored, status.enabled) &&
        !dismissed.current
      ) {
        setReminderOpen(true);
      }
    } catch {
      // A status read that fails must not block the app; the surfaces simply
      // stay hidden until it succeeds.
    } finally {
      setReady(true);
    }
  }, [targets]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = useCallback(async (next: ReminderState) => {
    setReminders(next);
    await writeReminders(next);
  }, []);

  return {
    ready,
    backupEnabled,
    restoreAvailable,
    reminders,

    /*
     * Shown once, and only when there is nothing to restore - a device with a
     * backup waiting should be offered the backup, not asked to make one.
     */
    backupWhen: driveMeta.at ? relativeDay(driveMeta.at) : undefined,
    backupSize: driveMeta.bytes ? formatSize(driveMeta.bytes) : undefined,
    showPrompt: ready && promptOpen,
    showReminder: ready && reminderOpen,
    showRestore: ready && restoreOpen,

    markPromptShown: async () => {
      void record('backup.prompt.shown');
      await update(afterShown(reminders));
    },
    promptEnable: async () => {
      promptAnswered.current = true;
      setPromptOpen(false);
      void record('backup.prompt.enable');
      await update(afterShown(reminders));
    },
    promptNotNow: async () => {
      // "Not now" is an answer too, and it is not asked again this session.
      promptAnswered.current = true;
      dismissed.current = true;
      setPromptOpen(false);
      void record('backup.prompt.notnow');
      await update(afterDismissed(afterShown(reminders)));
    },
    reminderShown: async () => {
      void record('backup.reminder.shown');
      await update(afterShown(reminders));
    },
    dismissReminder: async () => {
      dismissed.current = true;
      setReminderOpen(false);
      void record('backup.reminder.dismissed');
      await update(afterDismissed(reminders));
    },
    skipRestore: () => {
      restoreSkipped.current = true;
      setRestoreOpen(false);
      void record('backup.restore.skipped');
      // Written down, so it is still true after a reload. The ref above only
      // stops it flashing back before this resolves.
      void update(afterRestoreSkipped(reminders));
    },
    setInterval: async (interval) => update(withInterval(reminders, interval)),
    markBackupEnabled: async () => {
      await update(afterEnabled(reminders));
      await refresh();
    },
    refresh,
  };
}
