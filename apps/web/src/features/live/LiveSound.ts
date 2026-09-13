/**
 * The sound of a live room.
 *
 * Ten people tapping in silence is why a full room can still feel dead.
 * TikTok's rooms tick, chime and fanfare over everything; this is the same
 * vocabulary synthesized live in WebAudio - no files, no downloads, nothing
 * to decode mid-broadcast. Tiny sine blips at low gain: texture, not alarm.
 *
 * Autoplay rules mean sound needs a gesture first. The context is created on
 * the first pointer-down anywhere on a live screen and resumed inside every
 * tap handler, so by the time anything plays, the browser has already said
 * yes. One master mute lives in localStorage and rides on every screen.
 */

import { useEffect, useState } from 'react';

const MUTE_KEY = 'pingo:live-muted';

let context: AudioContext | undefined;
let lastTick = 0;

function ensure(): AudioContext | undefined {
  try {
    if (!context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return undefined;
      context = new Ctor();
    }
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    return context.state === 'running' ? context : undefined;
  } catch {
    return undefined;
  }
}

export function isLiveMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setLiveMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // A mute that cannot persist simply applies for this visit.
  }
}

export function useLiveMuted(): [boolean, (muted: boolean) => void] {
  const [muted, setMuted] = useState(isLiveMuted);
  return [
    muted,
    (next: boolean) => {
      setLiveMuted(next);
      setMuted(next);
    },
  ];
}

/** Unlocks audio on the first touch of a live screen. Call once per mount. */
export function useUnlockLiveSound(): void {
  useEffect(() => {
    const unlock = () => {
      ensure();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);
}

interface Tone {
  /** Hz. */
  at: number;
  /** Seconds from now. */
  when?: number;
  /** Seconds long. */
  for?: number;
  /** 0-1. */
  loud?: number;
  /** Sine is round, triangle has an edge. */
  shape?: OscillatorType;
}

function play(tones: Tone[]): void {
  if (isLiveMuted()) return;
  const audio = ensure();
  if (!audio) return;
  try {
    const now = audio.currentTime;
    for (const tone of tones) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = tone.shape ?? 'sine';
      osc.frequency.value = tone.at;
      const start = now + (tone.when ?? 0);
      const length = tone.for ?? 0.09;
      const loud = (tone.loud ?? 0.12) * 0.5;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, loud), start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
      osc.connect(gain).connect(audio.destination);
      osc.start(start);
      osc.stop(start + length + 0.02);
    }
  } catch {
    // Sound must never break picture.
  }
}

/** A heart landing. Pitch climbs with the combo - the TikTok ladder. */
export function soundHeart(combo: number): void {
  const now = Date.now();
  if (now - lastTick < 70) return;
  lastTick = now;
  const step = Math.min(combo, 24);
  play([{ at: 660 + step * 22, for: 0.07, loud: 0.1, shape: 'triangle' }]);
}

/** Your own tap answers instantly, under your thumb. */
export function soundTap(): void {
  play([{ at: 520, for: 0.05, loud: 0.08 }]);
}

/** Someone walked in. Throttled by the caller. */
export function soundJoin(): void {
  play([
    { at: 740, for: 0.07, loud: 0.07 },
    { at: 988, for: 0.09, loud: 0.07, when: 0.07 },
  ]);
}

/** A wave landing on you. */
export function soundWave(): void {
  play([
    { at: 880, for: 0.08, loud: 0.09 },
    { at: 1174, for: 0.1, loud: 0.09, when: 0.08 },
    { at: 1568, for: 0.12, loud: 0.08, when: 0.16 },
  ]);
}

/** A guest stepping on air. */
export function soundGuest(): void {
  play([
    { at: 523, for: 0.1, loud: 0.1 },
    { at: 784, for: 0.14, loud: 0.1, when: 0.1 },
  ]);
}

/** The goal, hit. A tiny fanfare for the whole room. */
export function soundGoal(): void {
  play([
    { at: 523, for: 0.12, loud: 0.11 },
    { at: 659, for: 0.12, loud: 0.11, when: 0.11 },
    { at: 784, for: 0.12, loud: 0.11, when: 0.22 },
    { at: 1046, for: 0.22, loud: 0.12, when: 0.33 },
  ]);
}

/** Going live: a warm rise, with the room. */
export function soundLive(): void {
  play([
    { at: 392, for: 0.12, loud: 0.1 },
    { at: 523, for: 0.12, loud: 0.1, when: 0.1 },
    { at: 659, for: 0.18, loud: 0.11, when: 0.2 },
  ]);
}

/** Leaving: one step down, gentle. */
export function soundEnd(): void {
  play([
    { at: 659, for: 0.12, loud: 0.09 },
    { at: 440, for: 0.18, loud: 0.09, when: 0.12 },
  ]);
}
