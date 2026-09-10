import { Avatar, PingoDot } from '@pingo/ui';
import { useState } from 'react';

import { ChoiceRow, Group } from '../../features/settings/controls.js';
import type { PresenceStatus } from '../../features/settings/privacy-flags.js';

/**
 * The status marks, at `/dev/status-lab`.
 *
 * The picker lives in Privacy and the marks on the owner's own profile, and
 * both are behind a session. This draws them bare: the three on an avatar at
 * the size a profile uses, and the picker exactly as Settings builds it, minus
 * the save.
 */
const STATUSES: { value: PresenceStatus; label: string }[] = [
  { value: 'online', label: 'Online' },
  { value: 'invisible', label: 'Invisible' },
  { value: 'dnd', label: 'Do not disturb' },
];

export function StatusLab() {
  const [status, setStatus] = useState<PresenceStatus>('online');

  return (
    <div className="h-full overflow-y-auto bg-sunken">
      <div className="mx-auto w-full max-w-md px-4 py-6">
        <h1 className="text-h2 text-ink">Status marks</h1>

        <div className="mt-5 flex justify-around rounded-lg bg-page p-5 shadow-sm">
          {STATUSES.map(({ value, label }) => (
            <div key={value} className="flex flex-col items-center gap-2">
              <Avatar name="Anaya" id="lab-anaya" size="xl" presence={value} />
              <span className="text-caption text-text-secondary">{label}</span>
            </div>
          ))}
        </div>

        <div className="mt-5">
          <Group title="Picker">
            <ChoiceRow
              label="Status"
              value={status}
              options={STATUSES.map(({ value, label }) => ({
                value,
                label,
                icon: (
                  <span className="grid place-items-center rounded-full bg-page p-[2px]">
                    <PingoDot state={value} size={10} />
                  </span>
                ),
              }))}
              onChange={setStatus}
            />
          </Group>
        </div>
      </div>
    </div>
  );
}
