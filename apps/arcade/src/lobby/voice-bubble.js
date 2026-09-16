import { CanvasTexture, SRGBColorSpace, Sprite, SpriteMaterial } from 'three';

/**
 * Roblox's voice icon: a mic over a talking player's head, filling up
 * green with how loud they are. Hidden while they are quiet, with a short
 * hold so it does not flicker between words.
 */

const STEPS = 10;
const HOLD = 0.35;

/** A bare mic, no bubble; the voice fills the capsule green from the bottom. */
function draw(ctx, step) {
  ctx.clearRect(0, 0, 128, 128);
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 8;
  // The stand: cradle, stem and foot.
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(64, 62, 30, 0.1 * Math.PI, 0.9 * Math.PI);
  ctx.moveTo(64, 92);
  ctx.lineTo(64, 108);
  ctx.moveTo(48, 110);
  ctx.lineTo(80, 110);
  ctx.stroke();
  // The capsule.
  ctx.beginPath();
  ctx.roundRect(46, 10, 36, 70, 18);
  ctx.fillStyle = 'rgba(12, 8, 22, 0.85)';
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(46, 10, 36, 70, 18);
  ctx.clip();
  const fill = (70 * (step + 1)) / STEPS;
  ctx.fillStyle = '#45ff7a';
  ctx.fillRect(46, 80 - fill, 36, fill);
  ctx.restore();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(46, 10, 36, 70, 18);
  ctx.stroke();
}

export function createVoiceBubble() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(0.36, 0.36, 1);
  sprite.renderOrder = 11;
  sprite.visible = false;
  let shown = -1;
  let quiet = HOLD;

  return {
    sprite,
    /** Once a frame with the voice level (0-1). */
    update(dt, level) {
      quiet = level > 0.1 ? 0 : quiet + dt;
      sprite.visible = quiet < HOLD;
      if (!sprite.visible) return;
      const step = Math.min(STEPS - 1, Math.floor(level * 1.4 * STEPS));
      if (step === shown) return;
      shown = step;
      draw(ctx, step);
      texture.needsUpdate = true;
    },
  };
}

/** A 0-1 loudness reader for an audio stream, or undefined without Web Audio. */
export function meterFor(stream) {
  try {
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    context.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    void context.resume().catch(() => {});
    return () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      return Math.min(1, peak / 40);
    };
  } catch {
    return undefined;
  }
}
