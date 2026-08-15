import { cn } from '@pingo/ui';
import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';

import { useCall } from './CallProvider.js';

/**
 * Keeps a broken call screen from taking the whole app with it.
 *
 * ## Why this exists
 *
 * PINGO had no error boundary anywhere. React's default for an uncaught render
 * error is to unmount the entire tree, so one bad line in the call overlay did
 * not produce a broken call - it produced a blank page. And because the page
 * itself is still alive, the LiveKit socket stays connected: everybody else on
 * the call goes on seeing a participant who is, from their own point of view,
 * looking at nothing at all. That is the worst possible failure, because it is
 * invisible from both ends.
 *
 * The call surface is the right place for the first one. It is the most
 * stateful thing in the app, it is the only screen that is doing four things at
 * once - media, transport, layout, permissions - and it is the one screen where
 * the user cannot simply navigate away to recover.
 *
 * ## It ends the call rather than pretending
 *
 * A call whose UI has crashed has no controls. There is no mute, no camera, no
 * hang-up, and the microphone is still open and still being published. Leaving
 * that running while showing an apology would be a live microphone in a room
 * whose owner believes the call has ended. So the boundary hangs up, and then
 * says so.
 *
 * ## The message is the error
 *
 * Deliberately, and not prettified. A crash here is a bug in this app, and the
 * fastest route to fixing it is the person who hit it being able to read out
 * what it said. A friendly "something went wrong" throws away the only
 * evidence there was.
 */
export class CallBoundary extends Component<
  { children: ReactNode; onCrash?: () => void },
  { message: string | undefined }
> {
  override state: { message: string | undefined } = { message: undefined };

  static getDerivedStateFromError(error: unknown): { message: string } {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Left in production on purpose. This is the one place where a stack in the
    // console is worth more than a clean log.
    console.error('[call] the call screen crashed', error, info.componentStack);
    this.props.onCrash?.();
  }

  override render(): ReactNode {
    if (this.state.message === undefined) return this.props.children;

    return (
      <div
        role="alertdialog"
        aria-label="The call screen stopped working"
        className={cn(
          'fixed inset-0 z-1000 flex flex-col items-center justify-center gap-4',
          'bg-page px-8 text-center',
        )}
      >
        <EndCrashedCall />
        <h1 className="text-h2 text-ink">The call screen stopped working</h1>
        <p className="max-w-sm text-body text-text-secondary">
          The call has been ended so your microphone is not left open. Nothing
          else in PINGO is affected.
        </p>
        <p
          className={cn(
            'max-w-sm rounded-lg bg-sunken px-3 py-2',
            'font-mono text-caption break-words text-text-tertiary',
          )}
        >
          {this.state.message}
        </p>
        <button
          type="button"
          onClick={() => this.setState({ message: undefined })}
          className="focus-ring rounded-full bg-brand px-5 py-2 text-body font-medium text-white"
        >
          Back to PINGO
        </button>
      </div>
    );
  }
}

/**
 * Hangs up the call the crashed screen was showing.
 *
 * A component rather than a call in `componentDidCatch`, because `useCall` is a
 * hook and the boundary has to be a class. Rendered inside the fallback, which
 * is inside the provider, so it reaches the same service the overlay was using.
 *
 * Renders nothing. Idempotent: `hangUp` checks the call id and does nothing
 * when there is no call, so a re-render cannot end a later one.
 */
function EndCrashedCall() {
  const { hangUp } = useCall();

  useEffect(() => {
    void hangUp().catch(() => {
      // Already gone, or the service is the thing that broke. Either way the
      // message below is still the right thing on screen.
    });
    // Once. A dependency on `hangUp` would re-run it every time the context
    // value changed, which is every second a call is connected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
