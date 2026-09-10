import { Button, CheckIcon, CloseIcon, LinkIcon, ShareIcon, cn } from '@pingo/ui';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { VoxelQr } from '../features/profile/VoxelQr.js';
import { referralLink } from '../features/referrals/referral-code.js';
import {
  fetchReferralProgress,
  type ReferralProgress,
} from '../features/referrals/referrals-service.js';

/**
 * The invitation, between signing in and the chat list: the tree growing the
 * person's own referral link, and a way to share it. Whoever scans it arrives
 * at `/r/:code` and the invite is credited.
 *
 * Every way into the product - a new password, a returning one, the Google
 * round trip, the last step of profile setup, and the guest guard - comes
 * through here before `/chats`.
 *
 * ## Closed from the corner
 *
 * A close button top right, which is the whole of how it is left. It replaced
 * a "Continue to chats" link at the bottom, which read as the next step of a
 * flow rather than a way out of a page.
 *
 * ## No badge on it
 *
 * It carried the MYTHIC PIONEER row with a friends-joined count, and on the way
 * in that turned an invitation into a task list. The mission is still one tap
 * away under Achievements, which is where the count belongs.
 *
 * ## It steps aside when it has nothing to offer
 *
 * With no mission running, or the badge already earned, it goes straight to
 * the chats without drawing a frame - a page in front of every sign-in is a
 * toll, and it should stop charging once there is nothing left to invite for.
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
        </div>
      </div>
    </div>
  );
}
