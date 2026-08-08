import { Button, StorageIcon, cn } from '@pingo/ui';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { record } from '../../lib/backup/ux-telemetry.js';
import { useT } from '../i18n/useT.js';
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
  const t = useT();
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
        <h2 className="text-lg font-semibold text-ink">{t('backup.protectTitle')}</h2>
        <p className="pt-2 text-sm text-muted">{t('backup.protectBody')}</p>

        {/* The design system's primary, so the fill matches every other one. */}
        <Button
          block
          className="mt-4"
          onClick={async () => {
            await ux.promptEnable();
            navigate('/settings/secure-backup');
          }}
        >
          {t('backup.enable')}
        </Button>
        <Button block variant="text" className="mt-2" onClick={() => void ux.promptNotNow()}>
          {t('backup.notNow')}
        </Button>
      </div>
    </div>
  );
}

/** The recurring nudge, on Home, dismissible. */
export function BackupReminderCard({ ux }: { ux: BackupUx }) {
  const t = useT();
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
          <p className="text-sm font-medium text-ink">{t('backup.protectTitle')}</p>
          <p className="pt-0.5 text-caption text-text-secondary">{t('backup.reminderBody')}</p>
        </div>
        {/*
          Dismiss is a real dismissal, not a snooze: it widens the interval, and
          the third one stops the asking entirely.
        */}
        <button
          type="button"
          aria-label={t('backup.dismiss')}
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
  const t = useT();
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
    <section
      className={cn(
        'relative mx-3 mb-2 overflow-hidden rounded-2xl',
        'border border-line/60 bg-surface p-4',
        'shadow-[0_1px_2px_-1px_rgb(18_20_38/0.18),0_10px_30px_-16px_rgb(34_38_82/0.35)]',
      )}
    >
      {/*
        A wash of the brand behind the top edge, so the card reads as the
        product speaking rather than as a system alert. Very low, because this
        appears above somebody's conversations and has to be the second thing
        they look at, not the first.
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-brand/[0.07] to-transparent"
      />

      <div className="relative flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"
        >
          <StorageIcon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold text-ink">{t('backup.backedUp')}</p>
          <p className="pt-0.5 text-caption text-text-secondary">
            This device is new. Bring your history back from Google Drive.
          </p>
        </div>
      </div>

      {/*
        Where it is, when it was, how big.
        Concrete facts are what make an offer to overwrite a device believable,
        and each is shown only when actually known - a device that has not
        connected Drive yet has no date or size, and inventing one to look
        confident would be the wrong kind of reassurance.
      */}
      {(ux.backupWhen || ux.backupSize) && (
        <dl className="relative mt-3 flex flex-wrap gap-x-4 gap-y-1 rounded-xl bg-sunken px-3 py-2 text-caption">
          {ux.backupWhen && (
            <div className="flex gap-1.5">
              <dt className="text-text-tertiary">Last backup</dt>
              <dd className="text-ink">{ux.backupWhen}</dd>
            </div>
          )}
          {ux.backupSize && (
            <div className="flex gap-1.5">
              <dt className="text-text-tertiary">Size</dt>
              <dd className="text-ink">{ux.backupSize}</dd>
            </div>
          )}
        </dl>
      )}

      <div className="relative mt-3 flex items-center gap-2">
        <Button
          size="sm"
          className="flex-1"
          onClick={() => {
            void record('backup.restore.accepted');
            navigate('/settings/secure-backup');
          }}
        >
          {/*
            It opens the restore screen; it does not restore. The old label was
            "Restore chats", which is a promise this button cannot keep - the
            restore needs Drive connected first, so people pressed it, arrived
            somewhere else, and reported that restoring had not worked.
          */}
          Set up restore
        </Button>
        <button
          type="button"
          className={cn(
            'focus-ring shrink-0 rounded-lg px-3 py-2 text-caption text-text-secondary',
            'transition-colors duration-instant hover:bg-hover hover:text-ink',
          )}
          onClick={ux.skipRestore}
        >
          Not now
        </button>
      </div>
    </section>
  );
}
