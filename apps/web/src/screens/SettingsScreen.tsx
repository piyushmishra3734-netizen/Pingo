import { searchSettings } from '@pingo/core';
import {
  AccountIcon,
  BellIcon,
  CameraIcon,
  ChatIcon,
  FileIcon,
  HelpIcon,
  InfoIcon,
  LockIcon,
  PaletteIcon,
  PhoneIcon,
  SearchField,
  ShieldIcon,
  StorageIcon,
  cn,
} from '@pingo/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ScreenHeader } from '../components/ScreenHeader.js';
import { useAppearance } from '../features/settings/SettingsContext.js';
import { SettingsRow } from '../features/settings/SettingsRow.js';
import { useSignOut } from '../features/settings/useSignOut.js';

/**
 * Settings — the index.
 *
 * ## Search is the fastest path, so it sits above everything
 *
 * Twelve sections is more than anyone scans. The field searches the registry in
 * `@pingo/core`, which is the *same* data the pages are built from — so a
 * setting that exists is a setting that is findable, and there is no second
 * list to forget to update.
 *
 * Results are individual controls, not sections: searching "dark" should land
 * on Dark Mode, not on a page that happens to contain it.
 *
 * ## Sections with no page yet still appear
 *
 * The index is the map of the product, and hiding what has not been built makes
 * the map wrong. Unbuilt sections are listed and marked `Soon` — visible, and
 * honest about not accepting a tap they cannot honour.
 */

const ACCENT_LABEL: Record<string, string> = {
  blue: 'Blue',
  purple: 'Purple',
  green: 'Green',
  pink: 'Pink',
  custom: 'Custom',
};

export function SettingsScreen() {
  const navigate = useNavigate();
  const signOut = useSignOut();
  const { appearance, resolvedTheme } = useAppearance();

  const [query, setQuery] = useState('');
  const results = searchSettings(query);
  const searching = query.trim().length > 0;

  return (
    <div className="flex h-full flex-col bg-page">
      <ScreenHeader title="Settings" showBack />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-28 pt-3">
        <SearchField
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search settings"
          aria-label="Search settings"
        />

        {searching ? (
          <div className="mt-4">
            {results.length === 0 ? (
              <p className="px-3 py-8 text-center text-caption text-text-secondary">
                Nothing matches “{query.trim()}”.
              </p>
            ) : (
              <ul className="rounded-lg bg-surface p-1 shadow-sm">
                {results.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setQuery('');
                        navigate(entry.path);
                      }}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-md px-3 py-3 text-left',
                        'focus-ring transition-colors duration-instant ease-standard',
                        'hover:bg-hover active:bg-pressed',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body text-ink">{entry.label}</span>
                        {/* The trail, so a result is never context-free. */}
                        <span className="block truncate text-caption text-text-secondary">
                          Settings › {entry.section}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            <section className="rounded-lg bg-surface p-1 shadow-sm">
              <SettingsRow
                icon={<AccountIcon size={19} />}
                label="Account"
                to="/settings/account"
              />
              <SettingsRow
                icon={<PaletteIcon size={19} />}
                label="Appearance"
                to="/settings/appearance"
                // The summary answers "what is it set to" without a tap.
                value={`${resolvedTheme === 'dark' ? 'Dark' : 'Light'} · ${
                  ACCENT_LABEL[appearance.accent] ?? 'Blue'
                }`}
              />
              <SettingsRow
                icon={<BellIcon size={19} />}
                label="Notifications"
                to="/settings/notifications"
              />
              <SettingsRow
                icon={<ShieldIcon size={19} />}
                label="Privacy"
                to="/settings/privacy"
              />
            </section>

            <section className="rounded-lg bg-surface p-1 shadow-sm">
              <SettingsRow icon={<ChatIcon size={19} />} label="Chats" to="/settings/chats" />
              <SettingsRow
                icon={<CameraIcon size={19} />}
                label="Camera & Pings"
                to="/settings/camera-snaps"
              />
              <SettingsRow icon={<PhoneIcon size={19} />} label="Calls" to="/settings/calls" />
              <SettingsRow
                icon={<StorageIcon size={19} />}
                label="Storage"
                to="/settings/storage"
              />
            </section>

            <section className="rounded-lg bg-surface p-1 shadow-sm">
              <SettingsRow
                icon={<InfoIcon size={19} />}
                label="Language"
                to="/settings/language"
                value="English"
              />
              <SettingsRow
                icon={<FileIcon size={19} />}
                label="Advanced"
                to="/settings/advanced"
              />
              <SettingsRow icon={<HelpIcon size={19} />} label="Help" to="/settings/help" />
            </section>

            <section className="rounded-lg bg-surface p-1 shadow-sm">
              <SettingsRow
                icon={<LockIcon size={19} />}
                label="Logout"
                destructive
                onClick={() => void signOut()}
              />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
