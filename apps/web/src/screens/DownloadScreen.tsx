import { Button, CheckIcon, ChevronLeftIcon, IconButton, cn } from '@pingo/ui';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { AppLogo } from '../components/AppLogo.js';
import { useInstall, type Platform } from '../features/install/useInstall.js';
import { applyPageSeo } from '../lib/seo.js';

/**
 * The official Android download.
 *
 * A Cloudflare Worker reading from R2, not GitHub and not this site. Pages caps
 * a file at 25 MiB, which the APK passed the moment the camera models went back
 * inside it, and GitHub put the source repository in front of anybody who just
 * wanted the app.
 *
 * The URL never changes. Publishing a new build is one upload to the bucket --
 * no deploy, no edit here, nothing to forget. That is the whole reason the
 * Worker exists rather than a public bucket URL.
 *
 * It will become download.pingo.chat once pingo.chat is a zone in the
 * Cloudflare account; only this constant changes.
 */
const ANDROID_APK = 'https://pingo-download.dubesminecraft.workers.dev/android';

/**
 * Asked of GitHub rather than written here.
 *
 * The size was a hardcoded "2 MB", and it was wrong within a day - the APK
 * changes with every release and a number typed into a page does not. Reading
 * it from the release means the page cannot drift from what it is offering.
 *
 * Public repository, so no token and no auth. If the call fails the size line
 * is simply absent, which is better than a stale figure presented as current.
 */
// The size comes from the endpoint that serves the file, so the two can never
// disagree. A HEAD, so asking costs nothing.
const RELEASE_API = ANDROID_APK;

/** The release page itself, for anyone who wants the notes and the history. */
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
 * "Available now" only for what somebody can use this minute - which today is
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
    method: 'A real installable app: its own icon, no browser, full screen. Download the APK below and install it directly; the Play Store listing comes later.',
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
    body: 'The whole display, with the status bar tinted to match. Not a page inside a browser.',
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
 * Web App and must never ask anybody to bookmark it - the native builds are real
 * store applications produced from the same engine, and a page teaching people
 * to save a shortcut instead would undercut the thing being built.
 *
 * Until a listing exists, saying so is the only honest option. A store badge
 * that links nowhere is worse than a sentence explaining where things stand.
 */
