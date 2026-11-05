import { cn } from '@pingo/ui';
import { Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

import type { UpdateStage } from './app-update.js';

/**
 * The update screen, in PINGO AI's world.
 *
 * ## What it is trying to be
 *
 * Friendly, not technical. Nobody updating a chat app wants to read a size, a
 * version, a checksum or the name of an Android setting; they want to be told
 * something nice is ready, press one button, and have it be over. So this is
 * Pingo - the mascot from PINGO AI - floating on its clouds over the same soft
 * lavender, a few plain words, one big button, and a short "what is new" for
 * anybody curious. Everything the update does that is not their business (the
 * download's size, the signature check, the install permission's real name)
 * still happens; it just is not on the screen.
 *
 * The look is `.pingo-pastel`, the palette PINGO AI's own pages use, so it is
 * light by day and a deep indigo at night with no extra work.
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

export function UpdateCard(props: UpdateCardProps) {
  if (props.mode === 'sheet') {
    return (
      <div
        className="fixed inset-0 z-[900] flex items-end justify-center bg-black/35 backdrop-blur-[2px] sm:items-center sm:p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
      >
        <div className="pingo-pastel relative max-h-[94dvh] w-full max-w-md overflow-y-auto rounded-t-[34px] pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-12px_48px_rgba(30,26,80,0.18)] motion-safe:animate-panel-in sm:rounded-[34px]">
          <span aria-hidden className="mx-auto mt-2.5 block h-1 w-9 rounded-full bg-[var(--pp-line)]" />
          <Content {...props} compact />
          {props.onLater ? (
            <button
              type="button"
              onClick={props.onLater}
              className="focus-ring mx-auto mt-1 block h-11 rounded-full px-6 text-[15px] font-medium text-[var(--pp-sub)] active:bg-[var(--pp-accent-soft)]"
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
      className="pingo-pastel fixed inset-0 z-[2000] overflow-y-auto"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="update-title"
      aria-describedby="update-body"
    >
      <div className="relative mx-auto flex min-h-full w-full max-w-sm flex-col justify-center py-8 motion-safe:animate-panel-in">
        <Content {...props} />
      </div>
    </div>
  );
}

/** What each stage says. Plain words, no numbers. */
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
      if (web) return { title: 'PINGO just got better', line: 'Reload to see the latest version.' };
      return screen
        ? { title: 'Time for a quick update', line: 'PINGO needs a refresh to keep working. Your chats and photos stay just as they are.' }
        : { title: 'PINGO just got better', line: 'A fresh version is ready. Your chats and photos stay just as they are.' };
  }
}

function Content({ notes, stage, inApp, web, mode, onUpdate, onInstall, onAllow, onCancel, fallbackHref, compact }: UpdateCardProps & { compact?: boolean }) {
  const { title, line } = wording(stage, mode === 'screen', web);
  const pct = stage.kind === 'downloading' && stage.total > 0 ? Math.min(100, Math.max(0, Math.round((stage.received / stage.total) * 100))) : null;

  return (
    <div className="px-7 pb-3 pt-4 text-center">
      <Hero compact={compact} />

      <h1 id="update-title" className="mt-3 text-[28px] font-extrabold leading-tight tracking-[-0.03em] text-[var(--pp-ink)]">
        {title}
      </h1>
      <p id="update-body" className={cn('mx-auto mt-2 max-w-[19rem] text-[16px] leading-snug', stage.kind === 'error' ? 'text-danger' : 'text-[var(--pp-sub)]')}>
        {line}
      </p>

      {/* The one control. A fixed-height slot, so nothing moves as the stages change. */}
      <div className="mt-7 flex h-[96px] flex-col justify-start">
        <Action stage={stage} pct={pct} inApp={inApp} web={web} onUpdate={onUpdate} onInstall={onInstall} onAllow={onAllow} onCancel={onCancel} fallbackHref={fallbackHref} />
      </div>

      {notes && notes.length > 0 ? <WhatsNew notes={notes} /> : null}
    </div>
  );
}

