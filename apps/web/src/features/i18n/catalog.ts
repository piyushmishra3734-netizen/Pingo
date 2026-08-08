/**
 * App voice / language catalogs.
 *
 * Not a full locale stack (no Hindi packs yet). Two *English voices*:
 * - `en` — calm product English (default)
 * - `en-genz` — chronically-online / Gen-Z adjacent English (Canva-style tone switch)
 *
 * Missing keys always fall back to `en`.
 */

export type AppLanguage = 'en' | 'en-genz';

export const APP_LANGUAGES: {
  code: AppLanguage;
  label: string;
  short: string;
  blurb: string;
}[] = [
  {
    code: 'en',
    label: 'English',
    short: 'Default',
    blurb: 'Clear, calm product English.',
  },
  {
    code: 'en-genz',
    label: 'English (chronically online)',
    short: 'Gen Z',
    blurb: 'Same app, softer internet-native voice. Still readable. No cringe wall.',
  },
];

export function isAppLanguage(value: string | undefined | null): value is AppLanguage {
  return value === 'en' || value === 'en-genz';
}

/** Flat message catalog. Keep keys stable; copy can change freely. */
export type MessageKey =
  | 'nav.chats'
  | 'nav.calls'
  | 'nav.camera'
  | 'nav.communities'
  | 'nav.activity'
  | 'nav.profile'
  | 'nav.primary'
  | 'settings.title'
  | 'settings.search'
  | 'settings.account'
  | 'settings.appearance'
  | 'settings.notifications'
  | 'settings.privacy'
  | 'settings.chats'
  | 'settings.cameraPings'
  | 'settings.calls'
  | 'settings.storage'
  | 'settings.secureBackup'
  | 'settings.language'
  | 'settings.advanced'
  | 'settings.controlling'
  | 'settings.help'
  | 'settings.terms'
  | 'settings.privacyPolicy'
  | 'settings.switchAccount'
  | 'settings.logout'
  | 'settings.accountsCount'
  | 'language.title'
  | 'language.group'
  | 'language.selected'
  | 'language.hint'
  | 'language.applied'
  | 'welcome.title'
  | 'welcome.tagline'
  | 'welcome.getStarted'
  | 'welcome.legal'
  | 'welcome.terms'
  | 'welcome.privacy'
  | 'login.welcomeBack'
  | 'login.continue'
  | 'signup.welcome'
  | 'common.back'
  | 'common.next'
  | 'common.continue'
  | 'common.skip'
  | 'common.cancel'
  | 'common.save'
  | 'common.done'
  | 'common.search'
  | 'common.loading'
  | 'common.error'
  | 'chats.title'
  | 'chats.new'
  | 'chats.empty'
  | 'chats.emptyHint'
  | 'calls.title'
  | 'calls.empty'
  | 'camera.title'
  | 'profile.edit'
  | 'profile.friends'
  | 'profile.groups'
  | 'notifications.title'
  | 'notifications.empty'
  | 'intro.skip'
  | 'intro.next'
  | 'intro.continue';

type Catalog = Record<MessageKey, string>;

const en: Catalog = {
  'nav.chats': 'Chats',
  'nav.calls': 'Calls',
  'nav.camera': 'Camera',
  'nav.communities': 'Communities',
  'nav.activity': 'Activity',
  'nav.profile': 'Profile',
  'nav.primary': 'Primary',
  'settings.title': 'Settings',
  'settings.search': 'Search settings',
  'settings.account': 'Account',
  'settings.appearance': 'Appearance',
  'settings.notifications': 'Notifications',
  'settings.privacy': 'Privacy',
  'settings.chats': 'Chats',
  'settings.cameraPings': 'Camera & Pings',
  'settings.calls': 'Calls',
  'settings.storage': 'Storage',
  'settings.secureBackup': 'Secure Backup',
  'settings.language': 'Language',
  'settings.advanced': 'Advanced',
  'settings.controlling': 'Controlling',
  'settings.help': 'Help',
  'settings.terms': 'Terms of Use',
  'settings.privacyPolicy': 'Privacy Policy',
  'settings.switchAccount': 'Switch account',
  'settings.logout': 'Logout',
  'settings.accountsCount': '{n} accounts',
  'language.title': 'Language',
  'language.group': 'App language',
  'language.selected': 'Selected',
  'language.hint':
    'English is the base. Chronically online is the same product with a Gen-Z / internet-native voice — not a different translation of every sentence yet, but the main chrome speaks that way.',
  'language.applied': 'Voice updated',
  'welcome.title': 'Welcome to PINGO',
  'welcome.tagline': 'Private.\nFast.\nBeautiful.',
  'welcome.getStarted': 'Get Started',
  'welcome.legal': 'By continuing you agree to our',
  'welcome.terms': 'Terms of Use',
  'welcome.privacy': 'Privacy Policy',
  'login.welcomeBack': 'Welcome back',
  'login.continue': 'Continue',
  'signup.welcome': 'Welcome to PINGO',
  'common.back': 'Back',
  'common.next': 'Next',
  'common.continue': 'Continue',
  'common.skip': 'Skip',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.done': 'Done',
  'common.search': 'Search',
  'common.loading': 'Loading',
  'common.error': 'Something went wrong',
  'chats.title': 'Chats',
  'chats.new': 'New chat',
  'chats.empty': 'No chats yet',
  'chats.emptyHint': 'Start a conversation with someone you know.',
  'calls.title': 'Calls',
  'calls.empty': 'No calls yet',
  'camera.title': 'Camera',
  'profile.edit': 'Edit profile',
  'profile.friends': 'Friends',
  'profile.groups': 'Groups',
  'notifications.title': 'Notifications',
  'notifications.empty': 'You’re all caught up',
  'intro.skip': 'Skip',
  'intro.next': 'Next',
  'intro.continue': 'Continue',
};

