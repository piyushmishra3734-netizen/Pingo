/**
 * PINGO's message sounds, synthesised.
 *
 * Nothing is downloaded and nothing is decoded: every sound here is a few sine
 * oscillators and a noise burst, built at the moment it plays. That is not a
 * shortcut — it is what makes the latency zero, the payload zero, and the
 * licensing question not exist. It also keeps the sounds in tune at any device
 * sample rate, which a shipped 44.1 kHz asset does not on a 48 kHz phone.
 *
 * ## The design, in one paragraph
 *
 * Sent falls; received rises. A falling interval reads as *closed, done*, and a
 * rising one as *opening, arriving* — so the two are told apart before either is
 * consciously identified, even face-down in a pocket. Received is also given a
 * little more: a delayed bloom a fifth above and a sub-octave of warmth
 * underneath, because hearing from someone should be marginally more rewarding
 * than confirming your own action. Marginally. Overdo it and it becomes the
 * thing people turn off.
 *
 * ## What makes it soft rather than sharp
 *
 * Harshness lives between 2 and 5 kHz, where the ear is most sensitive and where
 * alarms are deliberately placed. Nearly all the energy here sits below 2.5 kHz,
 * with one very quiet high component for air. Metallic timbre comes from
 * *inharmonic* partials — FM, bells, square and saw waves — so this uses sines
 * and filtered noise only. That is the whole difference between soft crystal and
 * a toy.
 *
 * ## Why it does not become annoying
 *
 * Not repetition — spectral sameness. An identical waveform every time lets the
 * ear lock onto it, and that lock is what turns familiar into irritating. Each
 * play is detuned by a fraction of a percent, far below the threshold where
 * anyone could name the difference, so the sound is recognisable without ever
 * being *the same*. Borrowed from game audio, where a footstep plays ten
 * thousand times a session.
 */

/** A single voice in a sound: one sine, one envelope. */
export interface Partial {
  /** Starting frequency, Hz. */
  from: number;
  /** Ending frequency. Equal to `from` for a steady tone. */
  to: number;
  /** Peak gain, linear. Kept well under 1 so layers can sum without clipping. */
  gain: number;
  /** Milliseconds after the sound starts before this voice begins. */
  delayMs: number;
  /** Milliseconds from silence to peak. Under ~4 ms reads as a click. */
  attackMs: number;
  /** Milliseconds from peak back to silence. */
  decayMs: number;
}

export interface SoundDesign {
  partials: Partial[];
  /**
   * A short filtered noise burst for air — the "glass" in liquid glass.
   *
   * Noise rather than a high sine, because a pure high tone reads as a beep and
   * noise reads as texture. Bandpassed so it is air and not hiss.
   */
  air?: { centreHz: number; q: number; gain: number; durationMs: number; delayMs: number };
  /** Total length, for the throttle to reason about without summing envelopes. */
  durationMs: number;
}

/**
 * Sent: light, dry, and over before it is noticed.
 *
 * A small fall — a major second, 587 to 494 Hz — which is a step rather than a
 * melody. Larger intervals start to sound like a tune, and a tune is a thing you
 * end up humming and then resenting. No bloom: the sender's own action does not
 * need to feel like it is opening, it needs to feel finished.
 */
export const SENT: SoundDesign = {
  partials: [
    { from: 587, to: 494, gain: 0.5, delayMs: 0, attackMs: 6, decayMs: 62 },
    // A quiet octave above, which reads as "clean" rather than as a second note.
    { from: 1174, to: 988, gain: 0.06, delayMs: 0, attackMs: 5, decayMs: 40 },
  ],
  air: { centreHz: 3200, q: 1.4, gain: 0.02, durationMs: 12, delayMs: 0 },
  durationMs: 70,
};

/**
 * Received: warmer, and it opens.
 *
 * The body rises slightly, a fifth blooms in twenty milliseconds later, and a
 * sub-octave sits underneath for body. The bloom is the whole trick — arriving
 * *after* the attack is what makes it feel like something unfolding rather than
 * a chord, and twenty milliseconds is long enough to be felt and short enough
 * not to be heard as two events.
 */
export const RECEIVED: SoundDesign = {
  partials: [
    { from: 523, to: 587, gain: 0.5, delayMs: 0, attackMs: 8, decayMs: 100 },
    // The bloom: a perfect fifth above, late and quieter.
    { from: 784, to: 784, gain: 0.26, delayMs: 22, attackMs: 14, decayMs: 88 },
    // Warmth. Felt more than heard, and the reason it does not sound thin.
    { from: 261, to: 261, gain: 0.14, delayMs: 0, attackMs: 10, decayMs: 105 },
  ],
  air: { centreHz: 3600, q: 1.2, gain: 0.028, durationMs: 18, delayMs: 4 },
  durationMs: 125,
};

export type MessageSound = 'sent' | 'received';

const DESIGNS: Record<MessageSound, SoundDesign> = { sent: SENT, received: RECEIVED };

/**
 * How far each play is detuned, as a fraction.
 *
 * 1.5% is about a quarter of a semitone: inaudible as pitch, but enough that no
 * two plays are the same waveform. This is what stops the ear locking on.
 */
const DETUNE = 0.015;

/** Nothing plays within this of the previous sound. */
const MIN_GAP_MS = 350;

/** Arrivals inside this window count as one burst. */
const BURST_WINDOW_MS = 1000;

/** After this many in a burst, the burst is collapsed to silence. */
const BURST_LIMIT = 3;

/** Each sound in a burst is this much quieter than the last. */
const BURST_ATTENUATION = 0.7;

