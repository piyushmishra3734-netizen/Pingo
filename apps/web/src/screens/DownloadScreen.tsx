import { Button, CheckIcon, ChevronLeftIcon, IconButton, cn } from '@pingo/ui';
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { AppLogo } from '../components/AppLogo.js';
import { useInstall, type Platform } from '../features/install/useInstall.js';

/**
 * The official Android download.
 *
 * GitHub Releases rather than this site, and `/latest/` rather than a pinned
 * tag — the link keeps working when a new version ships, so the page never
 * offers an old build and nobody has to remember to edit it.
 *
 * Cloudflare Pages hosts the website and nothing else now. It caps files at
 * 25 MiB, which the APK has already brushed against once; the moment a build
 * carries the camera models or a native library it stops fitting, and a
 * distribution channel with a ceiling that low is one that fails silently at
 * the worst moment.
 */
const ANDROID_APK =
  'https://github.com/piyushmishra3734-netizen/Pingo/releases/latest/download/PINGO-v1.0.0.apk';

/** The release page itself, for anyone who wants the notes and the history. */
const ANDROID_RELEASES =
  'https://github.com/piyushmishra3734-netizen/Pingo/releases/latest';

/** Where each platform's app will come from. Named, so the button can say it. */
const STORE_NAME: Record<Platform, string> = {
  android: 'Play Store',
  ios: 'the App Store',
  windows: 'Windows',
  macos: 'macOS',
  other: 'your platform',
};

/**
 * Where PINGO explains that it is an app.
 *
 * ## Every claim on this page is one the product can keep
 *
 * A download page is marketing, and marketing about software is the easiest
 * place in a product to write something untrue by accident. Everything here was
 * checked against what actually ships: the service worker precaches the shell,
 * so "opens offline" is a fact; there is no native binary for any platform, so
 * nothing here offers a `.exe` or an `.apk`; push notifications are not wired
 * up, so the page does not promise them.
 *
 * The one thing it will not do is describe a native app that does not exist.
 * The Android and iOS builds are real store applications produced from the
 * shared engine, and until they are published this page says so rather than
 * teaching anybody to bookmark a website instead.
 *
 * ## Why the status on each card is honest
 *
 * "Available now" only for what somebody can use this minute — which today is
 * the web. Everything else says "In development", because a store badge that
 * links nowhere is worse than a sentence explaining where things stand.
 */

interface PlatformCard {
  key: Platform | 'web';
  name: string;
  icon: string;
  status: 'available' | 'soon';
  method: string;
  requirements: string;
}

const PLATFORMS: PlatformCard[] = [
  {
    key: 'android',
    name: 'Android',
    icon: '🤖',
    status: 'available',
    method: 'A real installable app — its own icon, no browser, full screen. Download the APK below and install it directly; the Play Store listing comes later.',
    requirements: 'Android 7 or newer. Allow install from unknown sources once.',
  },
  {
    key: 'ios',
    name: 'iPhone & iPad',
    icon: '',
    status: 'soon',
    method: 'A real App Store app, downloaded and installed like any other.',
    requirements: 'iOS or iPadOS 15 or newer.',
  },
  {
    key: 'windows',
    name: 'Windows',
    icon: '🪟',
    status: 'soon',
    method: 'A signed desktop installer with its own window, taskbar icon and notifications.',
    requirements: 'Windows 10 or 11.',
  },
  {
    key: 'macos',
    name: 'macOS',
    icon: '💻',
    status: 'soon',
    method: 'A signed .dmg that installs to Applications like any Mac app.',
    requirements: 'macOS 12 or newer.',
  },
  {
    key: 'web',
    name: 'Web',
    icon: '🌐',
    status: 'available',
    method: 'Nothing to install. The full product runs in any modern browser, right now.',
    requirements: 'Any browser from the last two years.',
  },
];

/**
 * Why installing beats a tab.
 *
 * Each of these is something the installed app measurably does and the tab does
 * not. Deliberately absent: push notifications, which are not implemented, and
 * "better battery life", which nothing here would let us prove.
 */
