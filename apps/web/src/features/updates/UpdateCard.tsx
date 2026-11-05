import { cn } from '@pingo/ui';
import { ArrowDownToLine, Check, RotateCw, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import { AppLogo } from '../../components/AppLogo.js';
import { formatSize, type UpdateStage } from './app-update.js';

/**
 * The update screen: one calm thing happening, with what changed underneath.
 *
 * ## The idea
 *
 * An update is a small ceremony, and the best ones (a phone's own app update,
 * the App Store's) all have the same shape: the app's icon in the middle, one
 * line about what is happening, one control, and below it, quietly, what is new.
 * This is that shape in PINGO's own voice - soft surface, one accent, plenty of
 * air - and it does not change between stages. The ring around the icon fills
 * while it downloads; the line and the control under it change; "What is new"
 * stays where it is, so nothing jumps and nothing is hidden while you wait.
 *
 * One layout, two jobs:
 *
 *   `sheet`   a gentle prompt over the app, which can be put off
 *   `screen`  the page for a build the server has turned away, which cannot
 */

export interface UpdateCardProps {
  mode: 'sheet' | 'screen';
  /** "2.26.44.4", when known. */
  version?: string | undefined;
  /** The APK's size in bytes, when known. */
  bytes?: number | undefined;
  /** A few lines on what changed. */
  notes?: string[] | undefined;
  stage: UpdateStage;
  /** False when "Update" opens the browser rather than updating here. */
  inApp: boolean;
  /** A web page, not the Android app: there is no file, so the one action is to reload. */
  web?: boolean | undefined;
  onUpdate: () => void;
  onInstall: () => void;
  onAllow: () => void;
  onCancel: () => void;
  /** `sheet` only: put it off. */
  onLater?: (() => void) | undefined;
  /** The download page, for anybody the in-app update does not work for. */
  fallbackHref: string;
}

export function UpdateCard(props: UpdateCardProps) {
  if (props.mode === 'sheet') {
    return (
      <div
        className="fixed inset-0 z-[900] flex items-end justify-center bg-black/40 backdrop-blur-[2px] sm:items-center sm:p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
      >
        <div className="relative max-h-[94dvh] w-full max-w-md overflow-y-auto rounded-t-[32px] bg-surface pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-12px_48px_rgba(16,17,20,0.16)] motion-safe:animate-panel-in sm:rounded-[32px]">
          <span aria-hidden className="mx-auto mt-2.5 block h-1 w-9 rounded-full bg-line" />
          <Content {...props} />
          {props.onLater ? (
            <button
              type="button"
              onClick={props.onLater}
              className="focus-ring mx-auto mt-1 block h-11 rounded-full px-6 text-[14.5px] font-medium text-text-secondary active:bg-sunken"
            >
              Not now
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[2000] overflow-y-auto bg-page"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="update-title"
      aria-describedby="update-body"
    >
      {/* The sweep, far off and out of focus: the page is calm, and still recognisably PINGO. */}
      <div aria-hidden className="bg-sweep update-ambient pointer-events-none fixed inset-x-0 top-0 h-96 blur-3xl" />
      <div className="relative mx-auto flex min-h-full w-full max-w-sm flex-col justify-center py-8 motion-safe:animate-panel-in">
        <Content {...props} />
      </div>
    </div>
  );
}

/** What each stage says: a small label, and one line under the title. */
function wording(stage: UpdateStage, screen: boolean, web: boolean | undefined): { label: string; line: string } {
  switch (stage.kind) {
    case 'downloading':
      return { label: 'Updating', line: 'Keep PINGO open. It takes about a minute.' };
    case 'install':
      return { label: 'Ready', line: 'Tap Install in the Android window to finish.' };
    case 'permission':
      return { label: 'One last step', line: 'Android asks once before PINGO can install an update.' };
    case 'error':
      return { label: 'Not finished', line: stage.message };
    default:
      if (web) return { label: 'Update available', line: 'A newer version is out. Reload to get it.' };
      return screen
        ? { label: 'Update required', line: 'This version can no longer connect. Update to keep going - everything stays as it is.' }
        : { label: 'Update available', line: 'Your chats, photos and account stay exactly as they are.' };
  }
}

function Content({ mode, version, bytes, notes, stage, inApp, web, onUpdate, onInstall, onAllow, onCancel, fallbackHref }: UpdateCardProps) {
  const screen = mode === 'screen';
  const { label, line } = wording(stage, screen, web);
  const pct = stage.kind === 'downloading' && stage.total > 0 ? Math.min(100, Math.max(0, Math.round((stage.received / stage.total) * 100))) : 0;

  return (
    <div className="px-6 pb-3 pt-6 text-center">
      <Icon progress={stage.kind === 'downloading' ? pct : stage.kind === 'install' ? 100 : null} />

      <p className="mt-5 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">{label}</p>
      <h1 id="update-title" className="mt-1.5 text-[27px] font-bold leading-tight tracking-[-0.045em] text-ink">
        PINGO{version ? <span className="ml-2 font-semibold tabular-nums text-text-secondary">{version}</span> : null}
      </h1>
      <p id="update-body" className={cn('mx-auto mt-2 max-w-[19.5rem] text-[15px] leading-snug', stage.kind === 'error' ? 'text-danger' : 'text-text-secondary')}>
        {line}
      </p>

      {/* The one control. A fixed-height slot, so the page does not move as the stages change. */}
      <div className="mt-6 flex h-[116px] flex-col justify-start">
        <Action stage={stage} pct={pct} inApp={inApp} web={web} onUpdate={onUpdate} onInstall={onInstall} onAllow={onAllow} onCancel={onCancel} fallbackHref={fallbackHref} />
      </div>

      {!web ? <Facts bytes={bytes} /> : null}

      {notes && notes.length > 0 ? <WhatsNew version={version} notes={notes} /> : null}
    </div>
  );
}

/**
 * The app's icon, and a ring around it that fills as the download goes.
 *
 * The ring is always laid out - empty it is a faint circle that frames the icon -
 * so the icon does not shift when it starts to fill.
 */
function Icon({ progress }: { progress: number | null }) {
  const size = 124;
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = progress === null ? 0 : progress;
  return (
    <div
      className="relative mx-auto grid place-items-center"
      style={{ width: size, height: size }}
      {...(progress !== null && progress < 100 ? { role: 'progressbar', 'aria-label': 'Downloading the update', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': progress } : {})}
    >
      <span aria-hidden className="bg-sweep update-glow absolute inset-3 rounded-[34px] blur-2xl" />
      <svg aria-hidden width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-line" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          className="stroke-brand transition-[stroke-dashoffset] duration-300 ease-standard"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - filled / 100)}
          style={{ opacity: progress === null ? 0 : 1 }}
        />
      </svg>
      <AppLogo size={88} tile alt="" className="relative shadow-[0_10px_28px_-10px_rgba(52,30,110,0.4)]" />
    </div>
  );
}

/** The one thing to do right now, whichever stage the update is at. */
function Action({
  stage,
  pct,
  inApp,
  web,
  onUpdate,
  onInstall,
  onAllow,
  onCancel,
  fallbackHref,
}: Pick<UpdateCardProps, 'stage' | 'inApp' | 'web' | 'onUpdate' | 'onInstall' | 'onAllow' | 'onCancel' | 'fallbackHref'> & { pct: number }) {
  switch (stage.kind) {
    case 'downloading':
      return (
        <div>
          <p className="text-[34px] font-semibold leading-none tracking-[-0.04em] tabular-nums text-ink">
            {stage.total > 0 ? pct : '…'}
            {stage.total > 0 ? <span className="ml-0.5 text-[18px] font-medium text-text-tertiary">%</span> : null}
          </p>
          {stage.total > 0 ? (
            <p className="mt-2 text-[13px] tabular-nums text-text-secondary">
              {formatSize(stage.received)} of {formatSize(stage.total)}
            </p>
          ) : null}
          <button type="button" onClick={onCancel} className="focus-ring mx-auto mt-3 rounded-md px-2 py-1 text-[13px] font-medium text-text-tertiary">
            Cancel
          </button>
        </div>
      );
    case 'install':
      return (
        <div className="flex flex-col gap-2.5">
          <PillButton onClick={onInstall} icon={<Check size={18} aria-hidden />}>
            Install
          </PillButton>
          <Hint>Downloaded and checked. Nothing else leaves your phone.</Hint>
        </div>
      );
    case 'permission':
      return (
        <div className="flex flex-col gap-3">
          <PillButton onClick={onAllow} icon={<ShieldCheck size={18} aria-hidden />}>
            Open settings
          </PillButton>
          <Hint>
            Turn on <b className="font-semibold text-text-secondary">Allow from this source</b>, then come back. The update starts by itself.
          </Hint>
        </div>
      );
    case 'error':
      return (
        <div className="flex flex-col gap-2.5">
          <PillButton onClick={onUpdate} icon={<RotateCw size={17} aria-hidden />}>
            Try again
          </PillButton>
          <a href={fallbackHref} target="_blank" rel="noopener" className="focus-ring mx-auto rounded-md px-1 py-0.5 text-[12.5px] font-medium text-text-secondary underline underline-offset-2">
            Or download it in your browser
          </a>
        </div>
      );
    default:
      if (web) {
        return (
          <div className="flex flex-col gap-2.5">
            <PillButton onClick={onUpdate} icon={<RotateCw size={17} aria-hidden />}>
              Load the new version
            </PillButton>
          </div>
        );
      }
      return (
        <div className="flex flex-col gap-2.5">
          <PillButton onClick={onUpdate} icon={<ArrowDownToLine size={18} aria-hidden />}>
            Update
          </PillButton>
          <Hint>{inApp ? 'It downloads here. Android asks you to confirm.' : 'It downloads in your browser. Android asks you to confirm.'}</Hint>
        </div>
      );
  }
}

/** Size, time and a check: three small facts in a row, the way a store lays out a listing. */
function Facts({ bytes }: { bytes?: number | undefined }) {
  return (
    <dl className="mt-7 grid grid-cols-3 divide-x divide-line">
      <Fact term="Size" value={bytes ? formatSize(bytes) : 'Small'} />
      <Fact term="Time" value="~1 min" />
      <Fact term="Checked" value="Yes" />
    </dl>
  );
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div className="px-2">
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">{term}</dt>
      <dd className="mt-1 text-[15px] font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

/** What changed. Always on screen, whatever the update is doing. */
function WhatsNew({ version, notes }: { version?: string | undefined; notes: string[] }) {
  return (
    <section className="mt-6 rounded-[26px] bg-sunken/70 px-5 py-4 text-left" aria-label="What is new">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold text-ink">What is new</h2>
        {version ? <span className="text-[12px] tabular-nums text-text-tertiary">{version}</span> : null}
      </div>
      <ul className="mt-2.5 flex flex-col gap-2.5">
        {notes.map((note) => (
          <li key={note} className="flex min-w-0 items-start gap-3 text-[14px] leading-snug text-text-secondary">
            <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-brand" />
            <span className="min-w-0">{note}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PillButton({ onClick, icon, children }: { onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="update-pill focus-ring flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-brand text-[16px] font-semibold text-on-brand transition-transform duration-instant active:scale-[0.98]"
    >
      {icon}
      {children}
    </button>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="mx-auto max-w-[19rem] text-[12.5px] leading-snug text-text-tertiary">{children}</p>;
}
