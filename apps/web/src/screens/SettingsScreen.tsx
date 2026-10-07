import { searchSettings, useAuth, useProfile } from '@pingo/core';
import { Avatar, ChevronRightIcon, SearchField, cn } from '@pingo/ui';
import {
  Bell,
  Camera,
  Download,
  EyeOff,
  FileText,
  Gift,
  Globe,
  HardDrive,
  LifeBuoy,
  Lock,
  LogOut,
  Megaphone,
  MessageCircle,
  MonitorSmartphone,
  Palette,
  Phone,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
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
import { SecurePhoneRow } from '../features/auth/SecurePhoneSheet.js';
import { AppLogo } from '../components/AppLogo.js';
import { useAppVersion } from '../features/updates/useAppVersion.js';
import { publicAppUrl } from '../lib/public-origin.js';
import { isOperator } from '../lib/operator.js';

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
  purple: 'PINGO',
  pink: 'Rose',
  orange: 'Sunset',
  green: 'Green',
  blue: 'Ink',
  custom: 'Custom',
};

export function SettingsScreen() {
  const navigate = useNavigate();
  const signOut = useSignOut();
  const auth = useAuth();
  const { profile } = useProfile();
  const operator = isOperator(profile?.id);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [saved, setSaved] = useState(() => auth.service.listSavedAccounts());
  const { appearance, resolvedTheme, preferences } = useAppearance();
  const t = useT();
  const language = resolveLanguage(preferences.language);
  const languageValue =
    language === 'en-genz' ? 'Chronically online' : 'English';

  const app = useAppVersion();
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
          <div className="mt-4 space-y-5">
            {/*
              Who you are, first - the way every settings screen people already
              know opens. It is also the quickest way to your own profile.
            */}
            {profile && (
              <button
                type="button"
                onClick={() => navigate('/profile')}
                className="focus-ring flex w-full items-center gap-3.5 rounded-lg bg-surface p-3.5 text-left shadow-sm active:bg-pressed"
              >
                <Avatar
                  name={profile.displayName || profile.username}
                  id={profile.id}
                  {...(profile.avatarUrl ? { src: profile.avatarUrl } : {})}
                  size="lg"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[18px] font-semibold text-ink">
                    {profile.displayName || profile.username}
                  </span>
                  <span className="block truncate text-caption text-text-secondary">
                    @{profile.username} · Your profile
                  </span>
                </span>
                <ChevronRightIcon size={18} className="shrink-0 text-text-tertiary" />
              </button>
            )}

            {/* Only for an account with no number. See the component. */}
            <SecurePhoneRow />

            <Group title="Account">
              <SettingsRow tone="blue" icon={<UserRound size={18} />} label={t('settings.account')} to="/settings/account" />
              <SettingsRow tone="indigo" icon={<Lock size={18} />} label={t('settings.privacy')} to="/settings/privacy" />
              {/*
                With the account rather than under Privacy: a device list is
                something you go and look at, and Privacy is a page of switches.
              */}
              <SettingsRow tone="teal" icon={<MonitorSmartphone size={18} />} label={t('page.devices')} to="/settings/devices" />
            </Group>

            <Group title="App">
              <SettingsRow
                tone="purple"
                icon={<Palette size={18} />}
                label={t('settings.appearance')}
                to="/settings/appearance"
                // The summary answers "what is it set to" without a tap.
                value={`${resolvedTheme === 'dark' ? 'Dark' : 'Light'} · ${ACCENT_LABEL[appearance.accent] ?? 'PINGO'}`}
              />
              <SettingsRow tone="red" icon={<Bell size={18} />} label={t('settings.notifications')} to="/settings/notifications" />
              <SettingsRow tone="green" icon={<MessageCircle size={18} />} label={t('settings.chats')} to="/settings/chats" />
              <SettingsRow tone="orange" icon={<Camera size={18} />} label={t('settings.cameraPings')} to="/settings/camera-snaps" />
              <SettingsRow tone="green" icon={<Phone size={18} />} label={t('settings.calls')} to="/settings/calls" />
              {/*
                Muting somebody's stories takes their circle off the rail, and
                the control that would unmute them goes with it - so Settings is
                the only place the decision can be taken back.
              */}
              <SettingsRow tone="gray" icon={<EyeOff size={18} />} label="Muted stories" to="/settings/muted-stories" />
              <SettingsRow tone="sky" icon={<HardDrive size={18} />} label={t('settings.storage')} to="/settings/storage" />
              <SettingsRow tone="blue" icon={<Globe size={18} />} label={t('settings.language')} to="/settings/language" value={languageValue} />
            </Group>

            <Group title="More">
              <SettingsRow tone="pink" icon={<Gift size={18} />} label="Invite friends" to="/invite" />
              {/*
                Only in the Android app, which cannot update itself: the same
                page its update prompt opens, in the phone's browser.
              */}
              {app.native && (
                <SettingsRow
                  tone="purple"
                  icon={<Download size={18} />}
                  label="Check for updates"
                  value={app.version}
                  onClick={() => {
                    window.location.href = publicAppUrl('/download?update=1');
                  }}
                />
              )}
              <SettingsRow tone="sky" icon={<LifeBuoy size={18} />} label={t('settings.help')} to="/settings/help" />
              <SettingsRow tone="gray" icon={<SlidersHorizontal size={18} />} label={t('settings.advanced')} to="/settings/advanced" />
              {/*
                Operator-only surface for publishing intro slide art and the
                update notice. Hidden for every account but the operator's (by id).
              */}
              {operator ? (
                <SettingsRow tone="orange" icon={<Megaphone size={18} />} label={t('settings.controlling')} to="/settings/controlling" value="Operator" />
              ) : null}
            </Group>

            <Group title="Legal">
              {/* Public routes, deliberately: the same pages the download page links to. */}
              <SettingsRow tone="gray" icon={<FileText size={18} />} label={t('settings.terms')} to="/terms" />
              <SettingsRow tone="gray" icon={<ShieldCheck size={18} />} label={t('settings.privacyPolicy')} to="/privacy" />
            </Group>

            <section className="rounded-lg bg-surface p-1 shadow-sm">
              {/*
                Above Logout, deliberately. They sit next to each other because
                both are "leave this account", and switching is the one people
                actually mean most of the time - putting it second would make
                the destructive option the first thing a thumb reaches.
              */}
              <SettingsRow
                tone="blue"
                icon={<Users size={18} />}
                label={t('settings.switchAccount')}
                value={saved.length > 1 ? t('settings.accountsCount', { n: saved.length }) : undefined}
                onClick={() => setSwitcherOpen(true)}
              />
              <SettingsRow
                icon={<LogOut size={18} />}
                label={t('settings.logout')}
                destructive
                onClick={() => void signOut()}
              />
            </section>

            {/* Which PINGO this is - the first thing any support conversation asks. */}
            <footer className="flex flex-col items-center gap-1.5 pt-2 pb-4 text-center">
              <AppLogo size={28} alt="" className="opacity-80" />
              <p className="text-caption text-text-secondary">
                PINGO {app.native ? app.version : 'for web'}
              </p>
              <p className="text-[11px] text-text-tertiary tabular-nums">Build {app.build}</p>
            </footer>
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

/** A titled group of rows: the heading outside, the rows on one card. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-1.5 px-3 text-[12px] font-semibold tracking-[0.06em] text-text-tertiary uppercase">{title}</h2>
      <div className="rounded-lg bg-surface p-1 shadow-sm">{children}</div>
    </section>
  );
}
