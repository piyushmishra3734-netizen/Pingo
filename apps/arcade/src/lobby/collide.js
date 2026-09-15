/**
 * Keeps a walker out of things: a circle on the ground against boxes.
 *
 * Every solid thing in the shop is an axis-aligned footprint
 * `[minX, minZ, maxX, maxZ]` - the kits' models all stand square to the grid
 * - and the walker is a circle. Pushing the circle out along the line to the
 * nearest point of each box slides it along walls instead of stopping it dead,
 * which is what makes walking into a corner feel like walking, not sticking.
 * Two passes, so a push out of one box into another is undone.
 *
 * @param {number} x
 * @param {number} z
 * @param {number} radius
 * @param {number[][]} boxes
 * @returns {[number, number]}
 */
export function collide(x, z, radius, boxes) {
  for (let pass = 0; pass < 2; pass += 1) {
    for (const [x0, z0, x1, z1] of boxes) {
      const nearX = Math.min(Math.max(x, x0), x1);
      const nearZ = Math.min(Math.max(z, z0), z1);
      const dx = x - nearX;
      const dz = z - nearZ;
      const distance = Math.hypot(dx, dz);
      if (distance >= radius) continue;
      if (distance > 1e-9) {
        x = nearX + (dx / distance) * radius;
        z = nearZ + (dz / distance) * radius;
      } else {
        // The centre is inside the box: out through the nearest side.
        const out = [x - x0, x1 - x, z - z0, z1 - z];
        const side = out.indexOf(Math.min(...out));
        if (side === 0) x = x0 - radius;
        else if (side === 1) x = x1 + radius;
        else if (side === 2) z = z0 - radius;
        else z = z1 + radius;
      }
    }
  }
  return [x, z];
}
