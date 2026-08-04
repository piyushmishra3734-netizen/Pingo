/**
 * The card shown the first time PINGO is opened each day.
 *
 * ## Everything about it is designed to be ignorable
 *
 * It is not a modal: nothing behind it is disabled, there is no scrim, and it
 * never takes focus. It slides down, waits five seconds, and leaves. It can be
 * swiped away, dismissed with Escape, or simply not looked at — and in every
 * one of those cases nothing is lost, because it is a greeting rather than a
 * gate.
 *
 * A blocking modal would make the first thing PINGO does each day an
 * interruption, and the philosophy this is built to is that Journey should
 * remind, never pressure.
 *
 * ## Once a day, and the day is local
 *
 * Stored as a local date string rather than a timestamp plus arithmetic, so
 * "today" means the user's today across time zones and the check cannot drift
 * by an hour twice a year.
 */
import { Button, cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

import type { Mission } from './dummy-journey.js';
import { greeting } from './language.js';

const SEEN_KEY = 'pingo.journey.daily-card';
/** Long enough to read three short lines, short enough not to linger. */
const AUTO_DISMISS_MS = 5_000;

/** The local calendar day, as the user's device reckons it. */
function today(now = new Date()): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

/** Has the card already been shown today? Safe when storage is unavailable. */
export function shownToday(now = new Date()): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === today(now);
  } catch {
    // Private mode, or storage disabled. Showing it once per session is a
    // better failure than showing it on every navigation.
    return true;
  }
}

function markShown(now = new Date()): void {
  try {
    window.localStorage.setItem(SEEN_KEY, today(now));
  } catch {
    /* nothing to remember it with; the session will have to do */
  }
}

export function DailyJourneyCard({
  missions,
  name,
  note,
}: {
  missions: Mission[];
  name?: string;
  /** One line under the list. Never a target, never a warning. */
  note: string;
}) {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const dragStart = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (shownToday()) return;
    markShown();
    setVisible(true);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => setLeaving(true), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [visible]);

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setVisible(false), 260);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLeaving(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      onPointerDown={(event) => {
        dragStart.current = event.clientY;
      }}
      onPointerUp={(event) => {
        // Upward swipe only. A downward drag on a card that entered from the
        // top would be pulling it further in, which is not a dismissal.
        if (dragStart.current !== undefined && dragStart.current - event.clientY > 24) {
          setLeaving(true);
        }
        dragStart.current = undefined;
      }}
      className={cn(
        // Sits under the header and above the list, never over the whole app.
        'pointer-events-auto fixed inset-x-3 top-[max(4.5rem,calc(env(safe-area-inset-top)+3.75rem))] z-200',
        'mx-auto max-w-md rounded-2xl border border-line/60 glass-surface p-4 shadow-lg',
        'motion-safe:transition-[transform,opacity] motion-safe:duration-slow motion-safe:ease-standard',
        leaving ? '-translate-y-3 opacity-0' : 'translate-y-0 opacity-100',
        'motion-safe:animate-panel-in',
      )}
    >
      <p className="text-body font-medium">{greeting(new Date(), name)}</p>

      <p className="pt-3 text-caption uppercase tracking-wide text-text-tertiary">Today’s journey</p>

      <ul className="space-y-1.5 pt-2">
        {missions.map((mission) => (
          <li key={mission.id} className="flex items-center gap-2.5 text-body">
            <span
              aria-hidden
              className={cn(
                'h-4 w-4 shrink-0 rounded-full border',
                mission.done >= mission.target ? 'border-brand bg-brand' : 'border-line',
              )}
            />
            <span className="min-w-0 flex-1 truncate">{mission.title}</span>
          </li>
        ))}
      </ul>

      <p className="pt-3 text-caption text-text-secondary">{note}</p>

      <div className="flex justify-end pt-3">
        <Button variant="secondary" className="h-9" onClick={() => setLeaving(true)}>
          Continue
        </Button>
      </div>
    </div>
  );
}
