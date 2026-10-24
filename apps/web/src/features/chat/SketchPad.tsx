import type { DrawingAnchor } from '@pingo/core';
import { Redo2, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Overlay } from '../../components/Overlay.js';
import { BrushRow, ColourRow, DrawDock, SizeSlider } from '../draw/DrawChrome.js';
import { paintStrokes, type DrawStroke } from '../draw/brushes.js';
import { useBrush } from '../draw/useBrush.js';

/**
 * Drawing straight over the conversation.
 *
 * The chat stays visible behind a light veil and the page is clear, so what
 * is drawn is lines and nothing else. Done crops to the drawing and sends it as
 * a picture and pins it to the message beside it, so it stays on that spot of
 * the page for both people (see `DrawingLayer`).
 */

const SCALE = 2;

function exportDrawing(strokes: DrawStroke[], w: number, h: number, content: HTMLElement | null): Promise<{ blob: Blob; anchor: DrawingAnchor } | null> {
  const full = document.createElement('canvas');
  full.width = Math.round(w * SCALE);
  full.height = Math.round(h * SCALE);
  const context = full.getContext('2d');
  if (!context) return Promise.resolve(null);
  paintStrokes(context, strokes, full.width, full.height);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const unit = Math.min(full.width, full.height);
  for (const stroke of strokes) {
    // Room for the widest a stroke can paint: marker is wide, neon glows.
    const pad = stroke.size * unit * 3.2 + 8;
    for (const point of stroke.points) {
      minX = Math.min(minX, point.x * full.width - pad);
      maxX = Math.max(maxX, point.x * full.width + pad);
      minY = Math.min(minY, point.y * full.height - pad);
      maxY = Math.max(maxY, point.y * full.height + pad);
    }
  }
  const x = Math.max(0, Math.floor(minX));
  const y = Math.max(0, Math.floor(minY));
  const width = Math.min(full.width, Math.ceil(maxX)) - x;
  const height = Math.min(full.height, Math.ceil(maxY)) - y;
  if (width < 2 || height < 2) return Promise.resolve(null);

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  out.getContext('2d')?.drawImage(full, x, y, width, height, 0, 0, width, height);

  /*
   * Pinned to the message it sits beside: the last one that starts above the
   * drawing's top edge (or the first on the page, when it is above them all).
   * What is stored is the offset from that message, in thread widths.
   */
  if (!content) return Promise.resolve(null);
  const base = content.getBoundingClientRect();
  const left = x / SCALE;
  const top = y / SCALE;
  let anchor: HTMLElement | undefined;
  let anchorTop = -Infinity;
  for (const element of content.querySelectorAll<HTMLElement>('[id^="message-"]')) {
    const t = element.getBoundingClientRect().top;
    if (t <= top && t > anchorTop) {
      anchor = element;
      anchorTop = t;
    }
  }
  anchor ??= content.querySelector<HTMLElement>('[id^="message-"]') ?? undefined;
  if (!anchor || base.width === 0) return Promise.resolve(null);
  const placement: DrawingAnchor = {
    messageId: anchor.id.slice('message-'.length),
    x: (left - base.left) / base.width,
    y: (top - anchor.getBoundingClientRect().top) / base.width,
    w: width / SCALE / base.width,
  };
  return new Promise((resolve) => out.toBlob((blob) => resolve(blob ? { blob, anchor: placement } : null), 'image/png'));
}

export function SketchPad({ content, onCancel, onDone }: { content: HTMLElement | null; onCancel: () => void; onDone: (file: File, anchor: DrawingAnchor) => void }) {
  const { brush, size, setBrush, setSize } = useBrush();
  // Not white: it lands on the other person's wallpaper, light or dark.
  const [colour, setColour] = useState('#ff3b5c');
  const [strokes, setStrokes] = useState<DrawStroke[]>([]);
  const [redo, setRedo] = useState<DrawStroke[]>([]);
  const [busy, setBusy] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef<DrawStroke | undefined>(undefined);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const measure = () => {
      const rect = surface.current?.getBoundingClientRect();
      if (rect) setBox({ w: rect.width, h: rect.height });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context || box.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    element.width = box.w * dpr;
    element.height = box.h * dpr;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, box.w, box.h);
    paintStrokes(context, strokes, box.w, box.h);
  }, [strokes, box]);

  const at = (event: { clientX: number; clientY: number }) => {
    const rect = surface.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  };

  const round = 'grid size-10 place-items-center rounded-full bg-black/45 text-white backdrop-blur disabled:opacity-35';

  return (
    <Overlay onDismiss={onCancel}>
      <div className="fixed inset-0 z-500 bg-black/35 backdrop-blur-[1px]">
        <div
          ref={surface}
          className="absolute inset-0 touch-none"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setRedo([]);
            current.current = { brush, colour, size, points: [at(event)] };
            setStrokes((all) => [...all, current.current!]);
          }}
          onPointerMove={(event) => {
            if (!current.current) return;
            current.current.points.push(at(event));
            setStrokes((all) => [...all]);
          }}
          onPointerUp={() => {
            current.current = undefined;
          }}
        >
          <canvas ref={canvas} className="pointer-events-none absolute inset-0 size-full" />
        </div>

        <div className="absolute inset-x-3 top-3 z-10 flex items-center justify-between pt-[env(safe-area-inset-top)]">
          <div className="flex gap-2">
            <button type="button" aria-label="Close" onClick={onCancel} className={round}>
              ✕
            </button>
            <button
              type="button"
              aria-label="Undo"
              disabled={strokes.length === 0}
              onClick={() =>
                setStrokes((all) => {
                  const last = all[all.length - 1];
                  if (last) setRedo((x) => [...x, last]);
                  return all.slice(0, -1);
                })
              }
              className={round}
            >
              <Undo2 size={19} />
            </button>
            <button
              type="button"
              aria-label="Redo"
              disabled={redo.length === 0}
              onClick={() => {
                const next = redo[redo.length - 1];
                if (!next) return;
                setRedo((x) => x.slice(0, -1));
                setStrokes((all) => [...all, next]);
              }}
              className={round}
            >
              <Redo2 size={19} />
            </button>
          </div>
          <button
            type="button"
            disabled={strokes.length === 0 || busy}
            onClick={() => {
              setBusy(true);
              void exportDrawing(strokes, box.w, box.h, content).then((made) => {
                setBusy(false);
                if (made) onDone(new File([made.blob], 'drawing.png', { type: 'image/png' }), made.anchor);
              });
            }}
            className="rounded-full bg-brand px-5 py-1.5 text-[15px] font-bold text-on-brand disabled:opacity-40"
          >
            Done
          </button>
        </div>

        <SizeSlider size={size} colour={colour} brush={brush} frameHeight={box.h || 600} onChange={setSize} />
        <div className="absolute inset-x-0 bottom-4 z-10 px-3 pb-[env(safe-area-inset-bottom)]">
          <DrawDock brush={brush}>
            <BrushRow brush={brush} onChange={setBrush} />
            <ColourRow colour={colour} onChange={setColour} />
          </DrawDock>
        </div>
      </div>
    </Overlay>
  );
}
