import { searchSettings, useAuth, useProfile } from '@pingo/core';
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
  MuteIcon,
  PhoneIcon,
  SearchField,
  ShieldIcon,
  StorageIcon,
  UsersIcon,
  cn,
} from '@pingo/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ScreenHeader } from '../components/ScreenHeader.js';
import { resolveLanguage } from '../features/i18n/catalog.js';
import { useT } from '../features/i18n/useT.js';
import { useAppearance } from '../features/settings/SettingsContext.js';
import { SettingsRow } from '../features/settings/SettingsRow.js';
import { useSignOut } from '../features/settings/useSignOut.js';
import { beginAddingAccount } from '../features/auth/adding-account.js';
import { SwitchAccountSheet } from '../features/settings/SwitchAccountSheet.js';

/**
 * Settings - the index.
 *
 * ## Search is the fastest path, so it sits above everything
 *
 * Twelve sections is more than anyone scans. The field searches the registry in
 * `@pingo/core`, which is the *same* data the pages are built from - so a
 * setting that exists is a setting that is findable, and there is no second
 * list to forget to update.
 *
 * Results are individual controls, not sections: searching "dark" should land
 * on Dark Mode, not on a page that happens to contain it.
 *
 * ## Sections with no page yet still appear
 *
 * The index is the map of the product, and hiding what has not been built makes
 * the map wrong. Unbuilt sections are listed and marked `Soon` - visible, and
 * honest about not accepting a tap they cannot honour.
 */

const ACCENT_LABEL: Record<string, string> = {
  blue: 'Ink',
  purple: 'Purple',
  green: 'Green',
  pink: 'Pink',
  custom: 'Custom',
};

export function SettingsScreen() {
  const navigate = useNavigate();
  const signOut = useSignOut();
  const auth = useAuth();
  const { profile } = useProfile();
  const isOperator = profile?.username === 'piuxxh';
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [saved, setSaved] = useState(() => auth.service.listSavedAccounts());
  const { appearance, resolvedTheme, preferences } = useAppearance();
  const t = useT();
  const language = resolveLanguage(preferences.language);
  const languageValue =
    language === 'en-genz' ? 'Chronically online' : 'English';

  const [query, setQuery] = useState('');
  const results = searchSettings(query);
  const searching = query.trim().length > 0;

  return (
    <div className="flex h-full flex-col bg-page">
      <ScreenHeader title={t('settings.title')} showBack />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-28 pt-3">
        <SearchField
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('settings.search')}
          aria-label={t('settings.search')}
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
                          {t('settings.title')} › {entry.section}
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
                label={t('settings.account')}
                to="/settings/account"
              />
              <SettingsRow
                icon={<PaletteIcon size={19} />}
                label={t('settings.appearance')}
                to="/settings/appearance"
                // The summary answers "what is it set to" without a tap.
                value={`${resolvedTheme === 'dark' ? 'Dark' : 'Light'} · ${
                  ACCENT_LABEL[appearance.accent] ?? 'Blue'
                }`}
              />
              <SettingsRow
                icon={<BellIcon size={19} />}
                label={t('settings.notifications')}
                to="/settings/notifications"
              />
              <SettingsRow
                icon={<ShieldIcon size={19} />}
                label={t('settings.privacy')}
                to="/settings/privacy"
              />
            </section>

            <section className="rounded-lg bg-surface p-1 shadow-sm">
              <SettingsRow
                icon={<ChatIcon size={19} />}
                label={t('settings.chats')}
                to="/settings/chats"
              />
              <SettingsRow
                icon={<CameraIcon size={19} />}
                label={t('settings.cameraPings')}
                to="/settings/camera-snaps"
              />
              <SettingsRow
                icon={<PhoneIcon size={19} />}
                label={t('settings.calls')}
                to="/settings/calls"
              />
              {/*
                Muting somebody's stories takes their circle off the rail, and
                the control that would unmute them goes with it - so Settings is
                the only place the decision can be taken back. Beside the other
                per-feature pages rather than under Privacy: it is about what
                you see, not about what anyone can see of you.
              */}
              <SettingsRow
                icon={<MuteIcon size={19} />}
                label="Muted stories"
                to="/settings/muted-stories"
              />
              {/*
                With the other per-feature pages rather than under Privacy: a
                device list is something you go and look at, like storage, and
                Privacy is a page of switches.
              */}
              <SettingsRow
                icon={<LockIcon size={19} />}
                label={t('page.devices')}
                to="/settings/devices"
              />
              <SettingsRow
                icon={<StorageIcon size={19} />}
                label={t('settings.storage')}
                to="/settings/storage"
              />
            </section>

            <section className="rounded-lg bg-surface p-1 shadow-sm">
              <SettingsRow
                icon={<InfoIcon size={19} />}
                label={t('settings.language')}
                to="/settings/language"
                value={languageValue}
              />
              <SettingsRow
                icon={<FileIcon size={19} />}
                label={t('settings.advanced')}
                to="/settings/advanced"
              />
              {/*
                Operator-only surface for publishing intro slide art at original
                quality. Hidden for every account except @piuxxh.
              */}
              {isOperator ? (
                <SettingsRow
                  icon={<PaletteIcon size={19} />}
                  label={t('settings.controlling')}
                  to="/settings/controlling"
                  value="Intro slides"
                />
              ) : null}
              <SettingsRow
                icon={<HelpIcon size={19} />}
                label={t('settings.help')}
                to="/settings/help"
              />
              {/* Public route, deliberately: the same page the download page links to. */}
              <SettingsRow
                icon={<InfoIcon size={19} />}
                label={t('settings.terms')}
                to="/terms"
              />
              <SettingsRow
                icon={<ShieldIcon size={19} />}
                label={t('settings.privacyPolicy')}
                to="/privacy"
              />
            </section>

            <section className="rounded-lg bg-surface p-1 shadow-sm">
              {/*
                Above Logout, deliberately. They sit next to each other because
                both are "leave this account", and switching is the one people
                actually mean most of the time - putting it second would make
                the destructive option the first thing a thumb reaches.
              */}
              <SettingsRow
                icon={<UsersIcon size={19} />}
                label={t('settings.switchAccount')}
                value={
                  saved.length > 1
                    ? t('settings.accountsCount', { n: saved.length })
                    : undefined
                }
                onClick={() => setSwitcherOpen(true)}
              />
              <SettingsRow
                icon={<LockIcon size={19} />}
                label={t('settings.logout')}
                destructive
                onClick={() => void signOut()}
              />
            </section>
          </div>
        )}
      </div>

      {switcherOpen && (
      <SwitchAccountSheet
        onClose={() => setSwitcherOpen(false)}
        currentUserId={auth.session?.user.id}
        accounts={saved}
        onSwitch={(userId) => auth.service.switchTo(userId)}
        onForget={(userId) => {
          auth.service.forgetAccount(userId);
          setSaved(auth.service.listSavedAccounts());
        }}
        onAddAccount={() => {
          /*
           * Adding an account is signing in, and signing in replaces the
           * session - which is fine, because the one being replaced is already
           * saved. Coming back through the switcher restores it in a tap.
           */
          setSwitcherOpen(false);
          // Carried in storage as well as the URL: the query string does not
          // survive Welcome handing off to Log In or Sign up, and without it
          // the guard sent people straight back here.
          beginAddingAccount();
          navigate('/welcome?add=1');
        }}
      />
      )}
    </div>
  );
}
