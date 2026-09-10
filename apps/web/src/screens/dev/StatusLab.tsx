import { Avatar, PingoDot } from '@pingo/ui';
import { useState, type ReactElement } from 'react';

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

        {/*
          Do not disturb, three ways. Each at a readable size and at the size it
          actually sits on an avatar, because the second is the one that decides.
        */}
        <div className="mt-5 rounded-lg bg-page p-5 shadow-sm">
          <p className="text-caption text-text-secondary">Do not disturb - pick one</p>
          <div className="mt-3 flex justify-around">
            {DND_OPTIONS.map(({ key, label, draw }) => (
              <div key={key} className="flex flex-col items-center gap-2">
                <div className="flex items-end gap-3">
                  {draw(30)}
                  <span className="grid place-items-center rounded-full bg-page p-[2px] ring-1 ring-line">
                    {draw(13)}
                  </span>
                </div>
                <span className="text-caption text-text-secondary">
                  {key} - {label}
                </span>
              </div>
            ))}
          </div>
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

/** The three candidates. A is what PingoDot draws now; B and C are here only to compare. */
const DND_OPTIONS: { key: string; label: string; draw: (px: number) => ReactElement }[] = [
  { key: 'A', label: 'Mars, shaded', draw: (px) => <PingoDot state="dnd" size={px / 1.35} /> },
  {
    key: 'B',
    label: 'Minus sign',
    draw: (px) => (
      <svg viewBox="0 0 24 24" width={px} height={px} aria-hidden>
        <circle cx="12" cy="12" r="10" fill="#E0533D" />
        <rect x="6" y="10.2" width="12" height="3.6" rx="1.8" fill="#FFFFFF" />
      </svg>
    ),
  },
  {
    key: 'C',
    label: 'Ringed planet',
    draw: (px) => (
      <svg viewBox="0 0 24 24" width={px} height={px} aria-hidden>
        <ellipse cx="12" cy="12.5" rx="11" ry="3.6" fill="none" stroke="#F2A65A" strokeWidth={1.6} transform="rotate(-18 12 12)" />
        <circle cx="12" cy="12" r="7" fill="#E0583F" />
        <path d="M1.6 15.8 A11 3.6 -18 0 0 22.4 8.6" fill="none" stroke="#F2A65A" strokeWidth={1.6} />
      </svg>
    ),
  },
];
