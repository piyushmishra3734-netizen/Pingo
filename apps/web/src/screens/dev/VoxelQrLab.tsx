import { useEffect, useRef, useState } from 'react';

import { VoxelQr } from '../../features/profile/VoxelQr.js';
import { paintCat, type CatKind } from '../../features/profile/garden-cat.js';

/**
 * The tree-to-QR transition, on its own, at `/dev/qr-lab`.
 *
 * Here rather than inside the share sheet because the thing being judged is a
 * second of motion, and judging it means replaying it twenty times without
 * opening a sheet twenty times.
 *
 * It showed four crowns side by side while the silhouette was being chosen.
 * That is settled - `SAKURA` is the one - so the other three are gone rather
 * than left behind as options nothing picks between. Four cats went up and
 * three came down the same way.
 */
export function VoxelQrLab() {
  const [value, setValue] = useState('https://pingochat.pages.dev/profile/anaya');
  const [size, setSize] = useState(300);
  // Remounting is the replay: the hold-then-open runs from the top again.
  const [take, setTake] = useState(0);
  const [cat, setCat] = useState<CatKind>((new URLSearchParams(window.location.search).get('cat') as CatKind) || 'black');

  return (
    <div className="h-full overflow-y-auto bg-sunken">
      <div className="mx-auto w-full max-w-md px-4 py-6">
        <h1 className="text-h2 text-ink">Tree → QR</h1>
        <p className="mt-1 text-caption text-text-tertiary">
          It opens on its own. Tap it to send it back to the tree.
        </p>

        <button
          type="button"
          onClick={() => setTake((n) => n + 1)}
          className="mt-4 w-full rounded-md bg-brand px-3 py-2 text-body font-medium text-on-brand"
        >
          Replay
        </button>

        <div className="mt-5 grid place-items-center rounded-lg bg-page p-5 shadow-sm">
          <VoxelQr key={take} value={value} size={size} cat={cat} autoPlay />
        </div>

        <label className="mt-6 block text-caption text-text-secondary">
          What it encodes
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="mt-1 w-full rounded-md bg-surface px-3 py-2 text-body text-ink"
          />
        </label>

        <div className="mt-3 flex gap-2">
          {[240, 300, 360].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSize(s)}
              className={
                size === s
                  ? 'rounded-md bg-brand px-3 py-1.5 text-caption font-medium text-on-brand'
                  : 'rounded-md bg-surface px-3 py-1.5 text-caption font-medium text-text-secondary'
              }
            >
              {s}px
            </button>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          {(['black', 'ginger', 'snow'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCat(c)}
              className={
                cat === c
                  ? 'rounded-md bg-brand px-3 py-1.5 text-caption font-medium text-on-brand'
                  : 'rounded-md bg-surface px-3 py-1.5 text-caption font-medium text-text-secondary'
              }
            >
              {c}
            </button>
          ))}
        </div>

        <div data-cat className="mt-5 grid place-items-center rounded-lg bg-page p-3 shadow-sm">
          <CatCloseUp cat={cat} />
        </div>

        <p className="mt-5 pb-10 text-caption text-text-tertiary">
          The settled state is the scan target: flat, on white, full contrast,
          four-module quiet zone. Point a camera at one once it has landed.
        </p>
      </div>
    </div>
  );
}

/** The cat on its own and large, walking on the spot, to judge it up close. */
function CatCloseUp({ cat }: { cat: CatKind }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return undefined;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = 300 * dpr;
    canvas.height = 200 * dpr;
    let frame = 0;
    const draw = (now: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 150 * dpr, 175 * dpr);
      paintCat(ctx, 140, cat, now / 170, now % 4200 < 150 ? 1 : 0);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [cat]);
  return <canvas ref={ref} style={{ width: 300, height: 200 }} />;
}
