import { useChat } from '@pingo/core';
import { cn } from '@pingo/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * The line under the dock. Hold it and PINGO is listening.
 *
 * ## Why a line and not a button
 *
 * Both phones already taught this gesture. Android puts a thin bar at the
 * bottom of every screen and holding it brings Gemini up from underneath; iOS
 * does the same shape for Siri. Nobody had to be told - they held the thing at
 * the bottom because that is where the assistant lives now.
 *
 * So this is deliberately not a labelled button with a microphone on it. A
 * sixth item in the dock would be one more grey glyph to skip past, and it
 * would say "here is a feature" rather than "the assistant is right there".
 * The line says nothing until it is touched, which is the point.
 *
 * ## What the hold has to feel like
 *
 * The failure mode of every long-press is not knowing whether it is working.
 * So the pill *charges*: it widens, takes the brand gradient and blooms a glow
 * underneath, over exactly the time the hold needs. If a hand lifts early the
 * charge falls back and nothing happens - the gesture is legible in both
 * directions.
 *
 * Two taps of haptics, not one: a light tick when the hold registers and a
 * firmer one when it fires. That pairing is what makes a press feel like it
 * landed on something physical rather than on glass.
 *
 * A plain tap opens the same conversation without the call, because a control
 * that does nothing when tapped reads as broken no matter how good the hold is.
 */

/**
 * How long the hold has to last.
 *
 * Android's own long-press is 400 ms and this sits just under it: long enough
 * that a thumb resting on the edge of the screen never fires it, short enough
 * that nobody wonders whether it is working - and the charge animation is
 * telling them it is for the whole duration anyway.
 */
const HOLD_MS = 380;

export function AiPill() {
  const navigate = useNavigate();
  const { service } = useChat();

  /** Charging, and then held long enough. Drives everything visual. */
  const [charging, setCharging] = useState(false);
  const timer = useRef<number>(0);
  const fired = useRef(false);
  /** Guards against a second press while the conversation id is being fetched. */
  const opening = useRef(false);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const open = useCallback(
    async (voice: boolean) => {
      if (opening.current) return;
      opening.current = true;
      try {
        const id = await service.ensureAiConversation();
        /*
         * The call is opened by the thread, not from here.
         *
         * `VoiceCall` needs the thread's own `ask` - the one that sends the
         * turn as an ordinary message and waits for the reply in the same list
         * the person would be reading. Routing through the thread means a call
         * started from this line is the same call as one started from the
         * header, rather than a second implementation to keep in step.
         */
        navigate(`/chats/${id}`, voice ? { state: { voice: true } } : {});
      } catch {
        // No conversation, nothing to open. Silent: this is a gesture, and a
        // gesture that raises an error banner is worse than one that does
        // nothing.
      } finally {
        opening.current = false;
      }
    },
    [navigate, service],
  );

  const begin = () => {
    fired.current = false;
    setCharging(true);
    // A light tick the moment the hold is recognised, so the charge that
    // follows is felt as a response rather than as decoration.
    navigator.vibrate?.(6);
    timer.current = window.setTimeout(() => {
      fired.current = true;
      setCharging(false);
      /*
       * Firmer, and in two beats. A single buzz reads as a notification; a
       * short-long pair reads as a latch opening, which is what just happened.
       */
      navigator.vibrate?.([14, 26, 22]);
      void open(true);
    }, HOLD_MS);
  };

  const end = (fire: boolean) => {
    window.clearTimeout(timer.current);
    setCharging(false);
    if (fire && !fired.current) void open(false);
    fired.current = false;
  };

  return (
    <button
      type="button"
      aria-label="Hold to talk to PINGO"
      /*
       * Pointer events rather than touch or mouse: one path for a thumb, a
       * stylus and a trackpad, and `pointercancel` is the only reliable signal
       * that the browser has taken the gesture away to scroll with it.
       */
      onPointerDown={(event) => {
        // Only the primary button, and never a right-click.
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        begin();
      }}
      onPointerUp={() => end(true)}
      onPointerCancel={() => end(false)}
      onPointerLeave={() => end(false)}
      onContextMenu={(event) => event.preventDefault()}
      // Enter and Space go straight to the call: a keyboard has no hold, and
      // asking somebody to keep a key down is not the same gesture.
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        void open(true);
      }}
      className={cn(
        'group focus-ring relative grid h-7 w-40 touch-none place-items-center',
        'select-none rounded-full',
      )}
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      {/*
        The bloom under the line, which is the thing that reads as "rising".

        It lives behind the pill and scales up from nothing while the hold
        charges, so the screen looks like it is about to hand something over
        before it does. Blurred rather than drawn: an edge here would be a
        shape, and this is meant to be light.
      */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute bottom-0 h-8 w-32 rounded-[50%]',
          'bg-brand-gradient blur-xl',
          'transition-[opacity,transform] duration-slow ease-liquid',
          charging ? 'scale-100 opacity-55' : 'scale-50 opacity-0',
        )}
      />

      {/* The line itself. At rest it is barely there, which is correct. */}
      <span
        aria-hidden
        className={cn(
          'relative h-[3px] rounded-full',
          /*
            Duration matched to the hold, easing that starts slow and finishes
            fast: the pill appears to gather itself and then commit, which is
            the same shape as the gesture.
          */
          'transition-[width,background-color,box-shadow,transform] ease-liquid',
          charging
            ? 'w-28 scale-y-[1.6] bg-brand-gradient shadow-[0_0_14px_2px_color-mix(in_srgb,var(--gradient-from,#7c5cff)_55%,transparent)]'
            // `ink` rather than a fixed white: the dock floats over both a
            // white page and a near-black one, and the theme token is the only
            // thing that is the right colour on each.
            : 'w-16 bg-ink/30',
        )}
        style={{ transitionDuration: charging ? `${HOLD_MS}ms` : '220ms' }}
      />
    </button>
  );
}
