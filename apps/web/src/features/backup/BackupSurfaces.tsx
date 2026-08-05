import { Button } from '@pingo/ui';
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
    /*
     * Centred, not bottom-anchored.
     *
     * Anchoring to the bottom put the sheet underneath the tab bar, which sits
     * above it: the first screenshot of this dialog had "Not now" hidden behind
     * the navigation. Centring clears it on every height, and the extra bottom
     * padding keeps it clear on short screens where the bar is proportionally
     * taller.
     */
    <div className="fixed inset-0 z-200 flex items-center justify-center bg-black/50 p-4 pb-28">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-5 shadow-lg">
        {/*
          Short, and about what the user keeps rather than what they might lose.
          "Only you can read them" is the one security claim, and it stays a
          sentence a person can act on rather than a word they have to learn.
        */}
        <h2 className="text-lg font-semibold text-ink">Protect your chats</h2>
        <p className="pt-2 text-sm text-muted">
          Back up securely to Google Drive. Only you can read them.
        </p>

        {/* The design system's primary, so the fill matches every other one. */}
        <Button
          block
          className="mt-4"
          onClick={async () => {
            await ux.promptEnable();
            navigate('/settings/secure-backup');
          }}
        >
          Enable Backup
        </Button>
        <Button block variant="text" className="mt-2" onClick={() => void ux.promptNotNow()}>
          Not now
        </Button>
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
          {/*
            An offer, not an accusation. "Your chats aren't backed up" tells
            someone they have already failed at something; this tells them what
            they can have.
          */}
          <p className="text-sm font-medium text-ink">Protect your chats</p>
          <p className="pt-0.5 text-caption text-text-secondary">
            Turn on Google Drive backup so you don&rsquo;t lose your messages if you switch
            phones.
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
      <Button block size="sm" className="mt-2" onClick={() => navigate('/settings/secure-backup')}>
        Turn on backup
      </Button>
    </section>
  );
}

/**
 * After signing in on a device with nothing: "we found your chats".
 *
 * This is the screen the whole feature exists for, and the one a user meets on
 * the worst day they will have with the product. It says what was found and
 * offers to bring it back - it does not ask them to prove anything.
 */
export function BackupFoundCard({ ux }: { ux: BackupUx }) {
  const navigate = useNavigate();

  useEffect(() => {
    if (ux.showRestore) void record('backup.restore.prompt.shown');
  }, [ux.showRestore]);

  /*
   * `showRestore`, not `restoreAvailable`. The second says a backup exists,
   * which stays true after somebody has said "Not now" - reading it directly is
   * what made the dismiss button do nothing at all.
   */
  if (!ux.showRestore) return null;

  return (
    <section className="mx-3 mb-2 rounded-xl bg-surface p-4 shadow-sm">
      <p className="text-sm font-semibold text-ink">Backup found</p>
      <p className="pt-1 text-caption text-text-secondary">
        We found your chats in Google Drive. Restore them to this device?
      </p>

      {/*
        Where it is, when it was, how big.
        Concrete facts are what make an offer to overwrite a device believable,
        and each is shown only when actually known - a device that has not
        connected Drive yet has no date or size, and inventing one to look
        confident would be the wrong kind of reassurance.
      */}
      <dl className="pt-2 text-caption text-text-secondary">
        <div className="flex justify-between py-0.5">
          <dt>Google Drive</dt>
          <dd>{ux.backupWhen ?? ' - '}</dd>
        </div>
        {ux.backupSize ? (
          <div className="flex justify-between py-0.5">
            <dt>Size</dt>
            <dd>{ux.backupSize}</dd>
          </div>
        ) : null}
      </dl>
      <Button
        block
        size="sm"
        className="mt-3"
        onClick={() => {
          void record('backup.restore.accepted');
          navigate('/settings/secure-backup');
        }}
      >
        Restore chats
      </Button>
      <button
        type="button"
        className="focus-ring mt-1 w-full rounded-md px-3 py-2 text-sm text-muted"
        onClick={ux.skipRestore}
      >
        Not now
      </button>
    </section>
  );
}
