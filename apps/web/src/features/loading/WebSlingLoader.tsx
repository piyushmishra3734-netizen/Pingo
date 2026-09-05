/**
 * The loader that plays after the splash, while the app finishes opening.
 *
 * A web hangs from the underside of the word, a thread pulls it down, the silk
 * goes taut, and when it lets go everything springs back past where it started
 * before settling. It loops while the app is not ready and no longer.
 *
 * ## Everything is drawn, nothing is fetched
 *
 * No video, no GIF, no Lottie, no sprite sheet - and no animation library
 * either. This is the screen somebody sees *because* their connection is bad;
 * shipping fifty kilobytes of GSAP so it can say "loading" would be a joke at
 * the expense of the person least able to enjoy it. The spring below is twenty
 * lines and everything else is arithmetic.
 *
 * ## Why this is JavaScript and not CSS keyframes
 *
 * It was CSS, and CSS could not do the one thing that matters: a transform
 * scales a shape, it does not *change* one. The thread has to get genuinely
 * longer as it pulls and shorter as it recoils; the connecting strands have to
 * lose their sag as tension comes on and get it back as it goes. Those are
 * changes to the path data, not a matrix applied over it - and a scaled web
 * reads as a picture being stretched, which is exactly what it looked like.
 *
 * So the geometry is rebuilt every frame from one number: `pull`, driven by a
 * spring. Apex depth, sag, thread length and how far the word has been dragged
 * are all functions of that number, which is also why the word and the web
 * cannot drift apart. They are the same equation.
 */

import { useEffect, useRef } from 'react';

/** The drawing space. Square, and the thread leaves through the bottom. */
const VIEW = 220;

/** How wide the web hangs, as a fraction of the word it hangs from. */
/*
 * A little wider than the word, not narrower.
 *
 * At 0.82 the strands crowded into a bundle and it read as a rake. The
 * reference's web is two thirds of its title, but that title is long - for a
 * short word the same proportion collapses, so this is tuned to the shape
 * rather than copied as a number.
 */
const ANCHOR_SPREAD = 1.15;
const SPOKES = 7;
/** Where along each spoke the connectors cross, from the word downward. */
const RINGS = [0.3, 0.52, 0.74, 0.94];

/** How deep the web hangs at rest, and how much deeper the pull takes it. */
const REST_DEPTH = 58;
const PULL_DEPTH = 34;
/** The tail below the apex at rest, and how far the pull draws it out. */
const REST_TAIL = 34;
const PULL_TAIL = 44;
/** How far the word itself is dragged, in view units. */
const CARRY = 26;
/**
 * How far below the frame the web starts, in view units.
 *
 * The rewrite lost this: the web was simply *there* on the first frame, which
 * is the one thing the reference never does. It arrives from underneath, and
 * arriving is half of what makes it read as thrown rather than drawn.
 */
const RISE = 210;

/**
 * How much a connector sags at rest, as a fraction of the gap it spans.
 *
 * Downward, which sounds obvious and is not what the first version did - it
 * pulled each curve toward the anchor point, which draws a fan. Real webbing
 * hangs, so every connector is a shallow U and the wider ones hang further.
 */
const REST_SAG = 0.34;

/**
 * How much of the apex the strands gather over rather than meeting at.
 *
 * Six units, which is enough to read as a twist and not enough to look frayed.
 */
const THROAT = 6;

/**
 * How flat the droops go at full tension.
 *
 * Not to nothing. A connector whose curve straightens completely has stopped
 * being a curve, and the eye reads that as the strand being replaced rather
 * than stretched. Pulling it to just under half its rest sag is the most it can
 * take and still visibly be the same piece of silk on the way back.
 */
const TAUT_SAG = 0.45;

interface Point {
  x: number;
  y: number;
}

/**
 * A small, repeatable offset, so no two strands are identical.
 *
 * A hash rather than `Math.random`: the same web every frame, because a web
 * that re-rolls its own shape while it is animating is a far worse artefact
 * than a straight line.
 */
function wobble(seed: number, amount: number): number {
  const n = Math.sin(seed * 127.1) * 43758.5453;
  return (n - Math.floor(n) - 0.5) * 2 * amount;
}

const f = (v: number): string => v.toFixed(1);

