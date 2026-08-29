import {
  Avatar,
  Button,
  CheckIcon,
  ChevronRightIcon,
  LinkIcon,
  ShareIcon,
  Skeleton,
  cn,
} from '@pingo/ui';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ScreenHeader } from '../components/ScreenHeader.js';
import { AchievementArt } from '../features/achievements/AchievementArt.js';
import { mythicWashStyle } from '../features/achievements/MythicAura.js';
import { QrArt } from '../features/profile/QrArt.js';
import { achievementById } from '../features/achievements/registry.js';
import { referralLink } from '../features/referrals/referral-code.js';
import { usePreferences } from '../features/settings/SettingsContext.js';
import {
  fetchReferralProgress,
  type ReferralProgress,
  type ReferredFriend,
} from '../features/referrals/referrals-service.js';

/**
 * The mission, its progress, the people who advanced it and the link that does.
 *
 * ## Every number on this screen comes from the server
 *
 * The requirement, the count, the roster and whether it is unlocked are all
 * read from `referral_progress` rather than assembled here. A screen that knew
 * the target was five would be a second place the number lives, and the first
 * time an operator changed it in Controlling the app would still be asking for
 * five.
 *
 * That is also why the copy is written around the values instead of around the
 * word "five": `{count} / {required}` reads correctly at any requirement, and
 * "2 more to unlock" is arithmetic rather than a string somebody has to
 * remember to edit. The roster follows the same rule - the slots are drawn from
 * `required`, not from a literal.
 *
 * ## Why the faces are the centre of it
 *
 * The first version of this screen showed a fraction and a link, and it read as
 * a placeholder because it was one: the whole premise is that real friends
 * joined, and the screen was the only place that never said who. A row of
 * avatars with empty slots beside them is the same information as "2 / 5" and a
 * completely different thing to look at - it is a record of something that
 * happened rather than a counter going up.
 *
 * The empty slots are drawn as outlines and left unlabelled. Numbering them, or
 * captioning them "invite a friend", would turn a record into a set of chores.
 *
 * ## What is deliberately not here
 *
 * No leaderboard, no streak, no countdown, no "3 people invited today". This is
 * a private messenger and the mission is a thing you finish once; pressure
 * mechanics would be the fastest way to make it feel like a game somebody is
 * being farmed by. The reward is on screen at full size from the first visit,
 * which is the only encouragement it gets.
 */
