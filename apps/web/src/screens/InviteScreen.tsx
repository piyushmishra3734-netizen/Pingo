import { Button, CheckIcon, ChevronRightIcon, CloseIcon, LinkIcon, ShareIcon, cn } from '@pingo/ui';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { AchievementArt } from '../features/achievements/AchievementArt.js';
import { achievementById } from '../features/achievements/registry.js';
import { VoxelQr } from '../features/profile/VoxelQr.js';
import { referralLink } from '../features/referrals/referral-code.js';
import {
  fetchReferralProgress,
  type ReferralProgress,
} from '../features/referrals/referrals-service.js';

/**
 * The invitation: the tree growing the person's own referral link, share and
 * copy, and how far along the badge is. Whoever scans it arrives at `/r/:code`
 * and the invite is credited.
 *
 * ## Not on the way in
 *
 * It was briefly placed between signing in and the chat list, in front of
 * every login and signup. That came out again: a page in front of the chats at
 * the moment somebody has just arrived is a toll, whatever is on it. Nothing
 * routes here on sign-in now; it is a page to open on purpose.
 *
 * ## It steps aside when it has nothing to offer
 *
 * With no mission running, or the badge already earned, there is nothing left
 * to invite toward, and it goes straight to the chats without drawing a frame.
 *
 * ## Closing it
 *
 * A close button in the corner. It replaced a "Continue to chats" link at the
 * bottom, which read as the next step of a flow rather than a way out of a
 * page.
 *
 * ## Every number is the server's
 *
 * Count, requirement, badge and title all come from `referral_progress`, as on
 * the mission screen - a screen that knew the target was five would be a
 * second place that number lives.
 */
export function InviteScreen() {
  const [progress, setProgress] = useState<ReferralProgress | null>();

  useEffect(() => {
    let live = true;
    void fetchReferralProgress().then((row) => {
      if (live) setProgress(row ?? null);
    });
    return () => {
      live = false;
    };
  }, []);

  // Still asking. Blank rather than a skeleton: this resolves in one request,
  // and a skeleton that flashes for a frame reads as a glitch.
  if (progress === undefined) return <div className="h-full bg-page" />;

  // Nothing to invite toward - see "It retires itself".
  if (progress === null || progress.unlocked || !progress.referralCode) {
    return <Navigate to="/chats" replace />;
  }

  return <InviteView progress={progress} />;
}

/**
 * The invitation itself, given progress that is known to have something in it.
 *
 * Separate from `InviteScreen` so it can be drawn without a session: the lab at
 * `/dev/invite-lab` hands it a made-up row, which is the only way to look at
 * this page without signing in and being a user who has not finished the
 * mission.
 */
export function InviteView({ progress }: { progress: ReferralProgress }) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const link = referralLink(progress.referralCode);
  const achievement = achievementById(progress.badgeId);
  const done = Math.min(progress.count, progress.required);
  const leave = () => navigate('/chats', { replace: true });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      navigator.vibrate?.(4);
      setCopied(true);
    } catch {
      // Refused clipboard permission. Saying nothing beats claiming a copy that
      // did not happen.
    }
  };

  const share = async () => {
    if (typeof navigator.share !== 'function') {
      await copy();
      return;
    }
    try {
      await navigator.share({ title: 'PINGO', text: 'Join me on PINGO.', url: link });
    } catch {
      // Cancelled. Not an error worth reporting.
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-page">
      <button
        type="button"
        onClick={leave}
        aria-label="Close"
        className={cn(
          'focus-ring absolute right-3 top-[max(env(safe-area-inset-top),0.75rem)] z-10',
          'grid size-10 place-items-center rounded-full text-text-secondary',
          'transition-transform duration-instant hover:bg-surface-hover active:scale-90',
        )}
      >
        <CloseIcon size={22} />
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-10 pt-14">
        <div className="mx-auto flex w-full max-w-sm flex-col items-center text-center motion-safe:animate-fade-in">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Invite your friends</h1>
          <p className="text-body mt-1.5 max-w-xs text-balance text-text-secondary">
            Your link grows a tree. Anyone who scans it joins you on PINGO.
          </p>

          {/*
            The white plate is `#FFFFFF`, not a surface token: the settled code
            has to sit on genuine white in both themes. See `QrArt`.
          */}
          <div className="mt-6 rounded-2xl bg-white p-3 shadow-sm">
            <VoxelQr value={link} size={248} autoPlay caption="" label="Your invite code" />
          </div>

          <div className="mt-5 flex w-full gap-2">
            <Button block onClick={() => void share()} leadingIcon={<ShareIcon size={18} />}>
              Share invite
            </Button>
            <Button
              variant="secondary"
              onClick={() => void copy()}
              leadingIcon={copied ? <CheckIcon size={18} /> : <LinkIcon size={18} />}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>

          {/*
            The badge, and how far along it is. A row that opens the mission
            screen rather than the whole of it - this is the invitation, and
            the mission is one tap away for anybody who wants the detail.
          */}
          <button
            type="button"
            onClick={() => navigate('/profile/mission')}
            className={cn(
              'focus-ring mt-6 flex w-full items-center gap-3 rounded-2xl bg-surface p-3 text-left',
              'ring-1 ring-line transition-transform duration-instant active:scale-[0.99]',
            )}
          >
            {achievement && <AchievementArt achievement={achievement} size="medium" locked />}
            <div className="min-w-0 flex-1">
              <p className="text-body truncate font-medium text-ink">{progress.title}</p>
              <p className="text-caption mt-0.5 tabular-nums text-text-secondary">
                {done} / {progress.required} friends joined
              </p>
              <div className="mt-2 flex gap-1" aria-hidden>
                {Array.from({ length: progress.required }, (_, i) => (
                  <span
                    key={i}
                    className={cn('h-1.5 flex-1 rounded-full', i < done ? 'bg-brand' : 'bg-line')}
                  />
                ))}
              </div>
            </div>
            <ChevronRightIcon size={18} className="shrink-0 text-text-tertiary" />
          </button>
        </div>
      </div>
    </div>
  );
}
