/**
 * The loader that plays after the splash, while the app finishes opening.
 *
 * A thin ring with a short arc travelling around it, and the reason it is a
 * ring is the reason Telegram uses one: this screen exists *because* somebody
 * is waiting, and the one thing it must not do is ask for attention. An
 * animation that is interesting is an animation you notice, and noticing it
 * means noticing the wait.
 *
 * ## What this replaced, and why
 *
 * A four-hundred-and-sixty line hand-drawn spider web on a spring, rebuilt
 * every frame from a physics simulation. It was the better piece of work and
 * the worse thing to look at on a slow connection: a performance, playing to
 * somebody who wanted their chats. This is twenty lines and disappears.
 *
 * ## Still nothing is fetched
 *
 * That much the web had right and it survives here. No video, no GIF, no
 * Lottie, no animation library - an SVG circle, one dash, and a rotation that
 * reuses the `dot-orbit` keyframe already in the tokens. Shipping bytes to
 * apologise for slow bytes is a joke at the expense of the person least able
 * to enjoy it.
 */

/** Big enough to read as deliberate, small enough not to be an event. */
const SIZE = 30;
const STROKE = 2.5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * How much of the ring the moving arc covers.
 *
 * A quarter reads as travelling. Much less looks broken, much more looks like a
 * ring that is merely turning.
 */
const ARC = 0.26;

export function AppLoader({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3" role="status" aria-label={label}>
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        aria-hidden
        className="app-loader"
      >
        {/*
          The track is what keeps the arc from reading as a fragment adrift.
          Faint, because it is context and not content.
        */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          className="text-line"
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${CIRCUMFERENCE * ARC} ${CIRCUMFERENCE}`}
          className="app-loader-arc text-brand"
        />
      </svg>

      <span className="text-caption text-text-tertiary">{label}</span>
    </div>
  );
}
