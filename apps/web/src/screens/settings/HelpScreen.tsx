import { useAuth } from '@pingo/core';

import { Group, InfoRow, SettingsPage } from '../../features/settings/controls.js';

/**
 * Help.
 *
 * Two things a support conversation always needs - what build you are on and
 * which account you are - and a copy button, because the alternative is asking
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
        <InfoRow label="Account ID" value={session?.user.id.slice(0, 8) ?? '-'} />
        <InfoRow
          label="Copy diagnostics"
          value="Copy"
          onClick={() => void navigator.clipboard?.writeText(diagnostics)}
        />
      </Group>

      {/*
        An address, not a support inbox.

        This page used to say there was nowhere to write, while the privacy
        policy told people to ask for their data "through the Help screen" -
        two pages contradicting each other about the one route somebody uses
        when they are already stuck. An email is not a helpdesk, and it is
        honest about being one person; it is reachable, which is the whole
        requirement.
      */}
      <Group title="Get in touch">
        <InfoRow
          label="Email"
          value="piyushmishra3734@gmail.com"
          onClick={() => {
            const body = encodeURIComponent(`\n\n---\n${diagnostics}`);
            window.location.href = `mailto:piyushmishra3734@gmail.com?subject=${encodeURIComponent('PINGO')}&body=${body}`;
          }}
        />
      </Group>

      <p className="px-1 pb-4 text-caption text-text-tertiary">
        Writing from here attaches the diagnostics above. They contain no message content
        and no names - an account id, a version, and what device you are on.
      </p>
    </SettingsPage>
  );
}