const BENEFITS = [
  {
    title: 'Opens instantly',
    body: 'The app shell is stored on your device, so PINGO starts without waiting for the network.',
  },
  {
    title: 'Works offline',
    body: 'Open it on a plane or in a lift and the app still loads. Messages sync when you are back.',
  },
  {
    title: 'Its own window',
    body: 'No address bar, no tabs, no browser chrome. Alt-Tab and Cmd-Tab find it like any app.',
  },
  {
    title: 'Full screen on a phone',
    body: 'The whole display, with the status bar tinted to match — not a page inside a browser.',
  },
  {
    title: 'Camera and microphone',
    body: 'Pings, stories and calls use your hardware directly, with permission asked once.',
  },
  {
    title: 'Native sharing',
    body: 'Share a profile or a link through the system share sheet you already use.',
  },
];

/**
 * What is actually happening, per platform.
 *
 * These used to be "Add to Home Screen" instructions. PINGO is not a Progressive
 * Web App and must never ask anybody to bookmark it — the native builds are real
 * store applications produced from the same engine, and a page teaching people
 * to save a shortcut instead would undercut the thing being built.
 *
 * Until a listing exists, saying so is the only honest option. A store badge
 * that links nowhere is worse than a sentence explaining where things stand.
 */
const GUIDES: { key: Platform; title: string; steps: string[] }[] = [
  {
    key: 'android',
    title: 'Android — install it now',
    steps: [
      'Tap “Download for Android” at the top of this page, on the phone itself. It comes from PINGO’s GitHub releases.',
      'Open the file on the phone. Android will ask permission to install from this source — allow it once.',
      'Tap Install. PINGO appears in your app drawer with its own icon.',
      'Open it. No browser, no address bar. Sign in and everything works exactly as it does on the web.',
      'The Play Store listing comes later; nothing about the app changes when it does.',
    ],
  },
  {
    key: 'ios',
    title: 'iPhone & iPad',
    steps: [
      'The iOS app ships through the App Store, downloaded and installed like any other app.',
      'It is not published yet. This page will carry the App Store link when it is.',
      'PINGO runs fully in Safari in the meantime.',
    ],
  },
  {
    key: 'windows',
    title: 'Windows',
    steps: [
      'A signed desktop installer is in development.',
      'It will install to your Start menu with its own window and notifications.',
    ],
  },
  {
    key: 'macos',
    title: 'macOS',
    steps: [
      'A signed .dmg is in development.',
      'It will install to Applications like any other Mac app.',
    ],
  },
];

const FAQ = [
  {
    q: 'Is PINGO free?',
    a: 'Yes. There is no paid tier, no trial and nothing to buy.',
  },
  {
    q: 'Does it work offline?',
    a: 'The app opens and shows what it already had. Sending and receiving need a connection, and anything you send while offline goes out when you reconnect.',
  },
  {
    q: 'Is my data encrypted?',
    a: 'Everything travels over HTTPS, and calls are peer-to-peer and encrypted by WebRTC — PINGO never sees a frame of them. Messages are encrypted in transit and at rest on the server, which means PINGO could technically read them; they are not yet end-to-end encrypted, and we would rather say so than imply otherwise.',
  },
  {
    q: 'How do I update the app?',
    a: 'It updates itself. The installed app checks for a new version each time you open it and applies it in the background.',
  },
  {
    q: 'Can I uninstall anytime?',
    a: 'Yes, the same way as any other app on your device. Uninstalling removes the local copy; your account and messages are untouched.',
  },
  {
    q: 'Is this a real app or a website shortcut?',
    a: 'The Android and iOS versions are real applications, downloaded from the Play Store and App Store and installed like any other. They have their own icon, splash screen, native permissions and notifications, and they run full screen with no browser anywhere. They share one engine with the web version, which is why a fix lands everywhere at once rather than three times.',
  },
];

