/**
 * Rain on the glass, behind a conversation.
 *
 * ## How a raindrop is drawn
 *
 * Not as a blob of white. A drop on a window is a lens: the scene behind it
 * arrives through a bead of water, magnified and turned over, and it is sharp
 * while everything around it is not. So the background is painted twice - once
 * blurred, as the wet pane, and then once more inside each drop, magnified and
 * flipped, clipped to the bead. That single trick is the whole effect; the
 * highlight and the shadow on top of it are seasoning.
 *
 * ## Why the drops slide and eat each other
 *
 * Rain on a window is not a field of static dots. Small drops cling, big ones
 * lose their grip and run, and a running one sweeps up everything in its path
 * and gets heavier as it goes - which is why real trails accelerate and why a
 * pane clears in streaks rather than evenly. A version without that reads as a
 * texture rather than as weather, and everyone can tell, even if not why.
 *
 * ## What it costs, and what stops it
 *
 * One canvas, one animation frame, a few hundred drops. It stops itself when
 * the tab is hidden, when the thread is off screen, and when the person has
 * asked for less motion - in that last case the drops are still drawn, just
 * still, because the picture is the point and the movement is the flourish.
 */

interface Drop {
  x: number;
  y: number;
  r: number;
  /** Pixels per second. Zero while it is still clinging. */
  speed: number;
  /** Sideways wander, so a trail is not a ruled line. */
  drift: number;
  /** Counts down; at zero a clinging drop may let go. */
  cling: number;
  /**
   * What it has left behind, newest last.
   *
   * A drop running down a window does not travel over dry glass - it drags a
   * tail of water and leaves a line of small beads clinging where it passed.
   * That tail is most of what makes rain read as rain: without it the drops
   * are dots that change position, and the eye reads them as a moving texture
   * rather than as water going somewhere.
   */
  trail: { x: number; y: number; r: number }[];
  /** Distance since the last bead was dropped, so trails do not clump. */
  since: number;
}

/** Below this radius a drop never moves on its own. */
const CLING_RADIUS = 3.4;

/** Above this, it is heavy enough that it always runs. */
const RUN_RADIUS = 5.6;

export interface RainOptions {
  /** The scene behind the water. A data URL, an object URL, or a CSS gradient. */
  image?: string;
  /** Drops per second arriving. Higher is a downpour. */
  rate?: number;
  /** Stop animating and draw one still frame. */
  still?: boolean;
}

export interface RainHandle {
  stop: () => void;
}

/**
 * Starts rain on a canvas.
 *
 * @returns a handle whose `stop` releases the frame loop and the observers.
 * Calling it twice is safe.
 */
