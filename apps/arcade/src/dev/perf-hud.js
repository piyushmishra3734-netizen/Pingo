/**
 * FPS, worst frame, draw calls, triangles and pixel ratio, in a corner.
 *
 * Written to the DOM twice a second: rewriting text every frame would itself
 * cost frames on the budget phones this exists to measure. Turns red when the
 * frame rate drops under 55 or the scene goes over the triangle budget.
 */
const TRIANGLE_BUDGET = 20_000;
const SAMPLE_MS = 500;

export function createPerfHud(renderer) {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;top:8px;left:8px;z-index:10;padding:6px 8px;border-radius:6px;' +
    'font:12px/1.4 ui-monospace,Menlo,monospace;white-space:pre;pointer-events:none;' +
    'color:#e8e6f0;background:rgba(0,0,0,.6)';
  document.body.append(el);

  let frames = 0;
  let windowStart = performance.now();
  let last = windowStart;
  let worst = 0;

  return {
    /** Call once per frame, after `renderer.render`, with the frame timestamp. */
    update(now) {
      frames += 1;
      worst = Math.max(worst, now - last);
      last = now;
      if (now - windowStart < SAMPLE_MS) return;

      const fps = Math.round((frames * 1000) / (now - windowStart));
      // Reset by three on every render, so this is the last frame's numbers.
      const { calls, triangles } = renderer.info.render;
      el.textContent =
        `FPS  ${fps}  (worst ${worst.toFixed(1)} ms)\n` +
        `Draw ${calls}\n` +
        `Tris ${triangles.toLocaleString()} / ${TRIANGLE_BUDGET.toLocaleString()}\n` +
        `DPR  ${renderer.getPixelRatio().toFixed(2)}`;
      el.style.color = fps < 55 || triangles > TRIANGLE_BUDGET ? '#ff8a8a' : '#e8e6f0';

      frames = 0;
      windowStart = now;
      worst = 0;
    },
  };
}