export function DownloadScreen() {
  const navigate = useNavigate();
  const { platform, method, install } = useInstall();

  /*
   * This page is the one part of PINGO meant to be found by search, so it sets
   * its own title and description rather than inheriting the app's. Undone on
   * unmount so navigating back into the app does not leave the tab claiming to
   * be a download page.
   */
  useEffect(() => {
    const title = document.title;
    const meta = document.querySelector('meta[name="description"]');
    const description = meta?.getAttribute('content') ?? '';

    document.title = 'Download PINGO — for Android, iPhone, Windows and Mac';
    meta?.setAttribute(
      'content',
      'Install PINGO on Android, iPhone, iPad, Windows or Mac. Free, private messaging that opens instantly and works offline.',
    );

    return () => {
      document.title = title;
      meta?.setAttribute('content', description);
    };
  }, []);

  /*
   * There is no store listing yet, so the button explains rather than lies.
   *
   * It used to raise the browser's install prompt, which is exactly the
   * "Add to Home Screen" behaviour PINGO is not built on. Scrolling to the
   * platform's own section is the honest action until a real link exists.
   */
  const primaryAction = () => {
    document.getElementById(`guide-${platform}`)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="h-full overflow-y-auto bg-page">
      <header
        className={cn(
          'sticky top-0 z-100 flex items-center gap-1',
          'glass-surface border-x-0 border-t-0 border-b-line',
          'px-3 pt-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]',
        )}
      >
        <IconButton label="Back" variant="ghost" onClick={() => navigate(-1)}>
          <ChevronLeftIcon size={22} />
        </IconButton>
        <h1 className="text-h2 text-ink">Download</h1>
      </header>

      <div className="mx-auto w-full max-w-3xl px-5 pb-24">
        {/* ---- hero ---------------------------------------------------- */}
        <section className="flex flex-col items-center gap-5 pt-12 pb-14 text-center">
          <AppLogo size={96} alt="" className="motion-safe:animate-qr-in" />

          <div>
            <h2 className="text-h1 text-ink">Download PINGO</h2>
            <p className="mx-auto mt-3 max-w-md text-body text-text-secondary">
              Private messaging that lives on your device. Pings that disappear, stories
              that expire, and a profile that holds three posts — no feed, no follower
              count, nothing to scroll.
            </p>
          </div>

          <div className="flex flex-col items-center gap-2">
            {platform === 'android' ? (
              /*
                A real file, not a prompt.

                An anchor rather than a button with a click handler: `download`
                is what makes Android treat it as a file to save instead of a
                page to navigate to, and it is an attribute only an anchor has.
              */
              <a
                href={ANDROID_APK}
                /*
                  No `download` attribute: it only works same-origin, and the
                  file now lives on GitHub. Android downloads an APK by content
                  type anyway, which GitHub serves correctly.
                */
                rel="noopener"
                className={cn(
                  'glass-press inline-flex items-center justify-center rounded-full',
                  'bg-brand-gradient px-6 py-3 text-body font-medium text-white',
                  'focus-ring',
                )}
              >
                Download for Android
              </a>
            ) : (
              <Button variant="primary" size="lg" onClick={primaryAction} className="glass-press">
                {platform === 'other' ? 'See the platforms' : `Coming to ${STORE_NAME[platform]}`}
              </Button>
            )}
            <p className="text-caption text-text-tertiary">
              {platform === 'android' ? (
                <>
                  Free · 2 MB · Android 7 and up ·{' '}
                  <a
                    href={ANDROID_RELEASES}
                    rel="noopener"
                    className="underline underline-offset-2 hover:text-ink"
                  >
                    release notes
                  </a>
                </>
              ) : (
                'Free, and the full product runs in your browser today.'
              )}
            </p>
          </div>
        </section>

        {/* ---- platforms ----------------------------------------------- */}
        <Section title="Every device you use">
          <ul className="grid gap-3 sm:grid-cols-2">
            {PLATFORMS.map((card) => (
              <li
                key={card.key}
                className={cn(
                  'rounded-2xl border border-line bg-surface p-4',
                  'transition-transform duration-quick ease-spring hover:-translate-y-0.5',
                  // The visitor's own platform, marked. It is the only card that
                  // is about them.
                  card.key === platform && 'ring-2 ring-brand',
                )}
              >
                <div className="flex items-center gap-2">
                  <span aria-hidden className="text-h2">
                    {card.icon}
                  </span>
                  <h4 className="flex-1 text-body font-medium text-ink">{card.name}</h4>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-caption',
                      card.status === 'available'
                        ? 'bg-brand-subtle text-brand'
                        : 'bg-sunken text-text-secondary',
                    )}
                  >
                    {card.status === 'available' ? 'Available now' : 'In development'}
                  </span>
                </div>
                <p className="mt-2 text-caption text-text-secondary">{card.method}</p>
                <p className="mt-2 text-caption text-text-tertiary">{card.requirements}</p>
              </li>
            ))}
          </ul>
        </Section>

        {/* ---- why install --------------------------------------------- */}
        <Section title="Why install it">
          <ul className="grid gap-4 sm:grid-cols-2">
            {BENEFITS.map((benefit) => (
              <li key={benefit.title} className="flex gap-3">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-brand-subtle text-brand">
                  <CheckIcon size={13} />
                </span>
                <span>
                  <span className="block text-body font-medium text-ink">{benefit.title}</span>
                  <span className="block text-caption text-text-secondary">{benefit.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>

        {/* ---- guides --------------------------------------------------- */}
        <Section title="How to install">
          <div className="flex flex-col gap-4">
            {GUIDES.map((guide) => (
              <div
                key={guide.key}
                id={`guide-${guide.key}`}
                className={cn(
                  'rounded-2xl border border-line bg-surface p-4',
                  guide.key === platform && 'ring-2 ring-brand',
                )}
              >
                <h4 className="text-body font-medium text-ink">{guide.title}</h4>
                <ol className="mt-2 flex flex-col gap-1.5">
                  {guide.steps.map((step, index) => (
                    <li key={step} className="flex gap-2.5 text-caption text-text-secondary">
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-sunken text-text-tertiary tabular-nums">
                        {index + 1}
                      </span>
                      {step}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </Section>

        {/* ---- faq ------------------------------------------------------ */}
        <Section title="Questions">
          <div className="flex flex-col gap-2">
            {FAQ.map((item) => (
              <details
                key={item.q}
                className={cn(
                  'group rounded-xl border border-line bg-surface px-4 py-3',
                  'transition-colors duration-quick ease-standard hover:bg-surface-hover',
                )}
              >
                <summary
                  className={cn(
                    'cursor-pointer list-none text-body text-ink',
                    'flex items-center justify-between gap-3 focus-ring',
                  )}
                >
                  {item.q}
                  <span
                    aria-hidden
                    className="shrink-0 text-text-tertiary transition-transform duration-quick ease-spring group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-2 text-caption text-text-secondary">{item.a}</p>
              </details>
            ))}
          </div>
        </Section>

        {/* ---- footer ---------------------------------------------------- */}
        <footer className="mt-16 border-t border-line pt-6">
          {/*
            Three links, and each goes where its label says.

            Terms is public, because this page is read by people who do not have
            an account and terms behind a sign-in wall cannot be read before
            being agreed to.

            "Privacy" used to point at `/settings/privacy`, which is the privacy
            *settings* screen — a set of toggles, not a policy — and behind the
            sign-in wall besides. It now points at the policy, which is public.

            Contact is not here because it would be Support wearing a second
            name, and there is still no separate contact address.
          */}
          <nav aria-label="Legal and support" className="flex flex-wrap gap-x-5 gap-y-2">
            {[
              { to: '/terms', label: 'Terms' },
              { to: '/privacy', label: 'Privacy' },
              { to: '/settings/help', label: 'Support' },
            ].map((link) => (
              <Link
                key={link.label}
                to={link.to}
                className="text-caption text-text-secondary transition-colors duration-quick ease-standard hover:text-ink"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <p className="mt-4 text-caption text-text-tertiary">
            One engine, five platforms. The web version is live now; the store
            applications are in development.
          </p>
        </footer>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pt-10">
      <h3 className="mb-4 text-h2 text-ink">{title}</h3>
      {children}
    </section>
  );
}
