import { Mesh, MeshLambertMaterial, PlaneGeometry, RepeatWrapping, SRGBColorSpace, TextureLoader } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * The shop's inside surfaces: carpet underfoot, brick walls, a dark ceiling.
 *
 * Each is one big plane with a CC0 texture repeating across it - the carpet
 * is ambientCG's Carpet012, the brick and concrete are the Downtown City
 * MegaKit's (public/textures) - so the whole room is a dozen triangles and
 * three draw calls, where the Kenney kit's wall and floor pieces were ~2,000.
 * The walls face in and the ceiling faces down: from the street, where the
 * camera is above the room, they are simply not drawn.
 */

const loader = new TextureLoader();

function tiled(url) {
  const texture = loader.load(url);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/** A plane whose texture repeats every `tileW` x `tileH` metres. */
function plane(width, height, tileW, tileH) {
  const geometry = new PlaneGeometry(width, height);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, (uv.getX(i) * width) / tileW, (uv.getY(i) * height) / tileH);
  return geometry;
}

/**
 * @param {{ minX: number, maxX: number, minZ: number, maxZ: number, height: number }} room - the inside faces
 */
export function createShell({ minX, maxX, minZ, maxZ, height }) {
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  const floorGeometry = plane(width, depth, 1.6, 1.6);
  floorGeometry.rotateX(-Math.PI / 2);
  floorGeometry.translate(cx, 0, cz);
  const floor = new Mesh(floorGeometry, new MeshLambertMaterial({ map: tiled('textures/carpet.jpg') }));

  const ceilingGeometry = plane(width, depth, 3, 3);
  ceilingGeometry.rotateX(Math.PI / 2);
  ceilingGeometry.translate(cx, height, cz);
  // Darkened: in an arcade the ceiling is where the light is not.
  const ceiling = new Mesh(ceilingGeometry, new MeshLambertMaterial({ map: tiled('textures/concrete.jpg'), color: 0x514b58 }));

  const back = plane(width, height, 2, 2);
  back.translate(cx, height / 2, minZ);
  const left = plane(depth, height, 2, 2);
  left.rotateY(Math.PI / 2);
  left.translate(minX, height / 2, cz);
  const right = plane(depth, height, 2, 2);
  right.rotateY(-Math.PI / 2);
  right.translate(maxX, height / 2, cz);
  const walls = new Mesh(mergeGeometries([back, left, right]), new MeshLambertMaterial({ map: tiled('textures/brick.jpg') }));

  return { floor, walls, ceiling };
}