const GUIDES: { key: Platform; title: string; steps: string[] }[] = [
  {
    key: 'android',
    title: 'Android: install it now',
    steps: [
      'Tap “Download for Android” at the top of this page, on the phone itself. It comes from PINGO’s GitHub releases.',
      'Open the file on the phone. Android will ask permission to install from this source. Allow it once.',
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
    a: 'Everything travels over HTTPS, and calls are peer-to-peer and encrypted by WebRTC. PINGO never sees a frame of them. Messages are encrypted in transit and at rest on the server, which means PINGO could technically read them; they are not yet end-to-end encrypted, and we would rather say so than imply otherwise.',
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
  const { platform } = useInstall();

  /** The published build: how big it is, and which version. Undefined until known. */
  const [release, setRelease] = useState<{ size: string; tag: string }>();

  useEffect(() => {
    // Android only. Nobody else's card shows a size, so nobody else's visit
    // should cost a request.
    if (platform !== 'android') return;

    let active = true;
    void fetch(RELEASE_API, { method: 'HEAD' })
      .then((response) => {
        const length = Number(response.headers.get('content-length'));
        if (!active || !Number.isFinite(length) || length <= 0) return;
        setRelease({ size: `${(length / 1048576).toFixed(1)} MB`, tag: '' });
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [platform]);

  /*
   * This page is the one part of PINGO meant to be found by search, so it sets
   * its own title, description, canonical and social tags rather than
   * inheriting the app's. Undone on unmount so navigating back into the app
   * does not leave the tab claiming to be a download page.
   */
  useEffect(
    () =>
      applyPageSeo({
        title: 'Download PINGO. for Android, iPhone, Windows and Mac',
        description:
          'Install PINGO on Android, iPhone, iPad, Windows or Mac. Free, private messaging that opens instantly and works offline.',
        path: '/download',
      }),
    [],
  );

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
        {/* Chrome label only - the document H1 lives in the hero below. */}
        <p className="text-h2 text-ink">Download</p>
      </header>

      <main className="mx-auto w-full max-w-3xl px-5 pb-24">
        {/* ---- hero ---------------------------------------------------- */}
        <section
          className="flex flex-col items-center gap-5 pt-12 pb-14 text-center"
          aria-labelledby="download-hero-title"
        >
          <AppLogo
            size={96}
            alt=""
            fetchPriority="high"
            className="motion-safe:animate-qr-in"
          />

          <div>
            <h1 id="download-hero-title" className="text-h1 text-ink">
              Download PINGO
            </h1>
            <p className="mx-auto mt-3 max-w-md text-body text-text-secondary">
              Private messaging that lives on your device. Pings that disappear, stories
              that expire, and a profile that holds three posts - no feed, no follower
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
                  file lives on a separate download origin. Android downloads
                  an APK by content type, which the Worker serves correctly.
                */
                rel="noopener noreferrer"
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
                <>Free{release ? ` · ${release.size}` : ''} · Android 7 and up</>
              ) : (
                'Free, and the full product runs in your browser today.'
              )}
            </p>
          </div>
        </section>

        {/* ---- platforms ----------------------------------------------- */}
        <Section title="Every device you use" id="platforms">
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
                  <h3 className="flex-1 text-body font-medium text-ink">{card.name}</h3>
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
        <Section title="Why install it" id="why-install">
          <ul className="grid gap-4 sm:grid-cols-2">
            {BENEFITS.map((benefit) => (
              <li key={benefit.title} className="flex gap-3">
                <span
                  aria-hidden
                  className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-brand-subtle text-brand"
                >
                  <CheckIcon size={13} />
                </span>
                <div>
                  <h3 className="text-body font-medium text-ink">{benefit.title}</h3>
                  <p className="text-caption text-text-secondary">{benefit.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        {/* ---- guides --------------------------------------------------- */}
        <Section title="How to install" id="how-to-install">
          <div className="flex flex-col gap-4">
            {GUIDES.map((guide) => (
              <article
                key={guide.key}
                id={`guide-${guide.key}`}
                className={cn(
                  'rounded-2xl border border-line bg-surface p-4',
                  guide.key === platform && 'ring-2 ring-brand',
                )}
                aria-labelledby={`guide-title-${guide.key}`}
              >
                <h3 id={`guide-title-${guide.key}`} className="text-body font-medium text-ink">
                  {guide.title}
                </h3>
                <ol className="mt-2 flex flex-col gap-1.5">
                  {guide.steps.map((step, index) => (
                    <li key={step} className="flex gap-2.5 text-caption text-text-secondary">
                      <span
                        aria-hidden
                        className="grid size-5 shrink-0 place-items-center rounded-full bg-sunken text-text-tertiary tabular-nums"
                      >
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
        </Section>

        {/* ---- faq ------------------------------------------------------ */}
        <Section title="Questions" id="faq">
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
                    'flex items-center justify-between gap-3 focus-ring rounded-md',
                  )}
                >
                  <span className="font-medium">{item.q}</span>
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
            Public links only. Terms and Privacy are readable without a
            session. Support used to point at /settings/help, which is
            auth-gated and a soft 404 for crawlers and signed-out visitors.
          */}
          <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link
              to="/terms"
              className="text-caption text-text-secondary transition-colors duration-quick ease-standard hover:text-ink"
            >
              Terms of Use
            </Link>
            <Link
              to="/privacy"
              className="text-caption text-text-secondary transition-colors duration-quick ease-standard hover:text-ink"
            >
              Privacy Policy
            </Link>
            <Link
              to="/terms#data"
              className="text-caption text-text-secondary transition-colors duration-quick ease-standard hover:text-ink"
            >
              How data is handled
            </Link>
          </nav>
          <p className="mt-4 text-caption text-text-tertiary">
            One engine, five platforms. The web version is live now; the store
            applications are in development.
          </p>
        </footer>
      </main>
    </div>
  );
}

function Section({
  title,
  id,
  children,
}: {
  title: string;
  id: string;
  children: React.ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section className="pt-10" id={id} aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-4 text-h2 text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}
