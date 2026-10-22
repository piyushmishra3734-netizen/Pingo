import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';

import { run } from './actions.js';
import { afterWake, parseCommand } from './commands.js';
import { listen, speechSupported, type Listener } from './speech.js';

/**
 * "Hey Pingo", while the app is open and the person has switched it on.
 *
 * The page listens continuously; nothing is kept or sent anywhere by PINGO. When
 * the wake phrase is heard, what follows it (in the same breath, or in the next
 * few seconds) is read as a command and run. Only music and Pingo TV commands
 * exist, so a mis-hearing costs a wrong song, never a message or a credit.
 */

const KEY = 'pingo:heyPingo';
const WINDOW_MS = 7000;

const subs = new Set<() => void>();
const read = (): boolean => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};
export function setHeyPingo(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // private mode: it lasts until the page closes
  }
  subs.forEach((fn) => fn());
}
const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => subs.delete(fn);
};
export const useHeyPingoOn = (): boolean => useSyncExternalStore(subscribe, read, () => false);
export { speechSupported };

export type HeyState =
  | { phase: 'idle' }
  | { phase: 'awake'; heard: string }
  | { phase: 'done'; message: string };

export function useHeyPingo(): HeyState {
  const on = useHeyPingoOn();
  const navigate = useNavigate();
  const [state, setState] = useState<HeyState>({ phase: 'idle' });
  const goRef = useRef(navigate);
  goRef.current = navigate;
  // True from the wake phrase until a command is read or the window runs out.
  const awakeUntil = useRef(0);
  const busy = useRef(false);
  const reset = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const finish = useCallback((message: string) => {
    awakeUntil.current = 0;
    setState({ phase: 'done', message });
    clearTimeout(reset.current);
    reset.current = setTimeout(() => setState({ phase: 'idle' }), 2600);
  }, []);

  useEffect(() => {
    if (!on || !speechSupported()) return;

    const handle = async (text: string, final: boolean) => {
      if (busy.current) return;
      const now = Date.now();
      let said: string | null = null;

      const after = afterWake(text);
      if (after !== null) {
        awakeUntil.current = now + WINDOW_MS;
        said = after;
        setState({ phase: 'awake', heard: after });
      } else if (now < awakeUntil.current) {
        said = text;
        setState({ phase: 'awake', heard: text });
      }
      if (said === null) return;

      // Wait for the sentence to finish before acting on it.
      if (!final || !said) return;
      const command = parseCommand(said);
      if (!command) return finish("Didn't catch that");
      busy.current = true;
      try {
        finish(await run(command, (path, state) => goRef.current(path, { state })));
      } catch {
        finish("That didn't work");
      } finally {
        busy.current = false;
      }
    };

    const listener: Listener | undefined = listen({
      onText: (text, final) => void handle(text, final),
      onDenied: () => {
        setHeyPingo(false);
        finish('Microphone is blocked');
      },
    });
    return () => listener?.stop();
  }, [on, finish]);

  return on ? state : { phase: 'idle' };
}
