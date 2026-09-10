import { useState } from 'react';

import { VoxelQr } from '../../features/profile/VoxelQr.js';

/**
 * The tree-to-QR transition, on its own, at `/dev/qr-lab`.
 *
 * Here rather than inside the share sheet because the thing being judged is a
 * second of motion, and judging it means replaying it twenty times without
 * opening a sheet twenty times.
 */
export function VoxelQrLab() {
  const [value, setValue] = useState('https://pingochat.pages.dev/profile/anaya');
  const [size, setSize] = useState(300);
  const [canopy, setCanopy] = useState(1.25);
  // Remounting is the replay: the hold-then-open runs from the top again.
  const [take, setTake] = useState(0);

  return (
    <div className="h-full overflow-y-auto bg-sunken">
      <div className="mx-auto w-full max-w-md px-4 py-6">
        <h1 className="text-h2 text-ink">Tree → QR</h1>
        <p className="mt-1 text-caption text-text-tertiary">
          Tap it. Tap it again to grow it back.
        </p>

        <div className="mt-5 grid place-items-center rounded-lg bg-page p-5 shadow-sm">
          <VoxelQr key={take} value={value} size={size} canopy={canopy} autoPlay />
        </div>

        <button
          type="button"
          onClick={() => setTake((n) => n + 1)}
          className="mt-4 w-full rounded-md bg-brand px-3 py-2 text-body font-medium text-on-brand"
        >
          Replay
        </button>

        <label className="mt-5 block text-caption text-text-secondary">
          Canopy {canopy.toFixed(2)} &mdash; 1 is lawn-width
          <input
            type="range"
            min={1}
            max={2.4}
            step={0.01}
            value={canopy}
            onChange={(event) => setCanopy(Number(event.target.value))}
            className="mt-1 w-full"
          />
        </label>

        <label className="mt-4 block text-caption text-text-secondary">
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

        <p className="mt-5 pb-10 text-caption text-text-tertiary">
          The settled state is the scan target: flat, on white, full contrast,
          four-module quiet zone. Point a camera at it once it has landed.
        </p>
      </div>
    </div>
  );
}
