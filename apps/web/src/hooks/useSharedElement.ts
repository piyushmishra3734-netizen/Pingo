import { useLayoutEffect, type RefObject } from 'react';

/**
 * The same thing, in two places, moving between them.
 *
 * Tapping a conversation replaced the whole screen: the avatar you pressed
 * vanished and a different avatar appeared in a header somewhere else. Nothing
 * connected the two, so opening a chat read as a page load rather than as going
 * *into* the thing you touched. This makes the header avatar arrive from
 * exactly where the row's avatar was, which is the difference between navigating
 * and being taken somewhere.
 *
 * ## The destination moves; nothing is cloned
 *
 * The usual approach flies a copy of the source across and swaps it for the
 * real element at the end, which means an element that belongs to neither
 * screen, a z-index fight with everything it passes over, and a visible seam if
 * the hand-off is a frame late.
 *
 * Here the *real* header avatar is transformed back to where the source was and
 * that transform is animated away — FLIP, across a route change instead of
 * across a re-render. There is only ever one avatar, and it is the one that
 * stays.
 *
 * ## Why the rect is remembered rather than passed
 *
 * The source unmounts before the destination mounts on a phone, so there is no
 * moment where both exist and no prop that could carry it. A module-level
 * handoff is the only shape that survives the gap.
 *
 * It expires, and that matters more than it looks: without a deadline, tapping
 * a row, going back, and reaching the same thread an hour later by another
 * route would fly the avatar in from a position the user never saw. A rect is
 * only true for the instant it was measured.
 */

interface Handoff {
  rect: DOMRect;
  at: number;
}

const pending = new Map<string, Handoff>();

/**
 * A navigation's worth of milliseconds.
 *
 * Long enough to cover a route change and a first paint on a slow device,
 * short enough that a rect can never outlive the layout it describes.
 */
const FRESH_MS = 600;

/** Records where something is, for whatever picks it up next. */
export function rememberSharedElement(key: string, element: Element | null): void {
  if (!element) return;
  pending.set(key, { rect: element.getBoundingClientRect(), at: Date.now() });
}

function takeSharedElement(key: string): DOMRect | undefined {
  const handoff = pending.get(key);
  // Taken, not read: a hand-off is for one arrival. Leaving it would replay the
  // flight every time the destination re-rendered.
  pending.delete(key);
  if (!handoff || Date.now() - handoff.at > FRESH_MS) return undefined;
  return handoff.rect;
}

/**
 * Flies `ref` in from wherever `key` was last seen, if that was just now.
 *
 * A no-op when there is no hand-off waiting, which is most of the time — the
 * thread opened from a notification, a deep link or a reload has nothing to
 * travel from and simply appears.
 */
export function useSharedElement(
  ref: RefObject<HTMLElement | null>,
  key: string,
): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const from = takeSharedElement(key);
    if (!from) return;

    const to = element.getBoundingClientRect();
    if (!to.width || !from.width) return;

    /*
     * Scaled from the centre of each rect, not the corner.
     *
     * Avatars are circles of different sizes, and matching their top-left
     * corners makes the small one appear to grow out of the large one's edge.
     * Centres are what the eye actually tracks between two circles.
     */
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const scale = from.width / to.width;

    // Nothing worth animating — the two are in the same place, which happens on
    // desktop when the header sits directly over the row that opened it.
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2 && Math.abs(scale - 1) < 0.05) return;

    element.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
        { transform: 'translate(0, 0) scale(1)' },
      ],
      {
        duration: 340,
        // The liquid curve: a long settle with no overshoot. A face bouncing
        // on arrival is the one place a spring reads as a glitch.
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        composite: 'replace',
      },
    );
  }, [ref, key]);
}