/**
 * One frame of the web, as path strings.
 *
 * `pull` is 0 at rest and 1 at full stretch, and may overshoot past 1 or below
 * 0 while the spring settles - which is deliberate, and is what makes the
 * recoil look like recoil rather than a return trip.
 */
function build(pull: number, halfSpan: number, topY: number, rise: number) {
  /*
   * Everything is shifted down by however far the web still has to climb. Not a
   * transform on the group - the anchors have to stay stuck to the word, and a
   * transform would carry them away from it.
   */
  const lift = (1 - rise) * RISE;
  const apex: Point = { x: VIEW / 2, y: topY + lift + REST_DEPTH + PULL_DEPTH * pull };

  /*
   * Tension. At rest the silk hangs slack; under load it straightens, and that
   * straightening is the most legible sign that something is being pulled.
   * Floored, because the spring overshoots and a negative sag would bow the
   * strands the wrong way.
   */
  const slack = Math.max(TAUT_SAG, 1 - pull * (1 - TAUT_SAG));

  const anchors: Point[] = Array.from({ length: SPOKES }, (_, i) => ({
    x: VIEW / 2 + (-1 + (2 * i) / (SPOKES - 1)) * halfSpan + wobble(i * 13, 1.6),
    y: topY + lift + wobble(i * 29, 1.1),
  }));

  /*
   * Where each spoke ends, and the fix for the knot at the bottom.
   *
   * Every strand used to terminate on the exact same point, so seven curves and
   * the thread all piled onto one pixel and the result was a blot with legs.
   * Real silk does not meet at a point - it gathers over a short length and
   * twists into the line below, and the outer strands join that throat higher
   * up than the inner ones because they have further to come.
   *
   * So the far end of a spoke is placed along a few units of throat above the
   * apex, by how far out it started. The centre strands still reach the apex;
   * the outermost stop about six units short of it.
   */
  const foot = (i: number): Point => {
    const away = Math.abs(i - (SPOKES - 1) / 2) / ((SPOKES - 1) / 2);
    return {
      x: apex.x + wobble(i * 61, 0.9),
      y: apex.y - away * THROAT,
    };
  };

  const ctrl = (i: number) => {
    const a = anchors[i]!;
    const e = foot(i);
    const bow = (a.x - e.x) * 0.18 * slack + wobble(i * 41, 2.4);
    return { x: (a.x + e.x) / 2 + bow, y: (a.y + e.y) / 2 + 3 * slack };
  };

  /* A spoke: a curve bowing outward, straightening as the load comes on. */
  const spokes = anchors.map((a, i) => {
    const c = ctrl(i);
    const e = foot(i);
    return `M${f(a.x)} ${f(a.y)} Q${f(c.x)} ${f(c.y)} ${f(e.x)} ${f(e.y)}`;
  });

  /** A point on a spoke, so connectors land on the curve rather than near it. */
  const along = (i: number, t: number): Point => {
    const a = anchors[i]!;
    const c = ctrl(i);
    const e = foot(i);
    const u = 1 - t;
    return {
      x: u * u * a.x + 2 * u * t * c.x + t * t * e.x,
      y: u * u * a.y + 2 * u * t * c.y + t * t * e.y,
    };
  };

  /*
   * Connectors, as U-shaped droops between neighbouring spokes.
   *
   * Never removed and never snapped off - the sag goes to almost nothing under
   * load and comes back as the spring unwinds. A strand that vanishes mid-pull
   * is what gave the old version away as a drawing.
   */
  const rings = RINGS.map((t, r) => {
    const row: string[] = [];
    for (let i = 0; i < SPOKES - 1; i += 1) {
      const a = along(i, t);
      const b = along(i + 1, t);
      /*
       * Sag comes from the web's own width, not from the gap between two
       * neighbouring spokes.
       *
       * It was the local gap, and that is why narrowing the web turned it into
       * a rake: seven spokes across a small span leaves five units between
       * them, so the droop was a pixel and a half and every connector went
       * straight. A web's strands hang by an amount the web decides, not by how
       * finely it happens to be divided.
       */
      const droop = halfSpan * REST_SAG * slack + wobble(r * 7 + i, 1.7);
      row.push(
        `M${f(a.x)} ${f(a.y)} Q${f((a.x + b.x) / 2)} ${f((a.y + b.y) / 2 + droop)} ${f(b.x)} ${f(b.y)}`,
      );
    }
    return row.join(' ');
  });

  /*
   * The thread, and it genuinely lengthens. Not a scaled line - the end point
   * moves, which is the only way a rope reads as being paid out.
   */
  const tail = REST_TAIL + PULL_TAIL * pull;
  const line =
    `M${f(apex.x)} ${f(apex.y)} C${f(apex.x + 5 * slack)} ${f(apex.y + tail * 0.34)} ` +
    `${f(apex.x - 4 * slack)} ${f(apex.y + tail * 0.68)} ${f(apex.x + 1)} ${f(apex.y + tail)}`;

  return { spokes, rings, line, slack };
}

