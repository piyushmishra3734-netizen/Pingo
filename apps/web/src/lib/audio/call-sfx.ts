/**
 * PINGO AI call sounds: connect, end, mute, unmute.
 *
 * Synthesised (two soft sine notes each), so there is nothing to download and
 * nothing to wait for. The AudioContext is made on the first sound, which
 * always follows a tap (starting the call, the mute button), so autoplay rules
 * are met. Off when the person turns call sounds off in PINGO AI's settings.
 */
const KEY = 'pingo:ai-call-sfx';

export function callSoundsOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function setCallSounds(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // Private mode: the switch just does not stick.
  }
}

export type CallSound = 'connect' | 'end' | 'mute' | 'unmute';

/** Notes in Hz and their start offsets in seconds. */
const SOUNDS: Record<CallSound, [number, number][]> = {
  connect: [[660, 0], [990, 0.09]],
  end: [[740, 0], [494, 0.11]],
  mute: [[520, 0]],
  unmute: [[780, 0]],
};

let ctx: AudioContext | undefined;

export function playCallSound(sound: CallSound): void {
  if (!callSoundsOn()) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    for (const [hz, at] of SOUNDS[sound]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz;
      // A quick swell and a soft tail: present, never a beep.
      gain.gain.setValueAtTime(0, now + at);
      gain.gain.linearRampToValueAtTime(0.09, now + at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.2);
    }
  } catch {
    // No Web Audio: the call works the same, silently.
  }
}
