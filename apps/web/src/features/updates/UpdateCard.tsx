import { cn } from '@pingo/ui';
import type { ReactNode } from 'react';

import { AppLogo } from '../../components/AppLogo.js';
import type { UpdateStage } from './app-update.js';

/**
 * The update screen: a duck in a cap, walking, and almost nothing else.
 *
 * ## What it is trying to be
 *
 * Friendly and quiet. Nobody updating a chat app wants a size, a version, a
 * checksum or the name of an Android setting; they want to be told something
 * nice is ready, press one button, and have it be over. So the page is the app's
 * own background, the duck, a few plain words and one black button - and the
 * duck IS the progress: while the update downloads it walks along a thin line
 * from one end to the other, and the line fills in behind it.
 *
 * The one accent is the duck's own beak yellow, used for that line and for the
 * dots in "What is new". Everything else is the app's ink on its page, so the
 * screen is light by day and dark at night with nothing extra to maintain.
 *
 * The duck (`/update/duck.webp`) is a transparent animated WebP made from the
 * supplied GIF by `scripts/make-update-duck.mjs`; with reduced motion it stands
 * still (`duck-still.webp`).
 *
 * One layout, two jobs:
 *
 *   `sheet`   a gentle prompt over the app, which can be put off
 *   `screen`  the page for a build the server has turned away, which cannot
 */