/** The quietest a burst sound may become before it is simply dropped. */
const ATTENUATION_FLOOR = 0.35;

export interface ThrottleState {
  lastPlayedAt: number;
  /**
   * The last message that *arrived*, whether or not it made a sound.
   *
   * Measured from the last arrival rather than from the start of the burst, and
   * this is the difference between working and not. Anchoring to the start lets
   * a steady stream fall out of its own burst every second and start again at
   * full volume — measured, ten seconds of messages produced twenty-four sounds
   * at full volume, which is precisely the noise the throttle exists to prevent.
   */
  lastActivityAt: number;
  burstCount: number;
}

export const FRESH_THROTTLE: ThrottleState = {
  lastPlayedAt: 0,
  lastActivityAt: 0,
  burstCount: 0,
};

export interface ThrottleDecision {
  play: boolean;
  /** Multiplier on the sound's gain. 1 for an isolated sound. */
  gain: number;
  state: ThrottleState;
}

/**
 * Whether this sound should be heard, and how loudly.
 *
 * Three mechanisms, because one is not enough. A minimum gap alone still lets a
 * steady stream of messages produce a steady stream of sound; a hard cap alone
 * cuts off abruptly and feels broken. So a burst also *fades*: each sound inside
 * one is quieter than the last, which acknowledges the messages without
 * announcing every one of them, and reaches silence before anyone would describe
 * it as noise.
 *
 * Pure, and takes the clock as an argument, so the behaviour can be tested
 * without waiting a second and a half per case.
 */
export function decide(state: ThrottleState, now: number): ThrottleDecision {
  /*
   * Every arrival counts towards the burst, including the silent ones.
   *
   * A message that was too soon to make a sound is still evidence that a flurry
   * is happening, so it extends the burst and advances the count. Ignoring
   * suppressed arrivals is what let a steady stream reset itself and shout
   * again.
   */
  const quiet = now - state.lastActivityAt >= BURST_WINDOW_MS;
  const burstCount = quiet ? 1 : state.burstCount + 1;
  const carried: ThrottleState = {
    lastPlayedAt: state.lastPlayedAt,
    lastActivityAt: now,
    burstCount,
  };

  const silent = (): ThrottleDecision => ({ play: false, gain: 0, state: carried });

  if (now - state.lastPlayedAt < MIN_GAP_MS) return silent();
  if (burstCount > BURST_LIMIT) return silent();

  const gain = BURST_ATTENUATION ** (burstCount - 1);
  if (gain < ATTENUATION_FLOOR) return silent();

  return { play: true, gain, state: { ...carried, lastPlayedAt: now } };
}

/**
 * The shared context, created once and lazily.
 *
 * Created on first use rather than at import, because a context made before any
 * user gesture starts suspended and counts against the browser's autoplay
 * budget for nothing.
 */
let context: AudioContext | undefined;

function audioContext(): AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return undefined;

  context ??= new Ctor();
  if (context.state === 'suspended') void context.resume().catch(() => undefined);
  return context;
}

/**
 * Warm the audio path up on a gesture, so the first sound is not the slow one.
 *
 * The first `AudioContext` use after a page load costs a few milliseconds of
 * device setup. Spending that on the first message means the first message is
 * the one that sounds late, which is the one a user forms their impression on.
 */
export function primeMessageSounds(): void {
  const ctx = audioContext();
  if (!ctx) return;

  // A silent one-sample buffer: enough to open the output, inaudible.
  const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
}

/** Build and schedule one sound. Returns false when audio is unavailable. */
export function playMessageSound(kind: MessageSound, gain = 1): boolean {
  const ctx = audioContext();
  if (!ctx || ctx.state !== 'running') return false;

  const design = DESIGNS[kind];
  const now = ctx.currentTime;
  const detune = 1 + (Math.random() * 2 - 1) * DETUNE;

  /*
   * One gain node for the whole sound.
   *
   * The throttle's attenuation belongs here rather than on each partial, so a
   * quieter repeat is the same sound turned down — not a differently balanced
   * one, which is what per-partial scaling would produce.
   */
  const master = ctx.createGain();
  master.gain.value = gain;
  master.connect(ctx.destination);

  for (const partial of design.partials) {
    const start = now + partial.delayMs / 1000;
    const attack = partial.attackMs / 1000;
    const decay = partial.decayMs / 1000;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(partial.from * detune, start);
    if (partial.to !== partial.from) {
      // Exponential, because pitch is perceived logarithmically — a linear
      // sweep sounds like it slows down as it falls.
      osc.frequency.exponentialRampToValueAtTime(partial.to * detune, start + attack + decay);
    }

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(partial.gain, start + attack);
    // To near-silence rather than to zero: `exponentialRamp` cannot reach 0.
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);

    osc.connect(envelope);
    envelope.connect(master);
    osc.start(start);
    osc.stop(start + attack + decay + 0.01);
  }

  if (design.air) {
    const { centreHz, q, gain: airGain, durationMs, delayMs } = design.air;
    const start = now + delayMs / 1000;
    const length = Math.max(1, Math.round((ctx.sampleRate * durationMs) / 1000));

    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      // Shaped as it is written, so no second gain node is needed for a burst
      // this short.
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = centreHz;
    filter.Q.value = q;

    const airLevel = ctx.createGain();
    airLevel.gain.value = airGain;

    source.connect(filter);
    filter.connect(airLevel);
    airLevel.connect(master);
    source.start(start);
  }

  return true;
}

/** Drops the shared context. For tests and for a full teardown. */
export function resetMessageSounds(): void {
  void context?.close().catch(() => undefined);
  context = undefined;
}
