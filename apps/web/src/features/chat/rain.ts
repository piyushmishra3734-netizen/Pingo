/**
 * Rain on the glass, behind a conversation.
 *
 * ## Why this is a library and not ours
 *
 * The first version was hand-written: a 2D canvas drawing each drop as a
 * clipped, flipped, magnified crop of the background, with trails and merging
 * and a shaded rim. It worked, and it never looked like water. The reason is
 * that a convincing raindrop is a refraction problem rather than a drawing
 * problem - the bead has to bend the whole scene through itself, per pixel -
 * and a 2D canvas can only ever paste a rectangle of pixels into a circle.
 *
 * `raindrop-fx` does it properly, in WebGL2, with a real refraction shader,
 * mist that clears where drops pass, and droplet erasure along the trails. MIT,
 * and about 600 drops at two or three milliseconds a frame. Four hundred lines
 * of ours were a worse answer to a solved problem.
 *
 * ## What is still ours
 *
 * The plumbing: what the rain falls in front of, and everything that makes it
 * stop. A chat is not a screensaver. This must not run in a hidden tab, must
 * not run for a thread scrolled out of a desktop two-pane layout, and must not
 * run at all for somebody who has asked for less motion.
 *
 * ## Loaded only if it is raining
 *
 * The library is 240KB, which is a fifth of the whole application, for a
 * wallpaper most people will never choose. It is imported on demand, so
 * everybody else downloads none of it - which is the only reason a shader this
 * size is a reasonable thing to add at all.
 */

export interface RainOptions {
  /** The scene behind the water. A URL or a data URL. */
  image?: string;
}

export interface RainHandle {
  stop: () => void;
}

/** WebGL2 is required. Without it there is no rain, rather than a bad rain. */
function canRender(): boolean {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

export function startRain(canvas: HTMLCanvasElement, options: RainOptions = {}): RainHandle {
  const nothing: RainHandle = { stop: () => undefined };
  if (typeof window === 'undefined') return nothing;

  /*
   * Motion is the whole of this wallpaper, so there is no still version to
   * fall back to: somebody who has asked for less of it gets none at all.
   */
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return nothing;
  if (!canRender()) return nothing;

  /*
   * Sized in CSS pixels, deliberately not multiplied by the device ratio.
   * This is a full-screen shader; at 3x on a phone it is nine times the work
   * for rain nobody is inspecting closely.
   */
  const size = () => {
    const rect = canvas.getBoundingClientRect();
    return [Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height))] as const;
  };

  const [w, h] = size();
  canvas.width = w;
  canvas.height = h;

  /** Set once the module has arrived. Everything guards on it being absent. */
  let fx: { start: () => Promise<void>; stop: () => void; resize: (w: number, h: number) => void } | undefined;
  let stopped = false;
  let running = false;

  function rebuild() {
  void import('raindrop-fx')
    .then((mod) => {
      // The thread may have closed, or the wallpaper changed, while it loaded.
      if (stopped) return;

      /*
       * The package is CommonJS - its types say `export =` - so depending on
       * how the bundler interops it, the constructor is either the module's
       * default or the module object itself. Taking only `.default` gave
       * "RaindropFX is not a constructor", thrown inside this callback, where
       * the catch below swallowed it: the rain was simply black and silent.
       */
      const RaindropFX = ((mod as unknown as { default?: unknown }).default ??
        mod) as unknown as new (o: Record<string, unknown>) => typeof fx & object;

      fx = new RaindropFX({
        canvas,
        background: options.image ?? '',
        /*
         * Tuned down from the library's defaults, which are built for a
         * full-screen demo. Here a conversation is the subject and the weather
         * is behind it: fewer and smaller drops, a slower spawn, and the mist
         * left on so the pane reads as wet rather than merely spotted.
         */
        spawnInterval: [0.18, 0.28],
        spawnSize: [38, 66],
        spawnLimit: 380,
        dropletsPerSeconds: 220,
        dropletSize: [6, 18],
        mist: true,
        backgroundBlurSteps: 4,
      });
      begin();
    })
    .catch((cause: unknown) => {
      /*
       * Reported, not swallowed.
       *
       * The first version caught silently, and when the constructor turned out
       * to be in the wrong place the only symptom was a black rectangle behind
       * every conversation - no error, nothing in the console, nothing to
       * search for. A wallpaper that fails should still not break the screen,
       * but it should say why it failed.
       */
        console.warn('[rain] could not start', cause);
      });
  }

  function begin() {
    if (stopped || running || !fx) return;
    running = true;
    void fx.start();
  }

  function halt() {
    if (!running || !fx) return;
    running = false;
    fx.stop();
  }

  const onVisibility = () => (document.hidden ? halt() : begin());
  document.addEventListener('visibilitychange', onVisibility);

  /*
   * A lost context has to be asked for again.
   *
   * The browser takes the GPU context back whenever it feels the need -
   * backgrounding the app, another tab wanting the memory, the driver
   * resetting. Nothing tells the library, so it goes on running its loop
   * against a dead context and the wallpaper is black for the rest of the
   * session. Observed here: the rain rendered, the tab lost focus for a
   * moment, and it never came back.
   *
   * `preventDefault` on the loss is what makes restoration possible at all;
   * without it the browser does not bother firing the restored event.
   */
  const onLost = (event: Event) => {
    event.preventDefault();
    running = false;
    fx = undefined;
  };
  const onRestored = () => {
    if (stopped) return;
    // The old instance is bound to a context that no longer exists, so this
    // builds a new one rather than trying to revive it.
    rebuild();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  const onResize = () => {
    if (!fx) return;
    const [width, height] = size();
    canvas.width = width;
    canvas.height = height;
    fx.resize(width, height);
  };
  window.addEventListener('resize', onResize);

  // Off screen is off. A thread in a background tab has no business running a
  // shader, and neither has one scrolled out of a two-pane desktop layout.
  const seen = new IntersectionObserver((entries) => {
    for (const entry of entries) (entry.isIntersecting ? begin : halt)();
  });
  seen.observe(canvas);

  rebuild();

  return {
    stop: () => {
      stopped = true;
      halt();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      seen.disconnect();
    },
  };
}
