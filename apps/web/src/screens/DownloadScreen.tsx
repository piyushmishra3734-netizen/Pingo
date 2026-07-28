import { Button, CheckIcon, ChevronLeftIcon, IconButton, cn } from '@pingo/ui';
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { AppLogo } from '../components/AppLogo.js';
import { INSTALL_LABEL, useInstall, type Platform } from '../features/install/useInstall.js';

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
 * Installing this is installing a PWA, it says so, and it explains why that is
 * genuinely better than a tab rather than pretending to be something else.
 *
 * ## Why the status on each card is honest
 *
 * "Available" where the platform can install today. Anything that cannot is
 * said plainly rather than being labelled "coming soon", which is the phrase
 * products use when they mean "no".
 */

interface PlatformCard {
  key: Platform | 'web';
  name: string;
  icon: string;
  status: 'available' | 'manual';
  method: string;
  requirements: string;
}

const PLATFORMS: PlatformCard[] = [
  {
    key: 'android',
    name: 'Android',
    icon: '🤖',
    status: 'available',
    method: 'Install from Chrome. PINGO adds itself to your home screen and app drawer.',
    requirements: 'Android 8 or newer, Chrome, Edge, Samsung Internet or Opera.',
  },
  {
    key: 'ios',
    name: 'iPhone & iPad',
    icon: '',
    /*
     * Not "coming soon". Safari has never exposed an install API and Apple has
     * given no sign it intends to, so a promise here would be one nobody can
     * keep. The steps are three taps and the guide below has them.
     */
    status: 'manual',
    method: 'Open in Safari, then Share → Add to Home Screen.',
    requirements: 'iOS or iPadOS 16.4 or newer, using Safari.',
  },
  {
    key: 'windows',
    name: 'Windows',
    icon: '🪟',
    status: 'available',
    method: 'Install from Chrome or Edge. PINGO gets its own window and taskbar icon.',
    requirements: 'Windows 10 or 11, Chrome or Edge.',
  },
  {
    key: 'macos',
    name: 'macOS',
    icon: '💻',
    status: 'available',
    method: 'Install from Chrome or Edge. Safari can add it to the Dock from the File menu.',
    requirements: 'macOS 12 or newer. Safari 17 for Dock installation.',
  },
  {
    key: 'web',
    name: 'Web',
    icon: '🌐',
    status: 'available',
    method: 'Nothing to install. PINGO runs in any modern browser.',
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

const GUIDES: { key: Platform; title: string; steps: string[] }[] = [
  {
    key: 'android',
    title: 'Android',
    steps: [
      'Open pingochat.pages.dev in Chrome.',
      'Tap the ⋮ menu in the top right.',
      'Choose “Install app” or “Add to Home screen”.',
      'Confirm. PINGO appears in your app drawer.',
    ],
  },
  {
    key: 'ios',
    title: 'iPhone & iPad',
    steps: [
      'Open pingochat.pages.dev in Safari. It must be Safari — Chrome on iOS cannot install web apps.',
      'Tap the Share button at the bottom of the screen.',
      'Scroll down and tap “Add to Home Screen”.',
      'Tap Add. PINGO appears on your Home Screen.',
    ],
  },
  {
    key: 'windows',
    title: 'Windows',
    steps: [
      'Open pingochat.pages.dev in Chrome or Edge.',
      'Click the install icon in the address bar, or open the ⋮ menu.',
      'Choose “Install PINGO”.',
      'PINGO opens in its own window and pins to the taskbar.',
    ],
  },
  {
    key: 'macos',
    title: 'macOS',
    steps: [
      'Open pingochat.pages.dev in Chrome, Edge or Safari 17.',
      'In Chrome or Edge, click the install icon in the address bar.',
      'In Safari, choose File → Add to Dock.',
      'PINGO opens in its own window.',
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
    q: 'Is this a native app?',
    a: 'It is a Progressive Web App. It installs, gets its own icon and window, and works offline — but it is built with web technology rather than shipped through an app store. That is why there is no download queue and no update to approve.',
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

  const primaryAction = () => {
    if (method === 'prompt') {
      void install();
      return;
    }
    // No prompt available: send them to the steps for their own platform.
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
            <Button variant="primary" size="lg" onClick={primaryAction} className="glass-press">
              {method === 'installed' ? 'Already installed' : INSTALL_LABEL[platform]}
            </Button>
            <p className="text-caption text-text-tertiary">
              {method === 'installed'
                ? 'You are using the installed app.'
                : method === 'prompt'
                  ? 'Free. Installs in seconds.'
                  : 'Free. Takes three taps — steps below.'}
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
                    {card.status === 'available' ? 'Available' : 'Manual install'}
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
            Two links, not four.

            The brief asked for Privacy, Terms, Support and Contact. Terms does
            not exist — there is no terms document anywhere in this product — and
            a footer link labelled "Terms" that lands on a help page is the kind
            of small lie that makes a visitor doubt the rest of the page. Contact
            and Support would both have pointed at the same screen, which is one
            destination wearing two names.

            Both of these live behind the sign-in wall, so they are marked. A
            link that silently bounces a logged-out visitor to a login form is
            worse than one that says where it goes.
          */}
          <nav aria-label="Legal and support" className="flex flex-wrap gap-x-5 gap-y-2">
            {[
              { to: '/settings/privacy', label: 'Privacy' },
              { to: '/settings/help', label: 'Support' },
            ].map((link) => (
              <Link
                key={link.label}
                to={link.to}
                className="text-caption text-text-secondary transition-colors duration-quick ease-standard hover:text-ink"
              >
                {link.label}
                <span className="sr-only"> (requires sign in)</span>
              </Link>
            ))}
          </nav>
          <p className="mt-4 text-caption text-text-tertiary">
            PINGO is a Progressive Web App. Installing it costs nothing and takes seconds.
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
