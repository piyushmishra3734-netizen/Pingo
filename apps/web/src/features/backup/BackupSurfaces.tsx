import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { record } from '../../lib/backup/ux-telemetry.js';
import type { BackupUx } from './useBackupUx.js';

/**
 * The three things a user ever sees about backup before they go looking.
 *
 * ## No cryptographic words appear here
 *
 * Not "recovery key", not "encryption", not "code". The one security claim made
 * is "Only you can read them", which is a promise the architecture has to keep
 * rather than a word the user has to understand. Everything technical stays in
 * Settings and in the documents.
 *
 * ## They are mutually exclusive by construction
 *
 * A device with a backup waiting is offered the backup. A device without one is
 * asked, once, and then reminded on a widening schedule. A device with backup
 * on is shown nothing at all. The hook decides which; these only render.
 */

/** First login, once: the WhatsApp-shaped question. */
export function BackupPrompt({ ux }: { ux: BackupUx }) {
  const navigate = useNavigate();

  useEffect(() => {
    if (ux.showPrompt) void ux.markPromptShown();
    // Recording that it was shown must happen once, when it appears.
  }, [ux.showPrompt]);

  if (!ux.showPrompt) return null;

  return (
    <div className="fixed inset-0 z-200 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-5 shadow-lg">
        <h2 className="text-lg font-semibold text-ink">Protect your chats with Google Drive?</h2>
        <p className="pt-2 text-sm text-muted">
          Keep your chats if you lose your phone or switch to a new one. Your chats stay
          encrypted — only you can read them.
        </p>

        <button
          type="button"
          className="mt-4 w-full rounded-xl bg-accent px-4 py-3 text-center font-medium text-on-accent"
          onClick={async () => {
            await ux.promptEnable();
            navigate('/settings/secure-backup');
          }}
        >
          Enable Backup
        </button>
        <button
          type="button"
          className="mt-2 w-full px-4 py-3 text-center text-muted"
          onClick={() => void ux.promptNotNow()}
        >
          Not now
        </button>
      </div>
    </div>
  );
}

/** The recurring nudge, on Home, dismissible. */
export function BackupReminderCard({ ux }: { ux: BackupUx }) {
  const navigate = useNavigate();

  useEffect(() => {
    if (ux.showReminder) void ux.reminderShown();
  }, [ux.showReminder]);

  if (!ux.showReminder) return null;

  return (
    <section className="mx-3 mb-2 rounded-xl bg-surface p-3 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">Your chats aren&rsquo;t backed up</p>
          <p className="pt-0.5 text-caption text-text-secondary">
            Turn on backup so you don&rsquo;t lose them if you change phones.
          </p>
        </div>
        {/*
          Dismiss is a real dismissal, not a snooze: it widens the interval, and
          the third one stops the asking entirely.
        */}
        <button
          type="button"
          aria-label="Dismiss backup reminder"
          className="shrink-0 px-2 py-1 text-text-secondary"
          onClick={() => void ux.dismissReminder()}
        >
          ✕
        </button>
      </div>
      <button
        type="button"
        className="mt-2 w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent"
        onClick={() => navigate('/settings/secure-backup')}
      >
        Turn on backup
      </button>
    </section>
  );
}

/**
 * After signing in on a device with nothing: "we found your chats".
 *
 * This is the screen the whole feature exists for, and the one a user meets on
 * the worst day they will have with the product. It says what was found and
 * offers to bring it back — it does not ask them to prove anything.
 */
export function BackupFoundCard({ ux }: { ux: BackupUx }) {
  const navigate = useNavigate();

  useEffect(() => {
    if (ux.restoreAvailable) void record('backup.restore.prompt.shown');
  }, [ux.restoreAvailable]);

  if (!ux.ready || !ux.restoreAvailable) return null;

  return (
    <section className="mx-3 mb-2 rounded-xl bg-surface p-4 shadow-sm">
      <p className="text-sm font-semibold text-ink">Backup found</p>
      <p className="pt-1 text-caption text-text-secondary">
        We found your chats in Google Drive. Restore them to this device?
      </p>
      <button
        type="button"
        className="mt-3 w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent"
        onClick={() => {
          void record('backup.restore.accepted');
          navigate('/settings/secure-backup');
        }}
      >
        Restore chats
      </button>
      <button
        type="button"
        className="mt-1 w-full px-3 py-2 text-sm text-muted"
        onClick={() => void record('backup.restore.skipped')}
      >
        Not now
      </button>
    </section>
  );
}
