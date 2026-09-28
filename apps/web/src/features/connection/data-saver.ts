import { useSyncExternalStore } from 'react';

/**
 * "Use less data" - the person's own say, on top of what the phone reports.
 *
 * `spareNothing()` already holds back work nobody asked for on a poor link or
 * with the phone's data saver on. This is the same switch for somebody whose
 * link is fine but whose data plan is not: nothing is fetched ahead of time,
 * and chat photos wait for a tap. Kept on this device, like the phone's own
 * setting - it is about this connection, not this account.
 */

const KEY = 'pingo:data-saver';
const listeners = new Set<() => void>();

export function dataSaverOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setDataSaver(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    /* storage off: it simply does not stick */
  }
  listeners.forEach((fn) => fn());
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function useDataSaver(): boolean {
  return useSyncExternalStore(subscribe, dataSaverOn, () => false);
}
