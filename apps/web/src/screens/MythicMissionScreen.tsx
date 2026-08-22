import { Button, CheckIcon, cn } from '@pingo/ui';
import { useCallback, useEffect, useState } from 'react';

import { ScreenHeader } from '../components/ScreenHeader.js';
import { AchievementArt } from '../features/achievements/AchievementArt.js';
import { achievementById } from '../features/achievements/registry.js';
import { referralLink } from '../features/referrals/referral-code.js';
import {
  fetchReferralProgress,
  type ReferralProgress,
} from '../features/referrals/referrals-service.js';

/**
 * The mission, its progress and the link that advances it.
 *
 * ## Every number on this screen comes from the server
 *
 * The requirement, the count and whether it is unlocked are all read from
 * `referral_progress` rather than assembled here. A screen that knew the target
 * was five would be a second place the number lives, and the first time an
 * operator changed it in Controlling the app would still be asking for five.
 *
 * That is also why the copy is written around the values instead of around the
 * word "five": `{count} / {required}` reads correctly at any requirement, and
 * "2 more to unlock" is arithmetic rather than a string somebody has to
 * remember to edit.
 */
export function MythicMissionScreen() {
  const [progress, setProgress] = useState<ReferralProgress>();
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

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
    <div className="flex h-full min-h-0 flex-col bg-page">
      <ScreenHeader title="Mission" showBack />

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-10">
        {loading ? (
          <p className="text-caption mt-10 text-center text-text-secondary">Loading…</p>
        ) : !progress ? (
          <p className="text-caption mt-10 text-center text-text-secondary">
            No mission is running right now.
          </p>
        ) : (
          <>
            {/*
              The badge is the subject, so it is the first and largest thing.
              Shown at full size whether or not it is unlocked - a mission you
              cannot see the prize of is a chore.
            */}
            <div className="mt-6 flex flex-col items-center text-center">
              {/*
                The prize itself, from the registry rather than a path typed
                here - the mission names the badge it hands over, so the art
                follows whatever that badge is.

                Dimmed until earned, and only dimmed: no greyscale, no padlock
                over the artwork. A lock drawn on top of it is a reinterpretation
                of a piece of design that is not to be reinterpreted.
              */}
              {achievementById(progress.badgeId) && (
                <AchievementArt
                  achievement={achievementById(progress.badgeId)!}
                  size="large"
                  className={cn(
                    'transition-opacity duration-slow',
                    progress.unlocked ? 'opacity-100' : 'opacity-45',
                  )}
                />
              )}

              <h1 className="mt-5 text-xl font-semibold tracking-wide text-ink">
                {progress.title}
              </h1>
              <p className="text-body mt-1 text-text-secondary">{progress.description}</p>

              {progress.unlocked ? (
                <p className="text-body mt-5 inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-4 py-1.5 font-medium text-brand">
                  <CheckIcon size={16} strokeWidth={3} />
                  Unlocked
                </p>
              ) : (
                <>
                  <p className="mt-6 text-3xl font-semibold tabular-nums text-ink">
                    {progress.count} / {progress.required}
                  </p>
                  <p className="text-caption mt-1 text-text-secondary">
                    {progress.count === 0
                      ? `Refer ${progress.required} friends to unlock`
                      : remaining === 1
                        ? '1 more friend to unlock'
                        : `${progress.count} joined · ${remaining} more to unlock`}
                  </p>

                  {/* The same fraction, drawn. Nothing here knows the number is five. */}
                  <div
                    className="mt-4 flex w-full max-w-xs gap-1.5"
                    role="progressbar"
                    aria-valuenow={progress.count}
                    aria-valuemin={0}
                    aria-valuemax={progress.required}
                  >
                    {Array.from({ length: progress.required }, (_, i) => (
                      <span
                        key={i}
                        className={cn(
                          'h-1.5 flex-1 rounded-full transition-colors duration-base',
                          i < progress.count ? 'bg-brand' : 'bg-hover',
                        )}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>

            {/*
              The link stays after unlocking. Somebody who finished the mission
              has no reason to stop inviting people, and taking the button away
              would read as a punishment for completing it.
            */}
            <div className="mt-10">
              <p className="text-caption font-medium text-text-secondary">Your invite link</p>
              <p className="text-body mt-1.5 truncate rounded-lg bg-surface px-3 py-2.5 font-mono text-ink">
                {link ?? '—'}
              </p>

              <div className="mt-3 flex gap-2">
                <Button variant="primary" block onClick={() => void copy()} disabled={!link}>
                  {copied ? 'Copied' : 'Copy link'}
                </Button>
                {typeof navigator !== 'undefined' && 'share' in navigator && (
                  <Button variant="secondary" block onClick={() => void share()} disabled={!link}>
                    Share
                  </Button>
                )}
              </div>

              <p className="text-caption mt-4 text-text-secondary">
                A friend counts once they finish creating their PINGO account.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default MythicMissionScreen;
