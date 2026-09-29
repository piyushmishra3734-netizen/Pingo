import { useEffect, useRef, useState } from 'react';

import { VoxelQr } from '../../features/profile/VoxelQr.js';
import {
  plantGarden,
  type CatKind,
  type GardenOptions,
  type GrassKind,
  type TreeKind,
} from '../../features/profile/voxel-garden.js';

/**
 * Samples for the invite card's garden, at `/dev/garden-lab`: a blocky cat in
 * three coats, two crowns and two lawns, beside the scene that ships today.
 *
 * `?cat=&tree=&grass=` preselects a combination, so a screenshot can ask for
 * one directly.
 */
export function GardenLab() {
  const q = new URLSearchParams(window.location.search);
  const [cat, setCat] = useState<CatKind>((q.get('cat') as CatKind) || 'black');
  const [tree, setTree] = useState<TreeKind>((q.get('tree') as TreeKind) || 'dome');
  const [grass, setGrass] = useState<GrassKind>((q.get('grass') as GrassKind) || 'meadow');
  const value = 'https://pingochat.pages.dev/u/piyush';

  return (
    <div className="h-full overflow-y-auto bg-[#fbeef3]">
      <div className="mx-auto w-full max-w-md px-4 py-6">
        <h1 className="text-h2 text-ink">Garden samples</h1>

        <Choice label="Cat" value={cat} set={setCat} options={[['black', 'Black'], ['ginger', 'Ginger tabby'], ['snow', 'White']]} />
        <Choice label="Tree" value={tree} set={setTree} options={[['dome', 'Round dome'], ['clumps', 'Branchy puffs']]} />
        <Choice label="Grass" value={grass} set={setGrass} options={[['meadow', 'Flower meadow'], ['tufts', 'Short tufts']]} />

        <div data-sample className="mt-4 grid place-items-center rounded-2xl bg-white p-3 shadow-sm">
          <Garden value={value} size={340} cat={cat} tree={tree} grass={grass} />
        </div>

        <p className="mt-6 text-caption text-text-tertiary">Today</p>
        <div data-today className="mt-2 grid place-items-center rounded-2xl bg-white p-3 shadow-sm">
          <VoxelQr value={value} size={340} caption="" />
        </div>
      </div>
    </div>
  );
}

function Garden(props: GardenOptions) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return undefined;
    return plantGarden(ref.current, props);
  }, [props.value, props.size, props.cat, props.tree, props.grass]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} style={{ width: props.size, height: props.size }} />;
}

function Choice<T extends string>({ label, value, set, options }: { label: string; value: T; set: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="w-12 text-caption text-text-secondary">{label}</span>
      {options.map(([v, name]) => (
        <button
          key={v}
          type="button"
          onClick={() => set(v)}
          className={
            value === v
              ? 'rounded-full bg-[#e2578d] px-3 py-1.5 text-caption font-semibold text-white'
              : 'rounded-full bg-white px-3 py-1.5 text-caption font-medium text-text-secondary'
          }
        >
          {name}
        </button>
      ))}
    </div>
  );
}
