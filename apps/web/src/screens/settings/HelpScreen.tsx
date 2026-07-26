import { useAuth } from '@pingo/core';

import { Group, InfoRow, SettingsPage } from '../../features/settings/controls.js';

/**
 * Help.
 *
 * Two things a support conversation always needs — what build you are on and
 * which account you are — and a copy button, because the alternative is asking
 * someone to transcribe a UUID by hand.
 *
 * No FAQ and no contact form: neither exists, and a "Contact Support" row that
 * opens nothing is the exact pattern this codebase has refused everywhere else.
 * When support has an address, this is where it goes.
 */
export function HelpScreen() {
  const { session } = useAuth();

  const diagnostics = [
    `PINGO web · ${import.meta.env.MODE}`,
    `User: ${session?.user.id ?? 'signed out'}`,
    `Browser: ${navigator.userAgent}`,
  ].join('\n');

  return (
    <SettingsPage title="Help">
      <Group title="About">
        <InfoRow label="Version" value="0.1.0" />
        <InfoRow label="Build" value={import.meta.env.MODE} />
      </Group>

      <Group
        title="Diagnostics"
        note="Paste this into any support conversation. It contains no message content."
      >
        <InfoRow label="Account ID" value={session?.user.id.slice(0, 8) ?? '—'} />
        <InfoRow
          label="Copy diagnostics"
          value="Copy"
          onClick={() => void navigator.clipboard?.writeText(diagnostics)}
        />
      </Group>

      <p className="px-1 pb-4 text-caption text-text-tertiary">
        There is no support inbox yet, so there is no “Contact Support” button here — it
        would open nothing. It appears the day there is somewhere for it to go.
      </p>
    </SettingsPage>
  );
}
