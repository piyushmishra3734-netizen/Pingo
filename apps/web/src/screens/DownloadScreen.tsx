import { ChevronLeftIcon, IconButton, cn } from '@pingo/ui';
import { ArrowDownToLine, Check, Copy, PackageCheck, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { AppLogo } from '../components/AppLogo.js';
import { PlatformLogo, type PlatformLogoId } from '../features/install/PlatformLogo.js';
import { useInstall } from '../features/install/useInstall.js';
import { versionName } from '../features/updates/notice-rules.js';
import { publicAppUrl } from '../lib/public-origin.js';
import { applyPageSeo } from '../lib/seo.js';
import { loadUpdateNotice } from '../lib/supabase/update-notice.js';

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
 * The page PINGO sends people to for the app, and back to for every update.
 *
 * ## Two visitors, one page
 *
 * Somebody new, who wants the app, and somebody on an old APK whom the app's
 * update prompt sent here (`?update=1`). The second has one extra thing to
 * know and it is the thing most likely to go wrong: install *over* the app
 * they have. Uninstalling first takes every chat kept on the phone with it.
 * So their page leads with "Update" and says that before anything else.
 *
 * ## Every claim is one the product keeps
 *
 * The Android app is a real installable app, sideloaded until there is a Play
 * listing. iPhone has no equivalent of an APK, so its road is Add to Home
 * Screen, which works today. Windows and Mac say "Later" because there is
 * nothing to download for them yet.
 */

interface OtherDevice {
  logo: PlatformLogoId;
  name: string;
  how: string;
  ready: boolean;
}

const OTHER_DEVICES: OtherDevice[] = [
  {
    logo: 'ios',
    name: 'iPhone & iPad',
    how: 'Open PINGO in Safari, then Share → Add to Home Screen.',
    ready: true,
  },
  { logo: 'web', name: 'Web', how: 'Nothing to install. Open it in any modern browser.', ready: true },
  { logo: 'windows', name: 'Windows', how: 'A desktop app is being built. The web works meanwhile.', ready: false },
  { logo: 'macos', name: 'Mac', how: 'A desktop app is being built. The web works meanwhile.', ready: false },
];

const FAQ = [
  {
    q: 'Is PINGO free?',
    a: 'Yes. There is no paid tier, no trial and nothing to buy.',
  },
  {
    q: 'How do I update the Android app?',
    a: 'When a new version is out, PINGO tells you when you open it and brings you to this page. Download it and install it over the app you have. Do not uninstall first: the chats kept on your phone go with the old app.',
  },
  {
    q: 'Why does Android ask about installing from Chrome?',
    a: 'Apps that do not come from the Play Store need your permission once. Allow it for your browser, install PINGO, and you can switch it off again afterwards. The Play Store listing comes later.',
  },
  {
    q: 'Is my data encrypted?',
    a: 'In transit and at rest, yes: chats travel over HTTPS, are stored encrypted by our database provider, and only the people in a conversation can read them. They are not end-to-end encrypted - that is what lets your history follow you to a new phone - and an end-to-end encrypted Private mode is being built. Calls use WebRTC encryption between devices. Full detail is in the Privacy Policy.',
  },
  {
    q: 'Is the Android app a website in disguise?',
    a: 'No. It installs like any app, with its own icon, splash screen, permissions and notifications, and runs full screen with no browser anywhere. It shares its engine with the web version, which is why a fix lands everywhere at once.',
  },
];

export function DownloadScreen() {
  const navigate = useNavigate();
  const { platform } = useInstall();
  const [params] = useSearchParams();
  const updating = params.has('update');
  const android = platform === 'android';

  /** The version on offer, from the build number the operator last published. */
  const [version, setVersion] = useState<string>();
  useEffect(() => {
    let live = true;
    void loadUpdateNotice().then((row) => {
      if (live) setVersion(versionName(row?.min_build));
    });
    return () => {
      live = false;
    };
  }, []);

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

  return (
    <div className="h-full overflow-y-auto bg-page">
      <header
        className={cn(
          'sticky top-0 z-100 flex items-center gap-1',
          'glass-surface border-x-0 border-t-0 border-b-line',
          'px-3 pb-2.5 pt-[max(0.75rem,env(safe-area-inset-top))]',
        )}
      >
        <IconButton label="Back" variant="ghost" onClick={() => navigate(-1)}>
          <ChevronLeftIcon size={22} />
        </IconButton>
        <AppLogo size={26} alt="" />
        <p className="ml-1.5 text-[17px] font-semibold text-ink">PINGO</p>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 pb-24 pt-5">
        {/* ---- hero ---------------------------------------------------- */}
        <section
          aria-labelledby="download-title"
          className="relative overflow-hidden rounded-[32px] bg-surface px-6 pb-7 pt-9 text-center shadow-[0_1px_3px_rgba(16,17,20,0.06),0_12px_40px_rgba(16,17,20,0.06)]"
        >
          <span aria-hidden className="bg-sweep pointer-events-none absolute -top-24 left-1/2 size-72 -translate-x-1/2 rounded-full opacity-20 blur-3xl" />
          <div className="relative flex flex-col items-center">
            <AppLogo size={92} alt="" tile fetchPriority="high" className="motion-safe:animate-qr-in" />
            <h1 id="download-title" className="mt-5 text-balance text-[28px] leading-tight font-bold tracking-[-0.01em] text-ink">
              {updating ? 'Update PINGO' : android ? 'PINGO for Android' : 'Get PINGO'}
            </h1>
            <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-text-secondary">
              {updating
                ? 'Download the new version and install it over the one you have. Your chats stay right where they are.'
                : 'Private messaging with Pings that disappear, stories that expire, and no feed to scroll.'}
            </p>

            {android ? (
              <>
                {/*
                  A plain link to the file. No `download` attribute: that only
                  works same-origin, and the Worker is another origin. Android
                  saves an APK by its content type, which the Worker sets.
                */}
                <a
                  href={ANDROID_APK}
                  rel="noopener noreferrer"
                  className="focus-ring bg-sweep mt-6 flex h-13 w-full max-w-xs items-center justify-center gap-2 rounded-full text-[16px] font-semibold text-white shadow-[0_8px_22px_rgba(139,93,255,0.35)] active:scale-[0.98]"
                >
                  <ArrowDownToLine size={20} />
                  {updating ? 'Download update' : 'Download for Android'}
                </a>
                <ul className="mt-4 flex flex-wrap justify-center gap-1.5" aria-label="About this download">
                  <Chip>Free</Chip>
                  {version && <Chip>Version {version}</Chip>}
                  <Chip>Android 7 and up</Chip>
                </ul>
              </>
            ) : (
              <NotOnAndroid />
            )}
          </div>
        </section>

        {/* ---- install steps (Android) ------------------------------------ */}
        {android && (
          <Section title={updating ? 'Update in three steps' : 'Install in three steps'} id="steps">
            <ol className="grid gap-3 sm:grid-cols-3">
              <Step n={1} icon={<ArrowDownToLine size={20} />} title="Download">
                Tap the button above. The file lands in your downloads.
              </Step>
              <Step n={2} icon={<ShieldCheck size={20} />} title="Allow once">
                Open it. If Android asks, let your browser install apps.
              </Step>
              <Step n={3} icon={<PackageCheck size={20} />} title={updating ? 'Update' : 'Install'}>
                {updating ? 'Tap Update. PINGO opens with everything as you left it.' : 'Tap Install, open PINGO and sign in.'}
              </Step>
            </ol>

            {/* The one mistake that loses something. Said plainly, where it is needed. */}
            <div className="mt-3 flex gap-3 rounded-2xl bg-brand/8 p-4">
              <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-surface text-brand">
                <RefreshCw size={18} />
              </span>
              <p className="text-[14px] leading-relaxed text-ink">
                <b className="font-semibold">Already have PINGO?</b> Install the new one over it. Do not uninstall
                first: chats kept on this phone would go with the old app.
              </p>
            </div>
          </Section>
        )}

        {/* ---- other devices -------------------------------------------- */}
        <Section title={android ? 'On your other devices' : 'Every device'} id="devices">
          <ul className="overflow-hidden rounded-2xl bg-surface shadow-[0_1px_3px_rgba(16,17,20,0.06)]">
            {!android && (
              <DeviceRow logo="android" name="Android" how="A real app. Open this page on the phone to download it." ready />
            )}
            {OTHER_DEVICES.map((device) => (
              <DeviceRow key={device.name} {...device} />
            ))}
          </ul>
        </Section>

        {/* ---- faq ------------------------------------------------------ */}
        <Section title="Questions" id="faq">
          <div className="overflow-hidden rounded-2xl bg-surface shadow-[0_1px_3px_rgba(16,17,20,0.06)]">
            {FAQ.map((item, index) => (
              <details key={item.q} className={cn('group', index > 0 && 'border-t border-line')} open={updating && index === 1}>
                <summary className="focus-ring flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-[15px] font-medium text-ink">
                  {item.q}
                  <span aria-hidden className="shrink-0 text-[20px] leading-none text-text-tertiary transition-transform duration-quick ease-spring group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="px-4 pb-4 text-[14px] leading-relaxed text-text-secondary">{item.a}</p>
              </details>
            ))}
          </div>
        </Section>

        {/* ---- footer ---------------------------------------------------- */}
        <footer className="border-t border-line pt-6">
          {/*
            Public links only. Terms and Privacy are readable without a
            session; the help screen is behind sign-in and would be a dead end.
          */}
          <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2">
            {[
              ['/terms', 'Terms of Use'],
              ['/privacy', 'Privacy Policy'],
              ['/terms#data', 'How data is handled'],
            ].map(([to, label]) => (
              <Link key={to} to={to!} className="text-caption text-text-secondary transition-colors duration-quick hover:text-ink">
                {label}
              </Link>
            ))}
          </nav>
        </footer>
      </main>
    </div>
  );
}

/**
 * The hero's action anywhere but an Android phone.
 *
 * There is no file to offer an iPhone or a computer, so it offers the two
 * things that work: PINGO in this browser now, and the address to open on a
 * phone for the Android app.
 */
function NotOnAndroid() {
  const address = publicAppUrl('/download').replace(/^https?:\/\//, '');
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard
      ?.writeText(`https://${address}`)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => undefined);
  };

  return (
    <div className="mt-6 flex w-full max-w-xs flex-col items-stretch gap-3">
      <Link
        to="/chats"
        className="focus-ring bg-sweep flex h-13 items-center justify-center rounded-full text-[16px] font-semibold text-white shadow-[0_8px_22px_rgba(139,93,255,0.35)] active:scale-[0.98]"
      >
        Open PINGO in your browser
      </Link>
      <div className="rounded-2xl bg-sunken p-3 text-left">
        <p className="text-[13px] text-text-secondary">For the Android app, open this on your phone:</p>
        <div className="mt-1.5 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{address}</code>
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? 'Copied' : 'Copy the address'}
            className="focus-ring grid size-9 shrink-0 place-items-center rounded-full bg-surface text-ink active:scale-95"
          >
            {copied ? <Check size={16} className="text-brand" /> : <Copy size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return <li className="rounded-full bg-sunken px-3 py-1 text-[12.5px] font-medium text-text-secondary tabular-nums">{children}</li>;
}

function Step({ n, icon, title, children }: { n: number; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 rounded-2xl bg-surface p-4 shadow-[0_1px_3px_rgba(16,17,20,0.06)] sm:flex-col">
      <span aria-hidden className="relative grid size-11 shrink-0 place-items-center rounded-2xl bg-brand/10 text-brand">
        {icon}
        <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-brand text-[11px] font-bold text-white tabular-nums">
          {n}
        </span>
      </span>
      <div>
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        <p className="mt-0.5 text-[13.5px] leading-snug text-text-secondary">{children}</p>
      </div>
    </li>
  );
}

function DeviceRow({ logo, name, how, ready }: OtherDevice) {
  return (
    <li className="flex items-center gap-3 border-b border-line px-4 py-3.5 last:border-b-0">
      <PlatformLogo platform={logo} size={36} />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-ink">{name}</p>
        <p className="text-[13px] leading-snug text-text-secondary">{how}</p>
      </div>
      <span
        className={cn(
          'shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium',
          ready ? 'bg-brand/10 text-brand' : 'bg-sunken text-text-tertiary',
        )}
      >
        {ready ? 'Ready' : 'Later'}
      </span>
    </li>
  );
}

function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  const headingId = `${id}-heading`;
  return (
    <section id={id} aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-3 px-1 text-[20px] font-semibold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}