export function MythicMissionScreen() {
  const [progress, setProgress] = useState<ReferralProgress>();
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const { preferences } = usePreferences();

  const load = useCallback(async () => {
    setProgress(await fetchReferralProgress());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const link = progress?.referralCode ? referralLink(progress.referralCode) : undefined;
  const remaining = progress ? Math.max(0, progress.required - progress.count) : 0;
  const unlocked = progress?.unlocked ?? false;
  const achievement = progress ? achievementById(progress.badgeId) : undefined;

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      navigator.vibrate?.(4);
      setCopied(true);
    } catch {
      // Refused clipboard permission. Saying nothing beats claiming a copy that
      // did not happen - the link is on screen and can be selected by hand.
      setCopied(false);
    }
  };

  const share = async () => {
    if (!link) return;
    try {
      await navigator.share?.({
        title: 'PINGO',
        text: 'Join me on PINGO.',
        url: link,
      });
    } catch {
      // Cancelled, or no share sheet on this platform. Copy is still there.
    }
  };

  return (
    /*
      The wash is the root's own background, not an element behind the content.
      Only once it is actually earned - putting it behind an unfinished mission
      would spend the moment before it arrives.
    */
    <div
      className="relative flex h-full min-h-0 flex-col bg-page"
      style={unlocked ? mythicWashStyle(preferences.mythic.accent) : undefined}
    >
      <ScreenHeader title="Mission" showBack />

      <div className="relative min-h-0 flex-1 overflow-y-auto px-5 pb-28">
        {loading ? (
          <MissionSkeleton />
        ) : !progress ? (
          <p className="text-body mt-16 text-center text-text-secondary">
            No mission is running right now.
          </p>
        ) : (
          <div className="mx-auto w-full max-w-md motion-safe:animate-fade-in">
            {/*
              The badge is the subject, so it is the first and largest thing.
              Shown at full size whether or not it is unlocked - a mission you
              cannot see the prize of is a chore.
            */}
            <div className="mt-4 flex flex-col items-center text-center">
              {achievement && (
                <AchievementArt
                  achievement={achievement}
                  size="large"
                  /*
                   * The aura is the earned state, not decoration: it appears the
                   * moment the badge is real and never before. Dimmed until then
                   * and only dimmed - no greyscale, no padlock over the artwork.
                   * A lock drawn on top of it is a reinterpretation of a piece of
                   * design that is not to be reinterpreted.
                   */
                  {...(unlocked ? { aura: preferences.mythic.aura } : { locked: true })}
                  className="transition-opacity duration-slow"
                />
              )}

              <h1
                className={cn(
                  'mt-5 font-semibold text-ink',
                  /*
                    Bigger and more tracked once it is real. The same words are
                    a label while the mission is running and a name after it,
                    and setting the finished one at the size of a section
                    heading is a good part of why this page read as the
                    unfinished page with a tick added to it.
                  */
                  unlocked ? 'text-2xl tracking-[0.12em]' : 'text-xl tracking-wide',
                )}
              >
                {progress.title}
              </h1>

              {unlocked ? (
                <EarnedMark at={progress.unlockedAt} tier={achievement?.tier} />
              ) : (
                <>
                  <p className="text-body mt-1.5 max-w-xs text-balance text-text-secondary">
                    {progress.description}
                  </p>
                  <p className="mt-6 text-4xl font-semibold tracking-tight tabular-nums text-ink">
                    {progress.count}
                    <span className="text-2xl text-text-tertiary"> / {progress.required}</span>
                  </p>
                  <p className="text-caption mt-1.5 text-text-secondary">
                    {progress.count === 0
                      ? `Refer ${progress.required} friends to unlock`
                      : remaining === 1
                        ? '1 more friend to unlock'
                        : `${remaining} more to unlock`}
                  </p>

                  {/*
                    The same fraction, drawn. Nothing here knows the number is
                    five.

                    Gone once it is earned. A full bar underneath the word
                    "Earned" is just the unfinished screen with its last segment
                    coloured in - and the row of faces below says the same thing
                    with people in it.
                  */}
                  <div
                    className="mt-5 flex w-full max-w-[16rem] gap-1.5"
                    role="progressbar"
                    aria-valuenow={progress.count}
                    aria-valuemin={0}
                    aria-valuemax={progress.required}
                    aria-label={`${progress.count} of ${progress.required} friends joined`}
                  >
                    {Array.from({ length: progress.required }, (_, i) => (
                      <span
                        key={i}
                        className={cn(
                          'h-1.5 flex-1 rounded-full transition-colors duration-slow',
                          i < progress.count
                            ? 'bg-[color:var(--mythic-accent,var(--color-brand))]'
                            : 'bg-hover',
                        )}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>

            <Roster
              friends={progress.friends}
              required={progress.required}
              count={progress.count}
              unlocked={unlocked}
            />

            {unlocked && <WhereItShows />}

            <InviteCard
              link={link}
              code={progress.referralCode}
              copied={copied}
              onCopy={() => void copy()}
              onShare={() => void share()}
              unlocked={unlocked}
            />

            {!unlocked && <HowItWorks required={progress.required} />}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Who joined, and how much room is left.
 *
 * Filled slots are real people and tap through to their profile; empty ones are
 * outlines and do nothing. The two are the same size and sit in the same row on
 * purpose - the gap between what is there and what is not is the whole message,
 * and breaking them into two groups would lose it.
 *
 * `count` rather than `friends.length` decides how many slots are filled: the
 * server caps the roster, so a long-finished mission has more friends than
 * faces and the row must not read as though people went missing.
 */
/**
 * What replaced the "Unlocked" pill.
 *
 * A pill is how an app labels a state. This is meant to read as a record of
 * something that happened, so it is set like one: the tier and the date, small,
 * spaced, between two rules, with nothing coloured in. The restraint is the
 * point - a finished mission does not need to shout, and the badge above it is
 * already doing all the shouting there is room for.
 *
 * The date is the whole reason it works. "Unlocked" is a flag in a database;
 * "Earned 23 August 2026" is a thing that happened to somebody on a day.
 */
function EarnedMark({ at, tier }: { at?: string; tier?: string }) {
  /*
   * The account's own locale and zone, which is where the day actually
   * happened. Falling back to the raw string would print an ISO timestamp on a
   * certificate; falling back to nothing is quieter and never wrong.
   */
  const earned = at ? new Date(at) : undefined;
  const day =
    earned && !Number.isNaN(earned.getTime())
      ? earned.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
      : undefined;

  return (
    <div className="mt-4 flex w-full max-w-[15rem] flex-col items-center">
      {/*
        The rules flank one line, not a stack. Centring them against a two-line
        block put them level with the tier and left the date hanging below,
        which looked like a rule that had slipped rather than a rule.
      */}
      <div className="flex w-full items-center gap-3">
        <span aria-hidden className="h-px flex-1 bg-line" />
        <span className="text-caption font-medium tracking-[0.2em] text-[color:var(--mythic-accent,var(--color-brand))] uppercase">
          {tier ?? 'Earned'}
        </span>
        <span aria-hidden className="h-px flex-1 bg-line" />
      </div>
      {day && <p className="text-caption mt-2 tracking-wide text-text-secondary">Earned {day}</p>}
    </div>
  );
}

/**
 * Where the badge turns up, for somebody who has just got one.
 *
 * This is the section that used to be "How it works", and leaving that up after
 * the mission is finished was the clearest sign nobody had looked at this state:
 * step three said "do that five times and the badge is yours", in the past
 * tense, to somebody holding it.
 *
 * What a finisher actually wants to know is where it shows - the reward is that
 * other people see it, and none of those places is this screen. The last line
 * goes to the cabinet, because that is the one place they can do something.
 */
function WhereItShows() {
  const navigate = useNavigate();

  return (
    <section className="mt-10">
      <h2 className="text-caption font-medium tracking-wide text-text-secondary uppercase">
        Where it shows
      </h2>
      <ul className="mt-3 space-y-3">
        {['Beside your name in every chat.', 'On your profile, for anyone who visits.'].map(
          (line) => (
            <li key={line} className="flex gap-3">
              <span aria-hidden className="mt-1.5 text-[color:var(--mythic-accent,var(--color-brand))]">
                <CheckIcon size={14} strokeWidth={3} />
              </span>
              <span className="text-body text-text-secondary">{line}</span>
            </li>
          ),
        )}
      </ul>

      <button
        type="button"
        onClick={() => navigate('/profile/achievements')}
        className={cn(
          'focus-ring mt-4 flex w-full items-center gap-3 rounded-xl bg-surface px-4 py-3.5 text-left ring-1 ring-line',
          'transition-colors duration-instant hover:bg-hover active:bg-pressed',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="text-body block font-medium text-ink">Your achievements</span>
          <span className="text-caption block text-text-secondary">
            Choose how yours is drawn
          </span>
        </span>
        <ChevronRightIcon size={18} className="shrink-0 text-text-tertiary" />
      </button>
    </section>
  );
}

/**
 * The name under a face, in the width a face has.
 *
 * "Aarav Sharma" in a fifty-six pixel tile becomes "Aarav S...", which is a
 * worse label than "Aarav" and looks like a bug. The full name is on the
 * profile this tile opens; here it only has to say which of five people this
 * one is. Falls back to the whole string when there is nothing to split.
 */
function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] || displayName;
}

function Roster({
  friends,
  required,
  count,
  unlocked,
}: {
  friends: ReferredFriend[];
  required: number;
  count: number;
  unlocked: boolean;
}) {
  const navigate = useNavigate();
  /*
   * No empty slots once it is earned. They are the shape of what is left to do,
   * and there is nothing left to do - a finished mission showing three dashed
   * circles is telling somebody they are not finished.
   */
  const empty = unlocked ? 0 : Math.max(0, required - count);
  const overflow = Math.max(0, count - friends.length);

  /*
   * Earned, and nobody to list.
   *
   * Not hypothetical: every account holding this badge today was granted it by
   * hand, and has no referrals at all. With no faces and no empty slots there
   * is nothing left but a heading, and "The people who joined" over an empty
   * row is worse than no section. The unfinished screen keeps its version of
   * this, because there the emptiness is the message.
   */
  if (unlocked && count === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="text-caption font-medium tracking-wide text-text-secondary uppercase">
        {unlocked
          ? /*
              Not "N friends joined", which is a counter, and not "who got you
              here", which reads as though they brought the account rather than
              the other way round. This is a list of people, and saying so is
              enough.
            */
            'The people who joined'
          : count === 0
            ? 'Who joins'
            : count === 1
              ? '1 friend joined'
              : `${count} friends joined`}
      </h2>

      <div className="mt-3 flex flex-wrap items-start gap-x-3 gap-y-4">
        {friends.map((friend) => (
          <button
            key={friend.id}
            type="button"
            onClick={() => navigate(`/profile/${friend.username}`)}
            className="focus-ring flex w-14 flex-col items-center gap-1.5 rounded-xl py-1 transition-transform duration-quick active:scale-[0.96]"
          >
            <Avatar
              name={friend.displayName}
              id={friend.id}
              {...(friend.avatarUrl ? { src: friend.avatarUrl } : {})}
              /* 48px, the same box as the empty slots beside it. */
              size="md"
            />
            <span className="text-caption w-full truncate text-center text-text-secondary">
              {firstName(friend.displayName)}
            </span>
          </button>
        ))}

        {/*
          Everyone past the server's cap, as one tile rather than a truncated
          list. The number is still honest because it comes off `count`.
        */}
        {overflow > 0 && (
          <div className="flex w-14 flex-col items-center gap-1.5 py-1">
            <span className="text-caption grid size-12 place-items-center rounded-full bg-sunken font-medium text-text-secondary">
              +{overflow}
            </span>
            <span className="text-caption w-full truncate text-center text-text-tertiary">more</span>
          </div>
        )}

        {Array.from({ length: empty }, (_, i) => (
          <div key={`empty-${i}`} className="flex w-14 flex-col items-center gap-1.5 py-1">
            {/*
              A filled disc, not a dashed ring. A dashed stroke is wireframe
              grammar - it means "drop something here" - and a row of them makes
              a finished screen look like a sketch of one. See the note in
              `AchievementCabinet`.
            */}
            <span aria-hidden className="size-12 rounded-full bg-hover" />
            {/* No caption. An empty slot that says something becomes a to-do item. */}
            <span className="text-caption invisible">·</span>
          </div>
        ))}
      </div>

      {count === 0 && (
        <p className="text-caption mt-1 text-text-tertiary">
          Friends who join with your link appear here.
        </p>
      )}
    </section>
  );
}

/**
 * The link, three ways: scannable, copyable, shareable.
 *
 * The QR is not an extra - it is the version that works when the person is
 * standing in front of you, which is how most of these invitations actually
 * happen. Same rules as the profile code: the plate stays white in both themes
 * because scanners threshold on the light modules, and nothing animates over
 * it.
 *
 * The link stays after unlocking. Somebody who finished the mission has no
 * reason to stop inviting people, and taking the button away would read as a
 * punishment for completing it.
 */
function InviteCard({
  link,
  code,
  copied,
  onCopy,
  onShare,
  unlocked,
}: {
  link: string | undefined;
  code: string;
  copied: boolean;
  onCopy: () => void;
  onShare: () => void;
  unlocked: boolean;
}) {
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

  return (
    <section className="mt-10">
      <h2 className="text-caption font-medium tracking-wide text-text-secondary uppercase">
        Your invite
      </h2>
      {/*
        Said once, to the only person who would wonder. A finished mission that
        still shows a share card looks like a screen that forgot to update, and
        one line is cheaper than taking the card away from somebody who has no
        reason to stop inviting people.
      */}
      {unlocked && (
        <p className="text-caption mt-1 text-text-tertiary">
          Still works. The badge is earned once; the link is not.
        </p>
      )}

      <div className="mt-3 rounded-2xl bg-surface p-5 ring-1 ring-line">
        {link ? (
          <div className="flex flex-col items-center">
            {/*
              Explicitly `#FFFFFF` rather than a surface token: the token follows
              the theme and this must not.
            */}
            <div className="rounded-2xl bg-white p-3 shadow-sm">
              <QrArt value={link} size={232} title="QR code for your PINGO invite" />
            </div>
            {/*
              Read aloud more often than it is tapped, so it is set as something to
              read: the code, not a caption about the code.
            */}
            <p className="text-body mt-3 font-mono font-medium tracking-[0.25em] text-ink uppercase">
              {code}
            </p>
          </div>
        ) : (
          <p className="text-body py-6 text-center text-text-tertiary">
            Your link is not ready yet.
          </p>
        )}

        <div className="mt-5 border-t border-line pt-4">
          <p className="text-caption truncate rounded-lg bg-sunken px-3 py-2.5 font-mono text-text-secondary">
            {link ?? '—'}
          </p>

          <div className="mt-3 flex gap-2">
            <Button variant="primary" block onClick={onCopy} disabled={!link}>
              <span className="inline-flex items-center gap-1.5">
                {copied ? <CheckIcon size={16} strokeWidth={3} /> : <LinkIcon size={16} />}
                {copied ? 'Copied' : 'Copy link'}
              </span>
            </Button>
            {canShare && (
              <Button variant="secondary" block onClick={onShare} disabled={!link}>
                <span className="inline-flex items-center gap-1.5">
                  <ShareIcon size={16} />
                  Share
                </span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * The rules, stated once.
 *
 * Three lines because there are exactly three things somebody can get wrong:
 * what to send, what makes it count, and what they get. The old screen had the
 * middle one as a footnote under the buttons, where it read as small print
 * about a thing that had already happened.
 */
function HowItWorks({ required }: { required: number }) {
  const steps = [
    'Send your link to a friend.',
    'They join and finish creating their PINGO account.',
    `Do that ${required} times and the badge is yours, on every screen your name appears.`,
  ];

  return (
    <section className="mt-10">
      <h2 className="text-caption font-medium tracking-wide text-text-secondary uppercase">
        How it works
      </h2>
      <ol className="mt-3 space-y-3">
        {steps.map((step, i) => (
          <li key={step} className="flex gap-3">
            <span
              aria-hidden
              className="text-caption mt-px grid size-6 shrink-0 place-items-center rounded-full bg-sunken font-medium tabular-nums text-text-secondary"
            >
              {i + 1}
            </span>
            <span className="text-body text-text-secondary">{step}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * The shape of the screen while it loads.
 *
 * Laid out to match what arrives, so nothing jumps when it does. A centred
 * "Loading…" is a smaller amount of work and a worse result: the page snaps
 * from one line of text to a full screen, which reads as a flash of broken.
 */
function MissionSkeleton() {
  return (
    <div className="mx-auto mt-4 w-full max-w-md">
      <div className="flex flex-col items-center">
        <Skeleton className="size-40 rounded-full sm:size-56" />
        <Skeleton className="mt-5 h-6 w-40 rounded-md" />
        <Skeleton className="mt-2 h-4 w-56 rounded-md" />
        <Skeleton className="mt-6 h-10 w-24 rounded-md" />
        <Skeleton className="mt-5 h-1.5 w-full max-w-[16rem] rounded-full" />
      </div>
      <Skeleton className="mt-10 h-3 w-28 rounded-md" />
      <div className="mt-3 flex gap-3">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="size-12 rounded-full" />
        ))}
      </div>
      <Skeleton className="mt-10 h-3 w-24 rounded-md" />
      <Skeleton className="mt-3 h-64 w-full rounded-2xl" />
    </div>
  );
}

export default MythicMissionScreen;
