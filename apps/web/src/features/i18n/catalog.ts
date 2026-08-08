/**
 * App voice catalogs — two English *voices*, not full locales.
 * - `en` default product English
 * - `en-genz` chronically-online / Gen-Z adjacent
 *
 * Missing genz keys fall back via spread of `en`.
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
    blurb: 'Same app, softer internet-native voice. Still readable.',
  },
];

export function isAppLanguage(value: string | undefined | null): value is AppLanguage {
  return value === 'en' || value === 'en-genz';
}

const en = {
  // nav
  'nav.chats': 'Chats',
  'nav.calls': 'Calls',
  'nav.camera': 'Camera',
  'nav.communities': 'Communities',
  'nav.activity': 'Activity',
  'nav.profile': 'Profile',
  'nav.primary': 'Primary',

  // settings index
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
  'settings.wallpaper': 'Chat wallpaper',
  'settings.password': 'Change password',

  // language screen
  'language.title': 'Language',
  'language.group': 'App language',
  'language.selected': 'Selected',
  'language.hint':
    'English is the base. Chronically online is the same product with a Gen-Z / internet-native voice across nav, auth, settings, chats, calls, camera, and more.',
  'language.applied': 'Voice updated',

  // welcome / auth
  'welcome.title': 'Welcome to PINGO',
  'welcome.tagline': 'Private.\nFast.\nBeautiful.',
  'welcome.getStarted': 'Get Started',
  'welcome.legal': 'By continuing you agree to our',
  'welcome.terms': 'Terms of Use',
  'welcome.privacy': 'Privacy Policy',
  'signup.welcome': 'Welcome to PINGO',
  'signup.tagline': 'Private.\nBeautiful.\nCalm.',
  'signup.already': 'Already have an account?',
  'signup.logIn': 'Log In',
  'signup.googleNote':
    'Google shares your name, email and profile photo with PINGO. Nothing else.',
  'signup.continueGoogle': 'Continue with Google',
  'signup.continueEmail': 'Continue with Email',
  'signup.continuePhone': 'Continue with Phone',
  'signup.googleCaption': 'Fastest, no password',
  'signup.phoneCaption': 'Helps friends find you',
  'login.welcomeBack': 'Welcome back',
  'login.continue': 'Continue',
  'login.newTo': 'New to PINGO?',
  'login.getStarted': 'Get Started',
  'login.lastUsed': 'Last used',
  'login.continueGoogle': 'Continue with Google',
  'login.username': 'Username',
  'login.email': 'Email',
  'login.phone': 'Phone number',
  'auth.emailTitle': "What's your email?",
  'auth.emailSubtitle': "You'll use this to sign in.",
  'auth.emailLabel': 'Email',
  'auth.emailPlaceholder': 'you@example.com',
  'auth.phoneTitle': "What's your number?",
  'auth.phoneSubtitle': "You'll use this to sign in.",
  'auth.usernameTitle': "What's your username?",
  'auth.usernameLabel': 'Username',
  'auth.usernamePlaceholder': 'yourname',
  'auth.passwordTitle': 'Enter your password',
  'auth.passwordCreate': 'Create a password',
  'auth.passwordCreateSub': "This is what you'll use to sign in.",
  'auth.welcomeBackCollision': 'Welcome back',
  'auth.connecting': 'Connecting',
  'auth.connectFail': "Couldn't connect",
  'auth.cancel': 'Cancel',

  // setup
  'setup.nameTitle': 'What should people call you?',
  'setup.nameLabel': 'Name',
  'setup.namePlaceholder': 'Piyush',
  'setup.usernameTitle': 'Choose Username',
  'setup.usernameLabel': 'Username',
  'setup.usernamePlaceholder': 'piyush',
  'setup.usernameTry': 'Try one of these',
  'setup.usernameChecking': 'Checking',
  'setup.photoTitle': 'Add Profile Photo',
  'setup.photoUploading': 'Uploading',
  'setup.permissionsTitle': 'Allow Notifications',
  'setup.permissionsSub': 'Stay updated.',
  'setup.backupTitle': 'Secure Backup',
  'setup.backupSub': 'Keep your chats if you lose this phone.',
  'setup.finding': 'Finding people',

  // common
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
  'common.and': 'and',
  'common.opening': 'Opening PINGO',

  // chats / calls / camera
  'chats.title': 'Chats',
  'chats.new': 'New chat',
  'chats.empty': 'No chats yet',
  'chats.emptyHint': 'Start a conversation with someone you know.',
  'chats.pick': 'Pick a conversation',
  'chats.pickHint': 'Choose someone from the list to start reading.',
  'chats.newGroup': 'New group',
  'calls.title': 'Calls',
  'calls.empty': 'No calls yet',
  'calls.emptyHint': 'Voice and video calls will appear here.',
  'calls.loading': 'Loading calls',
  'camera.title': 'Camera',
  'camera.openAsk': 'Open the camera?',
  'camera.none': 'No camera here.',

  // profile / social
  'profile.edit': 'Edit profile',
  'profile.friends': 'Friends',
  'profile.groups': 'Groups',
  'profile.journey': 'Journey',
  'profile.storyArchive': 'Story archive',
  'profile.archiveEmpty': 'Nothing archived yet',
  'profile.followRequests': 'Follow requests',

  // notifications
  'notifications.title': 'Activity',
  'notifications.empty': "You're all caught up",
  'notifications.quiet': 'All quiet',

  // intro
  'intro.skip': 'Skip',
  'intro.next': 'Next',
  'intro.continue': 'Continue',

  // settings pages
  'page.appearance': 'Appearance',
  'page.privacy': 'Privacy',
  'page.notifications': 'Notifications',
  'page.chats': 'Chats',
  'page.calls': 'Calls',
  'page.camera': 'Camera & Pings',
  'page.storage': 'Storage',
  'page.storageDevice': 'On this device',
  'page.storageUsed': 'Used',
  'page.storageAvailable': 'Available',
  'page.storageCache': 'Cache',
  'page.storageClear': 'Clear Cache',
  'page.advanced': 'Advanced',
  'page.help': 'Help',
  'page.account': 'Account',
  'page.wallpaper': 'Chat wallpaper',
  'page.wallpaperRain': 'Rain sound',
  'page.secureBackup': 'Secure Backup',
  'page.password': 'Change password',
  'page.controlling': 'Controlling',
  'page.language': 'Language',

  // legal headers (voice-light)
  'legal.terms': 'Terms of Use',
  'legal.privacy': 'Privacy Policy',
  'legal.updated': 'Last updated',
  'legal.related': 'Related policies',
  'legal.download': 'Download',
} as const;

export type MessageKey = keyof typeof en;

type Catalog = Record<MessageKey, string>;

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
  'settings.wallpaper': 'Chat wallpaper',
  'settings.password': 'Change password',
  'language.title': 'Language / vibe',
  'language.group': 'How PINGO talks',
  'language.selected': 'On',
  'language.hint':
    'Default is clean English. Chronically online is the gen-z voice across nav, auth, settings, DMs, calls, cam, notifs — basically wherever the chrome talks.',
  'language.applied': 'Vibe locked in',
  'welcome.title': "hey, you're on PINGO",
  'welcome.tagline': 'Private.\nFast.\nActually pretty.',
  'welcome.getStarted': "let's go",
  'welcome.terms': 'Terms',
  'welcome.privacy': 'Privacy',
  'signup.welcome': 'welcome to PINGO',
  'signup.tagline': 'Private.\nBeautiful.\nLowkey calm.',
  'signup.already': 'already have an account?',
  'signup.logIn': 'log in',
  'signup.googleNote':
    'Google shares your name, email and photo with PINGO. That\'s it — nothing weird.',
  'signup.continueGoogle': 'Continue with Google',
  'signup.continueEmail': 'Continue with email',
  'signup.continuePhone': 'Continue with phone',
  'signup.googleCaption': 'fastest, no password',
  'signup.phoneCaption': 'easier for friends to find you',
  'login.welcomeBack': 'welcome back',
  'login.continue': 'continue',
  'login.newTo': 'new to PINGO?',
  'login.getStarted': "let's go",
  'login.lastUsed': 'last used',
  'login.continueGoogle': 'Continue with Google',
  'login.username': 'Username',
  'login.email': 'Email',
  'login.phone': 'Phone',
  'auth.emailTitle': "what's your email?",
  'auth.emailSubtitle': "you'll use this to sign in.",
  'auth.phoneTitle': "what's your number?",
  'auth.phoneSubtitle': "you'll use this to sign in.",
  'auth.usernameTitle': "what's your username?",
  'auth.passwordTitle': 'enter your password',
  'auth.passwordCreate': 'make a password',
  'auth.passwordCreateSub': "this is how you'll sign in later.",
  'auth.welcomeBackCollision': 'welcome back',
  'auth.connecting': 'connecting…',
  'auth.connectFail': "couldn't connect",
  'auth.cancel': 'cancel',
  'setup.nameTitle': 'what should people call you?',
  'setup.nameLabel': 'Name',
  'setup.usernameTitle': 'pick a username',
  'setup.usernameTry': 'try one of these',
  'setup.usernameChecking': 'checking…',
  'setup.photoTitle': 'add a profile photo',
  'setup.photoUploading': 'uploading…',
  'setup.permissionsTitle': 'allow notifications?',
  'setup.permissionsSub': 'so you don’t miss the important stuff.',
  'setup.backupTitle': 'Secure backup',
  'setup.backupSub': 'keep your chats if this phone ghosts you.',
  'setup.finding': 'finding people…',
  'common.loading': 'Loading…',
  'common.error': "that didn't work",
  'common.opening': 'opening PINGO…',
  'chats.title': 'DMs',
  'chats.new': 'New chat',
  'chats.empty': 'inbox zero (the lonely kind)',
  'chats.emptyHint': 'Start a chat with someone. You’re allowed.',
  'chats.pick': 'pick a chat',
  'chats.pickHint': 'choose someone from the list and hop in.',
  'chats.newGroup': 'New group',
  'calls.title': 'Calls',
  'calls.empty': 'no calls yet',
  'calls.emptyHint': 'voice and video calls land here.',
  'calls.loading': 'loading calls…',
  'camera.title': 'Cam',
  'camera.openAsk': 'open the camera?',
  'camera.none': 'no camera on this device.',
  'profile.edit': 'Edit profile',
  'profile.journey': 'Journey',
  'profile.storyArchive': 'Story archive',
  'profile.archiveEmpty': 'archive is empty',
  'profile.followRequests': 'Follow requests',
  'notifications.title': 'Notifs',
  'notifications.empty': 'all clear, bestie',
  'notifications.quiet': 'all quiet',
  'page.appearance': 'Look',
  'page.privacy': 'Privacy',
  'page.notifications': 'Notifs',
  'page.chats': 'DMs & chats',
  'page.calls': 'Calls',
  'page.camera': 'Cam & Pings',
  'page.storage': 'Storage',
  'page.storageDevice': 'On this device',
  'page.storageUsed': 'Used',
  'page.storageAvailable': 'Available',
  'page.storageCache': 'Cache',
  'page.storageClear': 'Clear cache',
  'page.advanced': 'Advanced',
  'page.help': 'Help',
  'page.account': 'Account',
  'page.wallpaper': 'Chat wallpaper',
  'page.wallpaperRain': 'Rain sound',
  'page.secureBackup': 'Secure backup',
  'page.password': 'Change password',
  'page.controlling': 'Controlling',
  'page.language': 'Language / vibe',
  'legal.terms': 'Terms',
  'legal.privacy': 'Privacy',
  'legal.download': 'Download',
};

const CATALOGS: Record<AppLanguage, Catalog> = {
  en: en as Catalog,
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
  let text = CATALOGS[lang][key] ?? (en as Catalog)[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

export function syncDocumentVoice(language: string | undefined | null): void {
  const code = resolveLanguage(language);
  try {
    document.documentElement.lang = 'en';
    document.documentElement.dataset.voice = code;
  } catch {
    // non-DOM
  }
}