/** Pingo, floating over its clouds, with a few stars - the same sky as PINGO AI's profile. */
function Hero({ compact }: { compact?: boolean | undefined }) {
  return (
    <div className={cn('relative mx-auto', compact ? 'h-[168px] w-[250px]' : 'h-[214px] w-[290px]')} aria-hidden>
      {/* Not clipped: a cloud with a hard edge is a white box. They sit inside the hero and fade out on their own. */}
      <div className="absolute inset-0">
        <span className="pp-cloud bottom-[8%] left-[4%] h-[26%] w-[40%] opacity-80" />
        <span className="pp-cloud bottom-[2%] left-[30%] h-[22%] w-[38%] opacity-70" />
        <span className="pp-cloud bottom-[10%] right-[4%] h-[28%] w-[40%] opacity-80" />
      </div>
      <Sparkles className="pp-twinkle absolute left-[10%] top-[26%] text-[var(--pp-gold)]" size={compact ? 20 : 24} fill="currentColor" strokeWidth={1.2} />
      <Sparkles className="pp-twinkle absolute right-[8%] top-[46%] text-[var(--pp-gold)] [animation-delay:0.9s]" size={compact ? 24 : 28} fill="currentColor" strokeWidth={1.2} />
      <Sparkles className="pp-twinkle absolute right-[22%] top-[10%] text-[#d9a8f0] [animation-delay:0.4s]" size={14} fill="currentColor" strokeWidth={1.2} />
      <span className={cn('pingo-float absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[52%]', compact ? 'size-[128px]' : 'size-[168px]')}>
        <img src="/ai/pingo.webp" alt="" draggable={false} decoding="async" className="size-full select-none object-contain" />
      </span>
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
}: Pick<UpdateCardProps, 'stage' | 'inApp' | 'web' | 'onUpdate' | 'onInstall' | 'onAllow' | 'onCancel' | 'fallbackHref'> & { pct: number | null }) {
  switch (stage.kind) {
    case 'downloading':
      return (
        <div className="pt-3">
          <div
            role="progressbar"
            aria-label="Updating PINGO"
            aria-valuemin={0}
            aria-valuemax={100}
            {...(pct !== null ? { 'aria-valuenow': pct } : {})}
            className="h-2.5 overflow-hidden rounded-full bg-[var(--pp-accent-soft)]"
          >
            <div className="h-full rounded-full bg-[var(--pp-accent)] transition-[width] duration-300 ease-standard" style={{ width: `${pct ?? 8}%` }} />
          </div>
          <button type="button" onClick={onCancel} className="focus-ring mx-auto mt-4 rounded-md px-2 py-1 text-[14px] font-medium text-[var(--pp-faint)]">
            Cancel
          </button>
        </div>
      );
    case 'install':
      return <PillButton onClick={onInstall}>Install</PillButton>;
    case 'permission':
      return <PillButton onClick={onAllow}>Continue</PillButton>;
    case 'error':
      return (
        <div className="flex flex-col items-center gap-2.5">
          <PillButton onClick={onUpdate}>Try again</PillButton>
          <a href={fallbackHref} target="_blank" rel="noopener" className="focus-ring rounded-md px-1 py-0.5 text-[13px] font-medium text-[var(--pp-sub)] underline underline-offset-2">
            Get it another way
          </a>
        </div>
      );
    default:
      if (web) return <PillButton onClick={onUpdate}>Reload</PillButton>;
      return <PillButton onClick={onUpdate}>{inApp ? 'Update' : 'Get the update'}</PillButton>;
  }
}

/** What changed: a few friendly lines on a white card, the way PINGO AI shows a list. */
function WhatsNew({ notes }: { notes: string[] }) {
  return (
    <section className="pp-card mt-5 px-5 py-4 text-left" aria-label="What is new">
      <h2 className="text-[13px] font-bold text-[var(--pp-sub)]">What is new</h2>
      <ul className="mt-2.5 flex flex-col gap-2.5">
        {notes.map((note) => (
          <li key={note} className="flex min-w-0 items-start gap-2.5 text-[15px] leading-snug text-[var(--pp-ink)]">
            <Sparkles size={15} fill="currentColor" strokeWidth={1.2} aria-hidden className="mt-[3px] shrink-0 text-[var(--pp-gold)]" />
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
      className="focus-ring flex h-[56px] w-full items-center justify-center rounded-full bg-[var(--pp-accent)] text-[17px] font-bold text-[var(--pp-accent-ink)] shadow-[var(--pp-shadow)] transition-transform duration-instant active:scale-[0.98]"
    >
      {children}
    </button>
  );
}
