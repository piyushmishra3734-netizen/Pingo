/**
 * When a backup runs, and on which platform.
 *
 * Not after every message. A message-triggered upload would burn Drive quota,
 * battery and API limits to re-send an archive that has barely changed;
 * WhatsApp backs up daily for the same reason.
 *
 * ## The platforms genuinely differ, and the UI must not pretend otherwise
 *
 * Android can re-authorise silently once granted, so a backup can start while
 * the app is in the background with nobody present. The web cannot without our
 * server holding a credential that reads the user's Drive, which is a worse
 * trade than asking again. So on the web a backup runs when the user asks, or
 * while the tab is open — and the screen says exactly that rather than
 * promising something that will silently never happen.
 */
export type BackupTrigger = 'manual' | 'background' | 'periodic';

export interface BackupPolicy {
  triggers: BackupTrigger[];
  /** Minimum gap between automatic runs. Manual is never rate-limited. */
  minimumIntervalMs: number;
  /** What to tell the user this platform will actually do. */
  description: string;
}

export const ANDROID_POLICY: BackupPolicy = {
  triggers: ['manual', 'background', 'periodic'],
  minimumIntervalMs: 24 * 60 * 60 * 1000,
  description: 'Backs up automatically when you leave PINGO, and about once a day.',
};

export const WEB_POLICY: BackupPolicy = {
  triggers: ['manual'],
  minimumIntervalMs: 24 * 60 * 60 * 1000,
  description: 'Backs up when you choose Backup Now, while this tab is open.',
};

export function policyFor(isNative: boolean): BackupPolicy {
  return isNative ? ANDROID_POLICY : WEB_POLICY;
}

/**
 * Should an automatic backup run now?
 *
 * Manual always runs — a user who pressed the button has asked, and refusing
 * because a timer has not elapsed would be the app arguing with them.
 */
export function shouldBackup(
  policy: BackupPolicy,
  trigger: BackupTrigger,
  lastBackupAt: number | undefined,
  now = Date.now(),
): boolean {
  if (trigger === 'manual') return true;
  if (!policy.triggers.includes(trigger)) return false;
  if (lastBackupAt === undefined) return true;
  return now - lastBackupAt >= policy.minimumIntervalMs;
}
