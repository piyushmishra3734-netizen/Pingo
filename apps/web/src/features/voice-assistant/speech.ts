/**
 * The browser's own speech recognition, kept running while "Hey Pingo" is on.
 *
 * It is the one engine that costs nothing and needs no key, and it is honest
 * about what it is: on Chrome the audio is turned into words by Google, which
 * is said before it is switched on. It stops when the page is hidden, restarts
 * itself when the browser ends a session (they end every so often), and gives
 * up for good if the microphone is refused.
 *
 * Where it does not exist - the installed Android app's WebView has none - the
 * feature is simply not offered, rather than offered and silent.
 */

interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type Ctor = new () => Recognition;

function ctor(): Ctor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const speechSupported = (): boolean => Boolean(ctor());

export interface Listener {
  stop: () => void;
}

export function listen(handlers: {
  /** Every update to what is being said, final or not. */
  onText: (text: string, final: boolean) => void;
  /** The microphone was refused, or recognition is not allowed: it will not retry. */
  onDenied: () => void;
}): Listener | undefined {
  const Recognizer = ctor();
  if (!Recognizer) return undefined;

  let wanted = true;
  let rec: Recognition | undefined;
  let restarts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const begin = () => {
    if (!wanted || document.hidden) return;
    rec = new Recognizer();
    rec.continuous = true;
    rec.interimResults = true;
    // Indian English hears Hinglish far better than American English does.
    rec.lang = 'en-IN';
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      restarts = 0;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]!;
        const text = result[0]?.transcript?.trim();
        if (text) handlers.onText(text, result.isFinal);
      }
    };
    rec.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        wanted = false;
        handlers.onDenied();
      }
    };
    rec.onend = () => {
      // Sessions end on their own. Start again, a little slower each time nothing was heard.
      if (!wanted) return;
      restarts += 1;
      timer = setTimeout(begin, Math.min(4000, 250 * restarts));
    };
    try {
      rec.start();
    } catch {
      // Already started: the end handler will bring it round.
    }
  };

  const visibility = () => {
    if (document.hidden) {
      clearTimeout(timer);
      rec?.abort();
    } else if (wanted) {
      begin();
    }
  };
  document.addEventListener('visibilitychange', visibility);
  begin();

  return {
    stop: () => {
      wanted = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibility);
      if (rec) rec.onend = null;
      rec?.abort();
    },
  };
}
