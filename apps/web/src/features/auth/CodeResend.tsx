import { untilLabel, type OtpChannel, type OtpQuota } from './otp-quota.js';

/**
 * Under the code boxes, as the reference has it: a quiet "Didn't receive code?"
 * and, in blue underneath, the way to ask again. Two ways, a text and a call,
 * each with its own timer or what is left of it beside it. No cards, no rows;
 * the code boxes are the thing on this screen.
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
    <div className="mt-8 text-center">
      <p className="text-[14px] text-text-secondary">Didn’t receive Code?</p>
      <div className="mt-2 flex items-center justify-center gap-6">
        <Link label="Resend OTP" channel="sms" quota={quota} waitFor={waitFor} busy={busy} onSend={onSend} />
        <Link label="Call me" channel="call" quota={quota} waitFor={waitFor} busy={busy} onSend={onSend} />
      </div>
    </div>
  );
}

function Link({
  label,
  channel,
  quota,
  waitFor,
  busy,
  onSend,
}: {
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
  const side =
    busy === channel
      ? channel === 'call'
        ? 'Calling…'
        : 'Sending…'
      : usedUp
        ? freesAt
          ? `in ${untilLabel(freesAt)}`
          : ''
        : waitFor > 0
          ? `0:${String(waitFor).padStart(2, '0')}`
          : left !== undefined
            ? `${left} left`
            : '';

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSend(channel)}
      className="focus-ring flex flex-col items-center gap-0.5 rounded-md px-1 py-1 text-[#1a8ae8] disabled:text-text-tertiary"
    >
      <span className="text-[15px] font-medium">{label}</span>
      {side && <span className="text-[12px] tabular-nums text-text-tertiary">{side}</span>}
    </button>
  );
}
