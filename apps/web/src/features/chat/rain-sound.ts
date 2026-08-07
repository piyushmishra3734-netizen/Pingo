/**
 * The sound of the rain, kept quiet and kept optional.
 *
 * ## Why this is more delicate than it looks
 *
 * A messaging app that starts making noise on its own is a messaging app
 * people uninstall. Three rules follow from that and none of them is
 * negotiable: it only ever plays when somebody has chosen the rain wallpaper,
 * it stops the moment the conversation is not on screen, and there is a switch.
 *
 * ## Autoplay
 *
 * Browsers refuse to play audio until the person has interacted with the page,
 * and they are right to. Choosing the wallpaper *is* an interaction, so it
 * starts immediately in that case; on a later visit the play is refused, so
 * this waits for the first tap or key anywhere and starts then. Nothing is
 * reported when it is blocked - a refused autoplay is the browser working
 * correctly, not an error worth a console line.
 *
 * ## The file
 *
 * `public/sound/rain.mp3`, CC0, credited in the folder beside it. Fetched only
 * when it is needed, so the download belongs to the people who turned rain on
 * and to nobody else.
 */

const KEY = 'pingo:rain-sound';

/** Quiet enough to sit under a conversation rather than in front of one. */
const VOLUME = 0.22;

/** How long to fade in and out. A loop that snaps on is a jump scare. */
const FADE_MS = 1400;

export function rainSoundEnabled(): boolean {
  try {
    // On by default: somebody who picked a live rain wallpaper has said what
    // they want, and the switch is there for the ones who want it silent.
    return window.localStorage.getItem(KEY) !== 'off';
  } catch {
    return false;
  }
}

export function setRainSoundEnabled(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // A blocked store means the choice does not survive the session. It is
    // still worth honouring for this one.
  }
}

export interface SoundHandle {
  stop: () => void;
}

export function startRainSound(): SoundHandle {
  const nothing: SoundHandle = { stop: () => undefined };
  if (typeof window === 'undefined' || !rainSoundEnabled()) return nothing;

  const audio = new Audio('/sound/rain.mp3');
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = 0;

  let stopped = false;
  let fade = 0;

  /** Walks the volume to a target rather than jumping to it. */
  function to(target: number, then?: () => void) {
    window.clearInterval(fade);
    const from = audio.volume;
    const started = performance.now();
    fade = window.setInterval(() => {
      const t = Math.min(1, (performance.now() - started) / FADE_MS);
      audio.volume = from + (target - from) * t;
      if (t >= 1) {
        window.clearInterval(fade);
        then?.();
      }
    }, 40);
  }

  function play() {
    if (stopped) return;
    void audio
      .play()
      .then(() => to(VOLUME))
      .catch(() => {
        /*
         * Refused, because nothing has been tapped yet. Waiting for the first
         * gesture is the whole remedy - and `once` on each, so a person who
         * never interacts is never left with a listener.
         */
        const go = () => {
          window.removeEventListener('pointerdown', go);
          window.removeEventListener('keydown', go);
          if (!stopped) void audio.play().then(() => to(VOLUME)).catch(() => undefined);
        };
        window.addEventListener('pointerdown', go, { once: true });
        window.addEventListener('keydown', go, { once: true });
      });
  }

  const onVisibility = () => {
    if (document.hidden) audio.pause();
    else play();
  };
  document.addEventListener('visibilitychange', onVisibility);

  play();

  return {
    stop: () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisibility);
      // Faded out rather than cut, then released - a loop that stops dead as
      // you leave a chat is more noticeable than the loop ever was.
      to(0, () => {
        audio.pause();
        audio.src = '';
      });
    },
  };
}
