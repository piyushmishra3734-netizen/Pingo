import { Avatar, Button, CheckIcon, LinkIcon, ShareIcon, Skeleton, cn } from '@pingo/ui';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ScreenHeader } from '../components/ScreenHeader.js';
import { AchievementArt } from '../features/achievements/AchievementArt.js';
import { MythicAura as MythicAuraWash } from '../features/achievements/MythicAura.js';
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
    // `isolate`: the aura wash sits at -z-10, and without a stacking context of
    // our own that puts it behind the page background rather than behind the page.
    <div className="relative isolate flex h-full min-h-0 flex-col bg-page">
      {/*
        The same wash as the profile and the cabinet, so finishing the mission
        lands somewhere that already looks like the reward. Only once it is
        actually earned - putting it behind an unfinished mission would spend
        the moment before it arrives.
      */}
      {unlocked && <MythicAuraWash accent={preferences.mythic.accent} />}

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

              <h1 className="mt-5 text-xl font-semibold tracking-wide text-ink">
                {progress.title}
              </h1>
              <p className="text-body mt-1.5 max-w-xs text-balance text-text-secondary">
                {progress.description}
              </p>

              {unlocked ? (
                <p className="text-body mt-5 inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-4 py-1.5 font-medium text-brand">
                  <CheckIcon size={16} strokeWidth={3} />
                  Unlocked
                </p>
              ) : (
                <>
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
                </>
              )}

              {/*
                The same fraction, drawn, and kept after unlocking so a finished
                mission still shows itself as finished. Nothing here knows the
                number is five.

                Unlocked fills it whatever the count says. The two can disagree -
                a badge granted by hand sits on an account with no referrals at
                all - and when they do, the badge is the fact: an "Unlocked" pill
                above five empty segments reads as a screen that is broken rather
                than as an account that is unusual.
              */}
              <div
                className="mt-5 flex w-full max-w-[16rem] gap-1.5"
                role="progressbar"
                aria-valuenow={unlocked ? progress.required : progress.count}
                aria-valuemin={0}
                aria-valuemax={progress.required}
                aria-label={
                  unlocked
                    ? 'Mission complete'
                    : `${progress.count} of ${progress.required} friends joined`
                }
              >
                {Array.from({ length: progress.required }, (_, i) => (
                  <span
                    key={i}
                    className={cn(
                      'h-1.5 flex-1 rounded-full transition-colors duration-slow',
                      unlocked || i < progress.count
                        ? 'bg-[color:var(--mythic-accent,var(--color-brand))]'
                        : 'bg-hover',
                    )}
                  />
                ))}
              </div>
            </div>

            <Roster
              friends={progress.friends}
              required={progress.required}
              count={progress.count}
            />

            <InviteCard
              link={link}
              code={progress.referralCode}
              copied={copied}
              onCopy={() => void copy()}
              onShare={() => void share()}
            />

            <HowItWorks required={progress.required} />
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
}: {
  friends: ReferredFriend[];
  required: number;
  count: number;
}) {
  const navigate = useNavigate();
  const empty = Math.max(0, required - count);
  const overflow = Math.max(0, count - friends.length);

  return (
    <section className="mt-10">
      <h2 className="text-caption font-medium tracking-wide text-text-secondary uppercase">
        {count === 0 ? 'Who joins' : count === 1 ? '1 friend joined' : `${count} friends joined`}
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
            <span
              aria-hidden
              className="size-12 rounded-full border border-dashed border-line"
            />
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
}: {
  link: string | undefined;
  code: string;
  copied: boolean;
  onCopy: () => void;
  onShare: () => void;
}) {
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

  return (
    <section className="mt-10">
      <h2 className="text-caption font-medium tracking-wide text-text-secondary uppercase">
        Your invite
      </h2>

      <div className="mt-3 rounded-2xl bg-surface p-5 ring-1 ring-line">
        {link ? (
          <div className="flex flex-col items-center">
            {/*
              Explicitly `#FFFFFF` rather than a surface token: the token follows
              the theme and this must not.
            */}
            <div className="rounded-2xl bg-white p-3 shadow-sm">
              <QrArt value={link} size={168} level="H" logo title="QR code for your PINGO invite" />
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
