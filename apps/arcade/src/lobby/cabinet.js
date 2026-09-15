import { BoxGeometry, Mesh, MeshBasicMaterial, PlaneGeometry, Group } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { DARK, MARQUEE, SHELL, accent } from './materials.js';
import { attractTexture } from './textures.js';

/**
 * A Japanese candy cab, from boxes.
 *
 * Shaped after an Astro City: a low seated cabinet, a boxy pedestal, a control
 * panel that slopes toward the player, a monitor hood tipped back and a lit
 * marquee on top. Built facing -Z; the room rotates the second one to put the
 * pair back to back, which is how an arcade sets up a versus match - the
 * cabinets share a spine and the two players face each other across them.
 *
 * ## Why the parts are merged
 *
 * Ten boxes is ten draw calls if they stay ten meshes, and the whole room has
 * a budget of thirty. Merged by material it is three: shell, dark and accent -
 * and the screen, which stays separate because Phase 2 swaps its texture for
 * the running game.
 *
 * Triangles: ~124 per cabinet, so both cabinets together cost about a
 * fortieth of the 5,000 the scene is allowed.
 */

const SCREEN_W = 0.62;
const SCREEN_H = 0.465; // 4:3, like the CRT it is pretending to be

/*
 * Where the glass sits, measured from the cabinet's centre (the player is at -Z).
 *
 * Front faces, nearest the player first:
 *   screen  -0.276
 *   bezel   -0.270   (0.05 deep, centred on -0.245)
 *   hood    -0.230
 *
 * Both earlier builds hid the screen by getting this order wrong: first inside
 * the hood (-0.21), then 2mm inside the bezel (-0.268, when the bezel's face
 * was at -0.270). The glass has to be the thing nearest the eye, so it sits
 * 6mm proud of the bezel - enough never to fight it for depth.
 *
 * The screen is not tilted, and that is a decision rather than an oversight: a
 * tilted plane 2cm in front of an upright box pushes its top edge back into
 * that box. Tilting both would cost geometry and buy a few degrees nobody
 * looking at a phone will notice.
 */
const BEZEL_Z = -0.245;
const SCREEN_Z = -0.276;

function box(w, h, d, x, y, z, rotX = 0) {
  const geometry = new BoxGeometry(w, h, d);
  if (rotX) geometry.rotateX(rotX);
  geometry.translate(x, y, z);
  return geometry;
}

/**
 * @param {{ accentColor?: number, label?: string }} [options]
 */
export function createCabinet(options = {}) {
  const { accentColor = 0xff4f8b, label = 'PINGO' } = options;
  const group = new Group();

  // -- shell: pedestal, monitor hood, control panel -----------------------
  const shell = mergeGeometries([
    box(0.92, 0.58, 0.66, 0, 0.29, 0), // pedestal
    box(0.9, 0.68, 0.52, 0, 1.0, 0.03), // monitor hood
    box(0.86, 0.12, 0.42, 0, 0.66, -0.16, -0.22), // control panel, sloped
  ]);
  group.add(new Mesh(shell, SHELL));

  // -- dark: bezel, coin door, panel lip, plinth, marquee trim ------------
  const dark = mergeGeometries([
    box(0.8, 0.62, 0.05, 0, 1.02, BEZEL_Z), // the frame the glass sits in
    box(0.3, 0.14, 0.04, 0, 0.36, -0.34), // coin door
    box(0.86, 0.04, 0.06, 0, 0.6, -0.36), // lip under the control panel
    box(0.96, 0.05, 0.7, 0, 0.025, 0), // plinth, so it sits on the floor
    box(0.9, 0.04, 0.48, 0, 1.35, 0.02), // trim the marquee sits on
  ]);
  group.add(new Mesh(dark, DARK));

  // -- accent: side stripes and the marquee cheeks ------------------------
  const stripes = mergeGeometries([
    box(0.04, 0.5, 0.6, -0.47, 0.33, 0), // left flank
    box(0.04, 0.5, 0.6, 0.47, 0.33, 0), // right flank
    box(0.9, 0.06, 0.2, 0, 0.72, -0.28), // button shelf edge
  ]);
  group.add(new Mesh(stripes, accent(accentColor)));

  // -- marquee: unlit, so it glows without costing a light ----------------
  group.add(new Mesh(box(0.86, 0.2, 0.44, 0, 1.47, 0.02), MARQUEE));

  /*
   * The screen: its own mesh, its own material.
   *
   * `MeshBasicMaterial` because a CRT emits rather than receives light, and
   * because Phase 2 hands this material the 2D game's canvas as a texture -
   * one assignment, no scene rebuild. Two triangles.
   */
  const screenMaterial = new MeshBasicMaterial({ map: attractTexture(label), name: 'screen' });
  const screen = new Mesh(new PlaneGeometry(SCREEN_W, SCREEN_H), screenMaterial);
  screen.position.set(0, 1.02, SCREEN_Z);
  /*
   * Turned to face the player.
   *
   * A plane's visible side points along +Z, and this cabinet faces -Z - so
   * without this the glass showed its back to the chair, was culled, and the
   * player looked at the dark bezel behind it. Rotating the plane rather than
   * setting `side: DoubleSide` keeps one face to draw and the texture the
   * right way round.
   */
  screen.rotation.y = Math.PI;
  group.add(screen);

  return {
    group,
    screen,
    /**
     * Hands the screen a new texture - the running game in Phase 2.
     * @param {import('three').Texture} texture
     */
    setScreenTexture(texture) {
      screenMaterial.map = texture;
      screenMaterial.needsUpdate = true;
    },
  };
}
