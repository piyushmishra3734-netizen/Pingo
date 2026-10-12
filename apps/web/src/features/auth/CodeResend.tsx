import { MessageSquareText, Phone } from 'lucide-react';

import { untilLabel, type OtpChannel, type OtpQuota } from './otp-quota.js';

/**
 * Under the code boxes, as WhatsApp does it: two plain rows, "Resend SMS" and
 * "Call me", each with its own timer or what is left of it on the right. No
 * cards, no pills; the code boxes are the thing on this screen.
 */
export function CodeResend({
  via: _via,
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
  const soonest = quota && out ? Math.min(quota.freesAt.sms ?? Infinity, quota.freesAt.call ?? Infinity) : undefined;

  if (out) {
    return (
      <p className="mt-7 text-center text-caption text-text-secondary" aria-live="polite">
        No more codes for now. Try again in {soonest && Number.isFinite(soonest) ? untilLabel(soonest) : 'a few hours'}.
      </p>
    );
  }

  return (
    <div className="mt-7">
      <p className="mb-1 text-caption text-text-tertiary">Didn’t receive the code?</p>
      <div className="divide-y divide-line border-y border-line">
        <Row icon={<MessageSquareText size={20} aria-hidden />} label="Resend SMS" channel="sms" quota={quota} waitFor={waitFor} busy={busy} onSend={onSend} />
        <Row icon={<Phone size={20} aria-hidden />} label="Call me" channel="call" quota={quota} waitFor={waitFor} busy={busy} onSend={onSend} />
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  channel,
  quota,
  waitFor,
  busy,
  onSend,
}: {
  icon: React.ReactNode;
  label: string;
  channel: OtpChannel;
  quota: OtpQuota | undefined;
  waitFor: number;
  busy?: OtpChannel | undefined;
  onSend: (channel: OtpChannel) => void;
}) {
  const left = quota?.left[channel];
  const usedUp = left !== undefined && left <= 0;
  const freesAt = quota?.freesAt[channel];
  const disabled = usedUp || waitFor > 0 || Boolean(busy);
  const side = busy === channel
    ? channel === 'call' ? 'Calling…' : 'Sending…'
    : usedUp
      ? freesAt ? `in ${untilLabel(freesAt)}` : ''
      : waitFor > 0
        ? `0:${String(waitFor).padStart(2, '0')}`
        : left !== undefined ? `${left} left` : '';

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSend(channel)}
      className="focus-ring flex h-12 w-full items-center gap-3.5 text-left text-brand disabled:text-text-tertiary"
    >
      {icon}
      <span className="flex-1 text-[15px] font-medium">{label}</span>
      <span className="text-[13px] tabular-nums text-text-tertiary">{side}</span>
    </button>
  );
}
