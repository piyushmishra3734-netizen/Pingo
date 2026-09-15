/**
 * The 2D side: a canvas laid over the cabinet's screen, and a fixed-step loop.
 *
 * ## 320 x 200, pixelated
 *
 * The cabinet's screen is 16:10, and so is this - the game is drawn at the
 * resolution of the machine it pretends to run on and scaled up by CSS with
 * `image-rendering: pixelated`. Retro by construction, and on a phone about
 * 64,000 pixels a frame instead of a million or two.
 *
 * ## Fixed steps
 *
 * The game advances in 1/60 s steps however often the display refreshes: a
 * 90 Hz phone does not play faster, a 40 fps one does not play slower, and the
 * lockstep netcode that follows needs every machine to agree on what "one
 * frame" is. A stall (a tab brought back after a minute) is capped at a few
 * steps rather than fast-forwarded.
 */

export const WIDTH = 320;
export const HEIGHT = 200;
export const STEP_MS = 1000 / 60;
/** The most steps one display frame may run: a stall is not replayed. */
export const MAX_STEPS = 5;

/**
 * How many fixed steps to run for `elapsed` milliseconds of display time,
 * and what is left over for next time.
 */
export function stepsFor(accumulator, elapsed) {
  const total = accumulator + Math.min(Math.max(elapsed, 0), STEP_MS * MAX_STEPS);
  const steps = Math.floor(total / STEP_MS);
  return { steps, accumulator: total - steps * STEP_MS };
}

/**
 * A game is `{ update(frame), draw(ctx, frame) }` - update once per fixed
 * step, draw once per display frame.
 */
export function createGameHost() {
  const canvas = document.createElement('canvas');
  canvas.className = 'game-screen';
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.hidden = true;
  document.body.append(canvas);

  // Opaque: the browser skips blending the canvas with what is under it.
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;

  let game;
  let raf = 0;
  let last = 0;
  let accumulator = 0;
  let frame = 0;
  let paused = false;

  function loop(now) {
    raf = requestAnimationFrame(loop);
    const next = stepsFor(accumulator, now - last);
    accumulator = next.accumulator;
    last = now;
    for (let i = 0; i < next.steps; i += 1) {
      frame += 1;
      game.update(frame);
    }
    game.draw(ctx, frame);
  }

  function run() {
    cancelAnimationFrame(raf);
    if (!game || paused) return;
    last = performance.now();
    accumulator = 0;
    raf = requestAnimationFrame(loop);
  }

  return {
    canvas,

    /**
     * Shows `newGame` over `rect` (CSS pixels) and starts its loop.
     * @param {{ update(frame: number): void, draw(ctx: CanvasRenderingContext2D, frame: number): void }} newGame
     */
    start(newGame, rect) {
      game = newGame;
      frame = 0;
      this.place(rect);
      canvas.hidden = false;
      game.draw(ctx, frame);
      run();
    },

    /** Moves the canvas - after a resize re-seated the camera. */
    place(rect) {
      canvas.style.left = `${rect.x}px`;
      canvas.style.top = `${rect.y}px`;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    },

    stop() {
      cancelAnimationFrame(raf);
      canvas.hidden = true;
      // A game may own DOM of its own - the brawler's touch pad - and listeners.
      game?.dispose?.();
      game = undefined;
    },

    /** The running game, for probes. */
    get game() {
      return game;
    },

    /** A hidden tab runs no game either. */
    setPaused(value) {
      paused = value;
      run();
    },

    get running() {
      return Boolean(game);
    },

    /** Fixed steps run since the game started. */
    get frame() {
      return frame;
    },
  };
}