export interface WebSlingLoaderProps {
  /** The word the web hangs from. */
  label?: string;
  className?: string;
}

export function WebSlingLoader({ label = 'Loading', className }: WebSlingLoaderProps) {
  const stage = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const textBox = useRef<HTMLDivElement>(null);
  const wordEl = useRef<HTMLSpanElement>(null);
  const sizer = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const full = `${label}…`;
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const paint = (pull: number, rise: number) => {
      const box = textBox.current;
      const host = stage.current;
      const root = svg.current;
      if (!box || !host || !root || !host.clientWidth) return;

      /*
       * The anchors are measured off the word every frame rather than assumed.
       *
       * The label is translated, so its width is whatever that language makes
       * it - and the web has to hang from *that*, not from a number somebody
       * typed while looking at English. It is also what keeps the two attached:
       * they are reading the same box.
       */
      const scale = VIEW / host.clientWidth;
      /*
       * The *word*, not the box around it.
       *
       * `.web-sling-textbox` is stretched edge to edge so the text can centre
       * itself, so its width is the whole stage - and measuring that hung the
       * web off the frame instead of off the letters. It spanned the entire
       * screen and looked like a net thrown at the page. The span is the thing
       * with the word's width in it.
       */
      /*
       * The width of the *finished* word, not the width of what has been typed.
       *
       * Measuring the visible span meant the web sized itself to "Lo" and grew
       * with the letters - two characters wide on the first frames, which is
       * how it ended up looking like a rake. The sizer holds the whole string
       * and is never drawn; it exists only to be measured.
       */
      const w = sizer.current ?? wordEl.current;
      const wordWidth = w ? w.offsetWidth : box.offsetWidth;
      const half = ((wordWidth * ANCHOR_SPREAD) / 2) * scale;
      /*
       * Plus the carry, and leaving this out was the whole of the desync.
       *
       * `offsetTop` is where the box was *laid out*; the word is dragged with a
       * transform, which layout knows nothing about. So the word slid down and
       * its own anchors stayed where they were - the letters ended up above the
       * web, threaded through it, which is what "it isn't holding it" looked
       * like from the outside.
       *
       * The anchors ride the same `pull` the word does, which is the only way
       * the two can be attached rather than merely near each other.
       */
      const topY = (box.offsetTop + box.offsetHeight) * scale + pull * CARRY;

      const { spokes, rings, line } = build(pull, half, topY, rise);

      root.querySelectorAll<SVGPathElement>('[data-spoke]').forEach((el, i) => {
        if (spokes[i]) el.setAttribute('d', spokes[i]!);
      });
      root.querySelectorAll<SVGPathElement>('[data-ring]').forEach((el, i) => {
        /*
         * Only `d`, and nothing else.
         *
         * There was an opacity ride on top of this, and it was wrong: a strand
         * that fades while it is pulled reads as a strand being swapped out.
         * Tension is a shape, not a transparency - the curve flattens, and that
         * is the whole of how a taut thread differs from a slack one. One path
         * per connector, alive for the entire loop, morphed by rewriting its
         * geometry each frame.
         */
        if (rings[i]) el.setAttribute('d', rings[i]!);
      });
      root.querySelector<SVGPathElement>('[data-line]')?.setAttribute('d', line);

      // The word rides the same number, so the two cannot fall out of step.
      box.style.transform = `translateY(${(pull * CARRY) / scale}px)`;
    };

    if (reduced) {
      if (wordEl.current) wordEl.current.textContent = full;
      const id = requestAnimationFrame(() => paint(0, 1));
      return () => cancelAnimationFrame(id);
    }

    /*
     * The spring, and the reason there is no library in here.
     *
     * A semi-implicit Euler step on a damped harmonic oscillator: stiffness
     * pulls the value toward its target, damping bleeds off the energy, and
     * what is left over is the overshoot. `DAMPING` is deliberately under
     * critical for this stiffness, so the release goes past zero and comes back
     * - that wobble is the whole point, and no cubic-bezier can produce it
     * because a bezier cannot leave the range it was given.
     */
    let value = 0;
    let velocity = 0;
    const STIFFNESS = 165;
    const DAMPING = 11;

    /*
     * The arrival, on its own spring and a stiffer one.
     *
     * It is a different kind of movement from the pull: something thrown lands
     * and stops, it does not wobble about for half a second first. Higher
     * stiffness and damping close to critical gives a fast climb that settles
     * once, which is what the reference does.
     */
    let rise = 0;
    let riseVel = 0;
    const RISE_STIFF = 120;
    /*
     * Just over critical, so it lands and stays.
     *
     * At 20 it overshot its own target and carried the web up *past* the word,
     * which put the letters inside the net for half a second every cycle. A
     * thrown thing settles onto its mark; it does not sail through it.
     */
    const RISE_DAMP = 24;

    /** Milliseconds, and the target the spring is chasing in each leg. */
    /** Milliseconds, then the pull target, then whether the web is up. */
    const CYCLE: [number, number, number][] = [
      [820, 0, 1], // climbing into place while the word types
      [1250, 0, 1], // hanging, slack
      [2100, 1, 1], // pulled down, taut
      [3050, 0, 1], // released - the spring overshoots and settles
      [3700, 0, 0], // and drops away, so the next loop is an arrival again
    ];
    const LOOP = CYCLE[CYCLE.length - 1]![0];

    let phase = 0;
    let last = performance.now();
    let raf = 0;
    let shown = -1;

    const step = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      phase = (phase + dt * 1000) % LOOP;

      const leg = CYCLE.find(([until]) => phase < until) ?? CYCLE[CYCLE.length - 1]!;
      velocity += (-STIFFNESS * (value - leg[1]) - DAMPING * velocity) * dt;
      value += velocity * dt;

      riseVel += (-RISE_STIFF * (rise - leg[2]) - RISE_DAMP * riseVel) * dt;
      rise += riseVel * dt;

      /*
       * Typed by character count, not by clipping a width. A clip reveals half
       * a letter at a time on a proportional font; a count is what typing is.
       */
      const want =
        phase < 760 ? Math.min(full.length, Math.round((phase / 640) * full.length)) : full.length;
      if (want !== shown) {
        shown = want;
        if (wordEl.current) wordEl.current.textContent = full.slice(0, want);
      }

      paint(value, rise);
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [label]);

  return (
    <div
      className={`web-sling ${className ?? ''}`}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="web-sling-stage" ref={stage}>
        <div className="web-sling-textbox" ref={textBox}>
          {/*
            Written by the loop, not by React.
            
            The typing used to be `useState` updated from inside the animation
            frame - ten re-renders a second, and the effect that owns the loop
            was being torn down and rebuilt underneath it, so the whole thing
            froze about a second in and looked like a still picture. A frame
            loop has no business driving component state: it already writes the
            path data straight to the DOM, and the text is the same kind of
            thing. React renders this shell once and never again.
          */}
          <span className="web-sling-word" aria-hidden ref={wordEl} />
          {/* Never seen, only measured. See `wordWidth` in the loop. */}
          <span className="web-sling-sizer" aria-hidden ref={sizer}>
            {`${label}…`}
          </span>
        </div>

        {/*
          Every strand is a Bezier and every one is rewritten each frame. There
          is not a single <line> in here and nothing static to give the shape
          away as artwork. `d` starts empty; the first frame fills it.
        */}
        <svg
          className="web-sling-web"
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          fill="none"
          aria-hidden
          ref={svg}
        >
          <path className="web-sling-line" data-line d="" />
          {Array.from({ length: SPOKES }, (_, i) => (
            <path key={`s${i}`} className="web-sling-spoke" data-spoke d="" />
          ))}
          {RINGS.map((_, i) => (
            <path key={`r${i}`} className="web-sling-ring" data-ring d="" />
          ))}
        </svg>
      </div>
    </div>
  );
}
