/**
 * The screen a match opens on: the two players, split, and VS.
 *
 * A stand-in until the brawler arrives (Phase 2, step 3), and a proper game
 * in the host's terms - it updates on fixed steps and draws every frame - so
 * the zoom, the pause of the 3D loop and the handoff are tested for real.
 */

const PINK = '#ff4f8b';
const TEAL = '#38e0d0';

/**
 * @param {{ you?: string, them?: string, youAreLeft?: boolean }} [options]
 */
export function createVersusCard({ you = 'YOU', them = 'RIVAL', youAreLeft = true } = {}) {
  const [left, right] = youAreLeft ? [you, them] : [them, you];
  let t = 0;

  return {
    update() {
      t += 1;
    },

    draw(ctx) {
      const { width: w, height: h } = ctx.canvas;
      ctx.fillStyle = '#0d0714';
      ctx.fillRect(0, 0, w, h);

      // The two sides slide in over the first half second, then hold.
      const slide = Math.min(1, t / 30);
      const cut = (1 - slide) * w * 0.6;

      ctx.fillStyle = PINK;
      ctx.beginPath();
      ctx.moveTo(-cut, 0);
      ctx.lineTo(w * 0.56 - cut, 0);
      ctx.lineTo(w * 0.44 - cut, h);
      ctx.lineTo(-cut, h);
      ctx.fill();

      ctx.fillStyle = TEAL;
      ctx.beginPath();
      ctx.moveTo(w * 0.6 + cut, 0);
      ctx.lineTo(w + cut, 0);
      ctx.lineTo(w + cut, h);
      ctx.lineTo(w * 0.48 + cut, h);
      ctx.fill();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#0d0714';
      ctx.font = 'bold 16px ui-monospace, Menlo, monospace';
      ctx.fillText(left, w * 0.24, h * 0.5);
      ctx.fillText(right, w * 0.78, h * 0.5);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 44px ui-monospace, Menlo, monospace';
      ctx.fillText('VS', w / 2, h / 2);

      if (slide === 1 && t % 60 < 40) {
        ctx.font = 'bold 12px ui-monospace, Menlo, monospace';
        ctx.fillText('GET READY', w / 2, h - 22);
      }

      // Scanlines: two pixels in four, the cheapest CRT there is.
      ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
      for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 2);
    },
  };
}
