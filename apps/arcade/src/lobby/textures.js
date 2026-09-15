import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

/**
 * Every texture in the room, drawn on a canvas at boot.
 *
 * Nothing here is fetched: no image request to fail on a train, nothing in the
 * bundle, and no decode of a file that was only ever a gradient. A 256px
 * canvas costs well under a millisecond to draw and uploads once.
 */

function canvas(size) {
  const element = document.createElement('canvas');
  element.width = size;
  element.height = size;
  return [element, element.getContext('2d')];
}

function finish(element, { repeat = 1, srgb = true } = {}) {
  const texture = new CanvasTexture(element);
  if (srgb) texture.colorSpace = SRGBColorSpace;
  if (repeat !== 1) {
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.repeat.set(repeat, repeat);
  }
  return texture;
}

/**
 * The soft dark patch a cabinet leaves on the floor.
 *
 * This is the whole shadow budget of the scene: `shadowMap` stays off, and a
 * blurred ellipse under each object reads as contact with the ground at no
 * per-frame cost. An ellipse rather than a circle because the things standing
 * on it are wider than they are deep.
 */
export function contactShadowTexture() {
  const [element, ctx] = canvas(128);
  const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(0,0,0,0.5)');
  gradient.addColorStop(0.55, 'rgba(0,0,0,0.22)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return finish(element, { srgb: false });
}

/**
 * The halo around a lit dome: white, so one texture serves every colour -
 * the sprite's own colour tints it. Drawn additively, so it brightens what is
 * behind it the way light does, without being a light.
 */
export function glowTexture() {
  const [element, ctx] = canvas(128);
  const gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return finish(element, { srgb: false });
}

/** The shop's name over its door, in neon. Text, so it is drawn, not fetched. */
export function signTexture(text) {
  const element = document.createElement('canvas');
  element.width = 512;
  element.height = 128;
  const ctx = element.getContext('2d');
  ctx.fillStyle = '#1a0f22';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#ff4f8b';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 500, 116);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 60px "Space Grotesk", system-ui, sans-serif';
  ctx.shadowColor = '#ff4f8b';
  ctx.shadowBlur = 18;
  ctx.fillStyle = '#ffe9f1';
  ctx.fillText(text, 256, 68);
  return finish(element);
}

/**
 * What the cabinet shows before a game does: an attract-mode card.
 *
 * Phase 2 replaces this texture with the 2D game's own canvas, which is why
 * the screen is its own mesh with its own material - a swap of one `map`, not
 * a rebuild of the scene.
 */
export function attractTexture(label = 'PINGO') {
  const [element, ctx] = canvas(256);
  ctx.fillStyle = '#1a0f22';
  ctx.fillRect(0, 0, 256, 256);

  /*
   * Bright enough to read as a lit screen from across the room.
   *
   * The first version used a 0.55 glow on a near-black card: measured at the
   * centre pixel it came out #6d292f, which at the size a cabinet occupies on
   * a phone is indistinguishable from the black bezel around it. A screen that
   * cannot be told from its own frame is not a screen.
   */
  const glow = ctx.createRadialGradient(128, 120, 6, 128, 120, 150);
  glow.addColorStop(0, 'rgba(255,120,160,0.95)');
  glow.addColorStop(0.45, 'rgba(255,79,139,0.45)');
  glow.addColorStop(1, 'rgba(120,40,90,0.1)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 256, 256);

  ctx.strokeStyle = 'rgba(255,233,241,0.35)';
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, 236, 236);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff6fa';
  ctx.font = '600 44px "Space Grotesk", system-ui, sans-serif';
  ctx.fillText(label, 128, 132);
  ctx.font = '500 18px "Space Grotesk", system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,246,250,0.85)';
  ctx.fillText('INSERT COIN', 128, 176);

  // Scanlines: the cheapest way to say CRT, and they hide the canvas's flatness.
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  for (let y = 0; y < 256; y += 4) ctx.fillRect(0, y, 256, 2);

  return finish(element);
}