export function startRain(canvas: HTMLCanvasElement, options: RainOptions = {}): RainHandle {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { stop: () => undefined };

  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const still = options.still ?? reduced;

  /*
   * Two copies of the scene: one sharp, for the insides of drops, and one
   * blurred, for the pane itself. Drawn to offscreen canvases once rather than
   * filtered every frame - `filter: blur()` on a per-frame draw is the single
   * most expensive thing this could do.
   */
  let sharp: HTMLCanvasElement | undefined;
  let blurred: HTMLCanvasElement | undefined;

  let drops: Drop[] = [];
  let raf = 0;
  let last = 0;
  let running = false;
  let width = 0;
  let height = 0;
  let dpr = 1;

  const rate = options.rate ?? 26;

  function buildScene(source: CanvasImageSource, sw: number, sh: number) {
    const make = (blur: number) => {
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const g = c.getContext('2d');
      if (!g) return c;
      if (blur > 0) g.filter = `blur(${blur}px)`;
      // Cover, the way a background-size: cover would.
      const scale = Math.max(width / sw, height / sh);
      const dw = sw * scale;
      const dh = sh * scale;
      g.drawImage(source, (width - dw) / 2, (height - dh) / 2, dw, dh);
      return c;
    };
    sharp = make(0);
    /*
     * The pane is not evenly frosted - it is wet. A modest blur reads as water
     * on the glass; a heavy one reads as the picture being out of focus, which
     * is a different and much less interesting thing.
     */
    blurred = make(14 * dpr);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    width = Math.max(1, Math.round(rect.width * dpr));
    height = Math.max(1, Math.round(rect.height * dpr));
    canvas.width = width;
    canvas.height = height;
    if (scene) buildScene(scene, sceneW, sceneH);
    // Drops are positioned in device pixels, so a resize invalidates them.
    drops = [];
    seed();
  }

  function seed() {
    const target = still ? 160 : 70;
    for (let i = 0; i < target; i += 1) drops.push(born(Math.random() * height));
  }

  function born(y: number): Drop {
    /*
     * Sizes are not uniform. Real rain leaves a great many pinpricks and a few
     * fat ones, so the radius is biased small - a flat distribution gives an
     * evenly-spotted pane that looks printed.
     */
    const bias = Math.random() ** 2.4;
    const r = (1.6 + bias * 7) * dpr;
    return {
      x: Math.random() * width,
      y,
      r,
      speed: 0,
      drift: (Math.random() - 0.5) * 6 * dpr,
      cling: 0.4 + Math.random() * 3.5,
      trail: [],
      since: 0,
    };
  }

  /**
   * One bead, drawn as a lens.
   *
   * @param stretch how much taller than wide. A still drop is round; a running
   * one is pulled out behind itself, which is what a drop on a window actually
   * looks like and the reason a field of perfect circles reads as bubbles.
   */
  function drawBead(x: number, y: number, r: number, stretch = 1) {
    if (!sharp || !ctx) return;
    const ry = r * stretch;

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y, r, ry, 0, 0, Math.PI * 2);
    ctx.clip();

    /*
     * The lens. A bead of water inverts what is behind it and magnifies it, so
     * the crop is taken from a small area, flipped, and blown up to fill the
     * drop. `1.9` is where it stops looking like a smudge and starts looking
     * like water; past about 3 the crop is so small that every drop shows the
     * same flat colour.
     */
    const magnify = 1.9;
    const crop = (r * 2) / magnify;
    ctx.translate(x, y);
    ctx.scale(1, -1);
    ctx.drawImage(sharp, x - crop / 2, y - crop / 2, crop, crop, -r, -ry, r * 2, ry * 2);
    ctx.restore();

    // A bead is brightest where the light enters and darkest just inside the
    // far edge - the two together are what give it volume rather than outline.
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y, r, ry, 0, 0, Math.PI * 2);
    ctx.clip();
    const shine = ctx.createRadialGradient(x - r * 0.35, y - ry * 0.4, 0, x, y, Math.max(r, ry));
    shine.addColorStop(0, 'rgba(255,255,255,0.5)');
    shine.addColorStop(0.4, 'rgba(255,255,255,0.06)');
    shine.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.fillStyle = shine;
    ctx.fillRect(x - r, y - ry, r * 2, ry * 2);
    ctx.restore();
  }

  function drawDrop(drop: Drop) {
    // The tail first, so the head sits over it rather than under.
    for (let i = 0; i < drop.trail.length; i += 1) {
      const bead = drop.trail[i]!;
      // Older beads are further back and smaller - a tail thins as it dries.
      const age = (i + 1) / (drop.trail.length + 1);
      drawBead(bead.x, bead.y, bead.r * (0.35 + age * 0.5));
    }

    /*
     * The head, pulled out by how fast it is going. A drop barely moving is
     * round; one sliding fast is drawn out behind itself. Capped, because past
     * about twice its width it stops being a drop and becomes a stripe.
     */
    const stretch = Math.min(2.1, 1 + drop.speed / (140 * dpr));
    drawBead(drop.x, drop.y, drop.r, stretch);
  }

  function step(dt: number) {
    // New arrivals, at the top and scattered, because rain does not queue.
    if (!still && Math.random() < rate * dt) drops.push(born(-10 * dpr));

    for (const drop of drops) {
      if (still) continue;

      if (drop.speed === 0) {
        drop.cling -= dt;
        // Heavy ones always go; middling ones go when they have waited.
        if (drop.r > RUN_RADIUS || (drop.cling <= 0 && drop.r > CLING_RADIUS)) {
          drop.speed = (18 + drop.r * 9) * dpr;
        }
        continue;
      }

      const moved = drop.speed * dt;
      drop.y += moved;
      drop.x += drop.drift * dt;
      // A running drop keeps gathering weight, so it keeps speeding up.
      drop.speed += 42 * dpr * dt;

      /*
       * It leaves water behind it.
       *
       * A bead every so many pixels rather than every frame: tied to distance,
       * a slow drop lays a dense tail and a fast one a stretched broken line,
       * which is what actually happens. Tied to frames, both would look the
       * same and the whole thing would change with the refresh rate.
       */
      drop.since += moved;
      const gap = drop.r * 1.5;
      if (drop.since > gap) {
        drop.since = 0;
        drop.trail.push({ x: drop.x, y: drop.y, r: drop.r });
        // The tail is finite. Longer than this and it reads as a drawn line.
        if (drop.trail.length > 14) drop.trail.shift();
        /*
         * And the drop pays for it. Water left on the glass is water no longer
         * in the bead, so a runner thins as it goes and eventually stops -
         * which is why a window does not simply empty itself.
         */
        drop.r *= 0.985;
      }

      /*
       * It sweeps up what it passes. This is what makes trails read as trails:
       * the runner grows, the pane behind it clears, and the next one down the
       * same track goes faster still.
       */
      for (const other of drops) {
        if (other === drop || other.r <= 0 || other.speed > 0) continue;
        const dx = other.x - drop.x;
        const dy = other.y - drop.y;
        if (dx * dx + dy * dy < (drop.r + other.r) ** 2) {
          // Volume adds, not radius - two equal drops make one about 1.26x wide.
          drop.r = Math.cbrt(drop.r ** 3 + other.r ** 3);
          other.r = 0;
        }
      }
    }

    /*
     * Gone when it has run off the bottom, or when it has left so much of
     * itself behind that there is nothing to see. Its tail goes with it, which
     * is right: the beads it left are its own water.
     */
    drops = drops.filter((d) => d.r > 0.7 * dpr && d.y - d.r < height + 40 * dpr);
    // A ceiling, so a long session cannot accumulate its way into a slideshow.
    if (drops.length > 420) drops.splice(0, drops.length - 420);
  }

  function frame(now: number) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;

    if (blurred && ctx) {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(blurred, 0, 0);
      step(dt);
      for (const drop of drops) if (drop.r > 0) drawDrop(drop);
    }

    if (still) {
      running = false;
      return;
    }
    raf = window.requestAnimationFrame(frame);
  }

  let scene: CanvasImageSource | undefined;
  let sceneW = 0;
  let sceneH = 0;

  function begin() {
    if (running) return;
    running = true;
    last = performance.now();
    raf = window.requestAnimationFrame(frame);
  }

  function halt() {
    running = false;
    window.cancelAnimationFrame(raf);
  }

  /* ---- Loading the scene, then starting ---- */

  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => {
    scene = image;
    sceneW = image.naturalWidth;
    sceneH = image.naturalHeight;
    resize();
    begin();
  };
  image.onerror = () => {
    /*
     * No picture is not a reason to have no rain. A flat wash stands in, and
     * the drops still lens it - which on a plain colour reads as water on a
     * misted window, which is fine.
     */
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 128;
    const g = c.getContext('2d');
    if (g) {
      const wash = g.createLinearGradient(0, 0, 0, 128);
      wash.addColorStop(0, '#5f6ea8');
      wash.addColorStop(1, '#2b3350');
      g.fillStyle = wash;
      g.fillRect(0, 0, 64, 128);
    }
    scene = c;
    sceneW = 64;
    sceneH = 128;
    resize();
    begin();
  };
  image.src = options.image || '';

  /* ---- Everything that should stop it ---- */

  const onVisibility = () => (document.hidden ? halt() : begin());
  document.addEventListener('visibilitychange', onVisibility);

  const onResize = () => resize();
  window.addEventListener('resize', onResize);

  // Off screen is off. A conversation in a background tab, or scrolled out of
  // a desktop two-pane layout, has no business running an animation.
  const seen = new IntersectionObserver((entries) => {
    for (const entry of entries) (entry.isIntersecting ? begin : halt)();
  });
  seen.observe(canvas);

  return {
    stop: () => {
      halt();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      seen.disconnect();
    },
  };
}