/** Chronically-online English — warm, short, internet-native. Still clear. */
const enGenz: Catalog = {
  ...en,
  'nav.chats': 'DMs',
  'nav.calls': 'Calls',
  'nav.camera': 'Cam',
  'nav.communities': 'Communities',
  'nav.activity': 'Notifs',
  'nav.profile': 'You',
  'nav.primary': 'Main nav',
  'settings.title': 'Settings',
  'settings.search': 'Find a setting',
  'settings.account': 'Account',
  'settings.appearance': 'Look',
  'settings.notifications': 'Notifs',
  'settings.privacy': 'Privacy',
  'settings.chats': 'DMs & chats',
  'settings.cameraPings': 'Cam & Pings',
  'settings.calls': 'Calls',
  'settings.storage': 'Storage',
  'settings.secureBackup': 'Secure backup',
  'settings.language': 'Language / vibe',
  'settings.advanced': 'Advanced',
  'settings.controlling': 'Controlling',
  'settings.help': 'Help',
  'settings.terms': 'Terms',
  'settings.privacyPolicy': 'Privacy',
  'settings.switchAccount': 'Switch accounts',
  'settings.logout': 'Log out',
  'settings.accountsCount': '{n} accounts',
  'language.title': 'Language / vibe',
  'language.group': 'How PINGO talks',
  'language.selected': 'On',
  'language.hint':
    'Default is clean English. Chronically online is the gen-z / group-chat voice for labels and chrome. Deeper screens still fall back to default English until they’re ported.',
  'language.applied': 'Vibe locked in',
  'welcome.title': 'hey, you’re on PINGO',
  'welcome.tagline': 'Private.\nFast.\nActually pretty.',
  'welcome.getStarted': 'let’s go',
  'welcome.legal': 'By continuing you agree to our',
  'welcome.terms': 'Terms',
  'welcome.privacy': 'Privacy',
  'login.welcomeBack': 'welcome back',
  'login.continue': 'continue',
  'signup.welcome': 'welcome to PINGO',
  'common.back': 'Back',
  'common.next': 'Next',
  'common.continue': 'Continue',
  'common.skip': 'Skip',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.done': 'Done',
  'common.search': 'Search',
  'common.loading': 'Loading…',
  'common.error': 'that didn’t work',
  'chats.title': 'DMs',
  'chats.new': 'New chat',
  'chats.empty': 'inbox zero (the lonely kind)',
  'chats.emptyHint': 'Start a chat with someone. You’re allowed.',
  'calls.title': 'Calls',
  'calls.empty': 'no calls yet',
  'camera.title': 'Cam',
  'profile.edit': 'Edit profile',
  'profile.friends': 'Friends',
  'profile.groups': 'Groups',
  'notifications.title': 'Notifs',
  'notifications.empty': 'all clear, bestie',
  'intro.skip': 'Skip',
  'intro.next': 'Next',
  'intro.continue': 'Continue',
};

const CATALOGS: Record<AppLanguage, Catalog> = {
  en,
  'en-genz': enGenz,
};

export function resolveLanguage(raw: string | undefined | null): AppLanguage {
  return isAppLanguage(raw) ? raw : 'en';
}

export function translate(
  language: string | undefined | null,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const lang = resolveLanguage(language);
  let text = CATALOGS[lang][key] ?? en[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

/** Apply `data-voice` on the document (no React — safe from settings boot). */
export function syncDocumentVoice(language: string | undefined | null): void {
  const code = resolveLanguage(language);
  try {
    document.documentElement.lang = 'en';
    document.documentElement.dataset.voice = code;
  } catch {
    // non-DOM
  }
}
