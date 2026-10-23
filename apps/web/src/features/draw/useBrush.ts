import { useCallback, useState } from 'react';
import { DEFAULT_SIZE, MAX_SIZE, MIN_SIZE, type Brush } from './brushes';

const KEY = 'pingo:draw';
const BRUSH_IDS: readonly Brush[] = ['pen', 'marker', 'neon', 'chalk', 'arrow', 'eraser'];

interface Saved {
  brush: Brush;
  size: number;
}

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null;
    const brush = raw?.brush && BRUSH_IDS.includes(raw.brush) ? raw.brush : 'pen';
    const size =
      typeof raw?.size === 'number' ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, raw.size)) : DEFAULT_SIZE;
    return { brush, size };
  } catch {
    return { brush: 'pen', size: DEFAULT_SIZE };
  }
}

/** The chosen brush and width, remembered between drawings so the pen is where it was left. */
export function useBrush() {
  const [saved, setSaved] = useState<Saved>(load);
  const update = useCallback((next: Partial<Saved>) => {
    setSaved((current) => {
      const merged = { ...current, ...next };
      try {
        localStorage.setItem(KEY, JSON.stringify(merged));
      } catch {
        /* private mode: the choice just lasts this session */
      }
      return merged;
    });
  }, []);
  return {
    brush: saved.brush,
    size: saved.size,
    setBrush: (brush: Brush) => update({ brush }),
    setSize: (size: number) => update({ size }),
  };
}