export interface UpdateCardProps {
  mode: 'sheet' | 'screen';
  /** The newest version and size are known to the caller; this screen deliberately does not show them. */
  version?: string | undefined;
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

/** The duck's beak. */
const BEAK = '#f4b81f';

export function UpdateCard(props: UpdateCardProps) {
  if (props.mode === 'sheet') {
    return (
      <div
        className="fixed inset-0 z-[900] flex items-end justify-center bg-black/40 backdrop-blur-[2px] sm:items-center sm:p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
      >
        <div className="relative max-h-[94dvh] w-full max-w-md overflow-y-auto rounded-t-[34px] bg-surface pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-12px_48px_rgba(16,17,20,0.16)] motion-safe:animate-panel-in sm:rounded-[34px]">
          <span aria-hidden className="mx-auto mt-2.5 block h-1 w-9 rounded-full bg-line" />
          <Brand className="absolute left-5 top-5" size={26} />
          <Content {...props} compact />
          {props.onLater ? (
            <button type="button" onClick={props.onLater} className="focus-ring mx-auto mt-1 block h-11 rounded-full px-6 text-[15px] font-medium text-text-secondary active:bg-sunken">
              Not now
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[2000] overflow-y-auto bg-page" role="alertdialog" aria-modal="true" aria-labelledby="update-title" aria-describedby="update-body">
      <Brand className="absolute left-5 top-[max(1.25rem,env(safe-area-inset-top))]" size={32} />
      <div className="relative mx-auto flex min-h-full w-full max-w-sm flex-col justify-center py-8 motion-safe:animate-panel-in">
        <Content {...props} />
      </div>
    </div>
  );
}

/** PINGO's mark and name, in the top left corner, the way a header introduces the app. */
function Brand({ className, size }: { className?: string; size: number }) {
  return (
    <div className={cn('z-[1] flex items-center gap-2', className)}>
      <AppLogo size={size} alt="" />
      <span className="text-[18px] font-bold tracking-[-0.04em] text-ink">PINGO</span>
    </div>
  );
}

/** What each stage says. Plain words, no numbers in them: the percentage sits beside the line. */
function wording(stage: UpdateStage, screen: boolean, web: boolean | undefined): { title: string; line: string } {
  switch (stage.kind) {
    case 'downloading':
      return { title: 'Updating PINGO', line: 'Hang tight, this only takes a moment.' };
    case 'install':
      return { title: 'All set!', line: 'Tap Install on the next screen to finish.' };
    case 'permission':
      return { title: 'One quick thing', line: 'Tap Allow on the next screen so PINGO can update itself.' };
    case 'error':
      return { title: 'Hmm, that did not work', line: stage.message };
    default:
      if (web) return { title: 'A fresh PINGO is ready', line: 'Reload to see the latest version.' };
      return screen
        ? { title: 'Time for a quick update', line: 'PINGO needs a refresh to keep working. Your chats and photos stay just as they are.' }
        : { title: 'A fresh PINGO is ready', line: 'Your chats and photos stay just as they are.' };
  }
}

function Content({ notes, stage, inApp, web, mode, onUpdate, onInstall, onAllow, onCancel, fallbackHref, compact }: UpdateCardProps & { compact?: boolean }) {
  const { title, line } = wording(stage, mode === 'screen', web);
  const pct = stage.kind === 'downloading' && stage.total > 0 ? Math.min(100, Math.max(0, Math.round((stage.received / stage.total) * 100))) : null;
  // Where the duck stands along its line: all the way along when done, the middle when there is nothing to measure.
  const along = stage.kind === 'install' ? 1 : stage.kind === 'downloading' ? (pct ?? 0) / 100 : 0.5;

  return (
    <div className="px-7 pb-3 pt-5 text-center">
      <Walk along={along} percent={stage.kind === 'install' ? 100 : pct} track={stage.kind === 'downloading' || stage.kind === 'install'} compact={compact} />

      <h1 id="update-title" className="mt-4 text-[28px] font-bold leading-tight tracking-[-0.04em] text-ink">
        {title}
      </h1>
      <p id="update-body" className={cn('mx-auto mt-2 max-w-[19rem] text-[16px] leading-snug', stage.kind === 'error' ? 'text-danger' : 'text-text-secondary')}>
        {line}
      </p>

      {/* The one control. A fixed-height slot, so nothing moves as the stages change. */}
      <div className="mt-7 flex h-[84px] flex-col justify-start">
        <Action stage={stage} pct={pct} inApp={inApp} web={web} onUpdate={onUpdate} onInstall={onInstall} onAllow={onAllow} onCancel={onCancel} fallbackHref={fallbackHref} />
      </div>

      {notes && notes.length > 0 ? <WhatsNew notes={notes} /> : null}
    </div>
  );
}

/**
 * The duck, and the line it walks along.
 *
 * `along` is 0 to 1: how far down the line the duck is. The duck's position is
 * one number - so "standing in the middle" is just 0.5 - and it glides between
 * values rather than jumping. The line only exists while there is something
 * to measure; the rest of the time the duck's own shadow is the ground.
 */
export function Walk({ along, percent, track, compact }: { along: number; percent: number | null; track: boolean; compact?: boolean | undefined }) {
  const width = compact ? 124 : 172;
  const height = Math.round((width * 281) / 240);
  // The room the line leaves at its right for the percentage, and the margin before it on the left.
  const LABEL = 64;
  const EDGE = 8;
  // The picture has empty room either side of the duck; the duck, not the picture, walks the line's whole length.
  const PAD = Math.round(width * 0.18);
  return (
    <div className="relative mx-auto w-full" style={{ height: height + 14 }}>
      {track ? (
        <>
          <div aria-hidden className="absolute flex items-center" style={{ bottom: 12, left: EDGE, right: LABEL }}>
            <div className="h-[3px] w-full overflow-hidden rounded-full bg-ink/10">
              <div className="h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${Math.round(along * 100)}%`, background: BEAK }} />
            </div>
          </div>
          {percent !== null ? (
            <span
              role="status"
              aria-label={`${percent} percent`}
              className="absolute right-1 text-[16px] font-semibold tabular-nums leading-none tracking-[-0.02em] text-ink"
              style={{ bottom: 5 }}
            >
              {percent}
              <span className="ml-px text-[12px] font-medium text-text-tertiary">%</span>
            </span>
          ) : null}
        </>
      ) : null}
      <picture>
        <source media="(prefers-reduced-motion: reduce)" srcSet="/update/duck-still.webp" />
        <img
          src="/update/duck.webp"
          alt=""
          width={width}
          height={height}
          draggable={false}
          decoding="async"
          className="absolute bottom-0 select-none transition-[left] duration-500 ease-out"
          style={{ left: track ? `calc(${EDGE - PAD}px + (100% - ${EDGE + LABEL}px - ${width - 2 * PAD}px) * ${along})` : `calc((100% - ${width}px) * 0.5)` }}
        />
      </picture>
    </div>
  );
}

/** The one thing to do right now, whichever stage the update is at. */
function Action({
  stage,
  inApp,
  web,
  onUpdate,
  onInstall,
  onAllow,
  onCancel,
  fallbackHref,
}: Pick<UpdateCardProps, 'stage' | 'inApp' | 'web' | 'onUpdate' | 'onInstall' | 'onAllow' | 'onCancel' | 'fallbackHref'> & { pct: number | null }) {
  switch (stage.kind) {
    case 'downloading':
      return (
        <button type="button" onClick={onCancel} className="focus-ring mx-auto mt-2 rounded-md px-3 py-2 text-[14.5px] font-medium text-text-tertiary">
          Cancel
        </button>
      );
    case 'install':
      return <PillButton onClick={onInstall}>Install</PillButton>;
    case 'permission':
      return <PillButton onClick={onAllow}>Continue</PillButton>;
    case 'error':
      return (
        <div className="flex flex-col items-center gap-2">
          <PillButton onClick={onUpdate}>Try again</PillButton>
          <a href={fallbackHref} target="_blank" rel="noopener" className="focus-ring rounded-md px-1 py-0.5 text-[13px] font-medium text-text-secondary underline underline-offset-2">
            Get it another way
          </a>
        </div>
      );
    default:
      if (web) return <PillButton onClick={onUpdate}>Reload</PillButton>;
      return <PillButton onClick={onUpdate}>{inApp ? 'Update' : 'Get the update'}</PillButton>;
  }
}

/** What changed: plain lines under a hairline, no box. */
function WhatsNew({ notes }: { notes: string[] }) {
  return (
    <section className="mt-6 border-t border-line pt-5 text-left" aria-label="What is new">
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-text-tertiary">What is new</h2>
      <ul className="mt-3 flex flex-col gap-3">
        {notes.map((note) => (
          <li key={note} className="flex min-w-0 items-start gap-3 text-[15px] leading-snug text-ink">
            <span aria-hidden className="mt-[8px] size-1.5 shrink-0 rounded-full" style={{ background: BEAK }} />
            <span className="min-w-0">{note}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PillButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring flex h-[54px] w-full items-center justify-center rounded-full bg-ink text-[16.5px] font-semibold text-page transition-transform duration-instant active:scale-[0.98]"
    >
      {children}
    </button>
  );
}
