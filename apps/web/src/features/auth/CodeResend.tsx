import { cn } from '@pingo/ui';
import { MessageSquareText, PhoneCall } from 'lucide-react';

import { untilLabel, type OtpChannel, type OtpQuota } from './otp-quota.js';

/**
 * Under the code boxes: how the code came, and the two ways to get another.
 *
 * "Text again" and "Call me instead", each with what is left of it (3 texts,
 * 2 calls per 12 hours), both quiet until the cooldown runs out. A used-up
 * way says when it comes back; both used up becomes one line saying when.
 */
export function CodeResend({
  via,
  quota,
  waitFor,
  busy,
  onSend,
}: {
  /** How the latest code was sent. */
  via: OtpChannel;
  quota: OtpQuota | undefined;
  /** Seconds before another may be asked for. */
  waitFor: number;
  busy?: OtpChannel | undefined;
  onSend: (channel: OtpChannel) => void;
}) {
  const left = quota?.left;
  const out = left && left.sms <= 0 && left.call <= 0;
  const soonest = quota && out ? Math.min(...(['sms', 'call'] as const).map((c) => quota.freesAt[c] ?? Infinity)) : undefined;

  return (
    <div className="mt-6 flex flex-col items-center gap-3">
      <p className="text-center text-caption text-text-secondary" aria-live="polite">
        {busy
          ? busy === 'call'
            ? 'Calling you now…'
            : 'Sending a new code…'
          : out
            ? `You have used all your codes for now. Try again in ${soonest && Number.isFinite(soonest) ? untilLabel(soonest) : 'a few hours'}.`
            : waitFor > 0
              ? `${via === 'call' ? 'Didn’t pick up?' : 'No text yet?'} You can ask again in 0:${String(waitFor).padStart(2, '0')}`
              : 'Didn’t get it?'}
      </p>

      {!out && (
        <div className="flex w-full gap-2.5">
          <Option
            icon={<MessageSquareText size={17} aria-hidden />}
            label={via === 'sms' ? 'Text again' : 'Text me'}
            channel="sms"
            quota={quota}
            disabled={waitFor > 0 || Boolean(busy)}
            onSend={onSend}
          />
          <Option
            icon={<PhoneCall size={17} aria-hidden />}
            label={via === 'call' ? 'Call again' : 'Call me instead'}
            channel="call"
            quota={quota}
            disabled={waitFor > 0 || Boolean(busy)}
            onSend={onSend}
          />
        </div>
      )}
    </div>
  );
}

function Option({
  icon,
  label,
  channel,
  quota,
  disabled,
  onSend,
}: {
  icon: React.ReactNode;
  label: string;
  channel: OtpChannel;
  quota: OtpQuota | undefined;
  disabled: boolean;
  onSend: (channel: OtpChannel) => void;
}) {
  const left = quota?.left[channel];
  const usedUp = left !== undefined && left <= 0;
  const freesAt = quota?.freesAt[channel];
  return (
    <button
      type="button"
      disabled={disabled || usedUp}
      onClick={() => onSend(channel)}
      className={cn(
        'focus-ring flex min-h-[3.25rem] flex-1 flex-col items-center justify-center rounded-2xl border border-line bg-surface px-2 py-2 text-ink',
        'transition-[opacity,transform] duration-quick active:scale-[0.98] disabled:opacity-45',
      )}
    >
      <span className="flex items-center gap-1.5 text-[14.5px] font-semibold">
        {icon}
        {label}
      </span>
      <span className="text-[11.5px] text-text-tertiary">
        {usedUp ? (freesAt ? `Back in ${untilLabel(freesAt)}` : 'Used up') : left !== undefined ? `${left} left` : ' '}
      </span>
    </button>
  );
}
