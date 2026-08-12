import {
  ArrowLeftIcon,
  CheckIcon,
  CloseIcon,
  EditIcon,
  GridIcon,
  ImageIcon,
  PlusIcon,
  SmileIcon,
  SwapIcon,
  cn,
} from '@pingo/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { StoryAudioDraft, VideoEdit, VideoOverlayItem } from '@pingo/core';

import { VideoTrimSheet } from '../chat/VideoTrimSheet.js';
import { useStickers } from '../stickers/StickerContext.js';
import { StoryAudioSheet } from '../stories/StoryAudioSheet.js';
import {
  OVERLAY_SIZE,
  PEN_WIDTH,
  pictureRatio,
  useContainBox,
  videoGeometry,
} from './VideoOverlay.js';

/**
 * The edit stage: draw on the snap, put text on it, then hand back a flat image.
 *
 * ## Everything is stored in normalised coordinates
 *
 * Strokes and text positions are kept as fractions of the frame (0-1), never as
 * pixels. The preview is whatever size the screen allows; the export is the
 * photo's native resolution - often three times larger. Storing pixels would
 * mean text that sits perfectly on screen and lands somewhere else in the file,
 * and a stroke drawn 4px wide on a phone coming out hairline on a 1280px image.
 *
 * With fractions, export is one multiplication and the result matches the
 * preview exactly at any size.
 *
 * ## Text is DOM while editing, canvas only at export
 *
 * Dragging a `<canvas>`-rendered label means re-rendering the whole scene on
 * every pointer move and writing hit-testing by hand. A positioned `<div>` gets
 * dragging, wrapping and font rendering from the browser. It is only flattened
 * into pixels once, at the end.
 */

const COLOURS = ['#ffffff', '#101114', '#ff3b5c', '#ffc93c', '#3ddc84', '#5c6cff'];

interface Stroke {
  colour: string;
  /** Normalised points, 0-1. */
  points: { x: number; y: number }[];
}

/**
 * Anything placed on top of the picture.
 *
 * Text, emoji and stickers are one type rather than three, because they are one
 * thing to the user: something you put somewhere and then move. They differ
 * only in what gets painted at export, and three parallel arrays would mean
 * three copies of dragging, removal and the export loop.
 */
interface Item {
  id: string;
  kind: 'text' | 'emoji' | 'sticker';
  /** The words, the emoji, or the sticker's name for its alt text. */
  value: string;
  /** Stickers only. Fetched with CORS at export so the canvas stays clean. */
  url?: string;
  colour: string;
  /** Normalised centre. */
  x: number;
  y: number;
  /**
   * Pinched size and turn.
   *
   * Everything placed on a picture used to be exactly one size and exactly
   * upright - a 3rem emoji, a sticker at 18% of the frame - so the only way to
   * make something bigger was to not want it bigger. These carry the gesture
   * from the preview through to the export, where the same numbers scale the
   * font and the sticker rather than a second set being invented.
   *
   * Clamped where they are applied rather than here: a value on its way
   * through a pinch is allowed to be anything, and the limit belongs to the
   * thing being drawn.
   */
  scale: number;
  /** Radians, clockwise. */
  rotation: number;
}

/** Normalised crop rectangle, 0-1 over the displayed frame. */
interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Tool = 'none' | 'draw' | 'text' | 'emoji' | 'sticker' | 'crop';

/**
 * The emoji offered on the toolbar.
 *
 * A short row rather than the full picker. The picker is a panel with search
 * and categories and belongs in a composer; here it would cover the picture you
 * are decorating. Anything not on this row can still be typed into a text
 * label, which is how most emoji reach an image anyway.
 */
const QUICK_EMOJI = ['😂', '❤️', '🔥', '😮', '😢', '✨', '👀', '🎉', '💯', '🙏'];

export function SnapEditor({
  src,
  onCancel,
  onDone,
  busy,
  extras,
  doneLabel = 'Next',
  /**
   * When set, a second button saves this frame and lets the host open another
   * photo (multi-slide stories). Absent for camera send / single-shot flows.
   */
  onAddAnother,
  addAnotherLabel = 'Add another photo',
  untouchable,
  video = false,
  onDoneVideo,
  initialEdit,
  audio,
  onAudioChange,
}: {
  src: string;
  onCancel: () => void;
  onDone: (blob: Blob) => void;
  busy?: boolean;
  /** Rendered above the confirm button - caption, view limit, whatever fits. */
  extras?: React.ReactNode;
  /** 'Next' from the camera, 'Send' when the picture is going straight out. */
  doneLabel?: string;
  onAddAnother?: (blob: Blob) => void;
  addAnotherLabel?: string;
  /**
   * Bytes to hand back as they are, instead of exporting the canvas.
   *
   * For a picture that moves. Export paints onto a canvas, and a canvas holds
   * one frame - so a GIF came out the far end as a poster of its first moment,
   * which is exactly what it looked like it was not going to do, because the
   * editor was showing the real file animating the whole time.
   *
   * The tools go with it. There is no honest way to draw on an animation here:
   * keeping the frames means not painting on them, and the alternative is
   * offering a pen that silently flattens what it touches.
   */
  untouchable?: Blob;
  /**
   * The picture moves, and stays untouched anyway.
   *
   * A clip gets the same editor as a still - the same emoji row, the same
   * sticker packs, the same drag-and-pinch - because to the person holding the
   * phone there is no difference between decorating a photo and decorating a
   * video, and there was no reason for the product to insist on one.
   *
   * What differs is only where the decoration ends up. Nothing here is burnt
   * into the frames: pressing Done hands back a `VideoEdit` - the trim marks
   * and the placed items - and the player puts them back over the original
   * file. Which is also why the pen and the crop box are not offered: both
   * describe a single frame, and there is no honest way to apply them to
   * twenty seconds of them without re-encoding the clip.
   */
  video?: boolean;
  /** Video mode's Done. The bytes never change, so only the marks come back. */
  onDoneVideo?: (edit: VideoEdit) => void;
  /** Marks and items this clip already carries, so re-opening it resumes. */
  initialEdit?: VideoEdit;
  /**
   * Sound on the story, owned by whoever is posting it.
   *
   * Held by the caller rather than here because it survives this editor: a
   * photo is flattened and handed back as bytes, and the sound that goes with
   * it has to arrive at the post alongside those bytes rather than inside
   * them. The tool only appears when there is somewhere for it to go, which is
   * what keeps it off the camera's send-a-Ping path.
   */
  audio?: StoryAudioDraft[];
  onAudioChange?: (audio: StoryAudioDraft[]) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  /** Video mode: the area the clip is fitted into, and the clip's own shape. */
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ratio, setRatio] = useState<number>();

  const [tool, setTool] = useState<Tool>('none');
  const [colour, setColour] = useState(COLOURS[0]!);
  const [strokes, setStrokes] = useState<Stroke[]>(() =>
    (initialEdit?.strokes ?? []).map((stroke) => ({ ...stroke })),
  );
  const [items, setItems] = useState<Item[]>(() =>
    (initialEdit?.overlay ?? []).map((item) => ({ ...item, id: crypto.randomUUID() })),
  );
  /** Video mode: where the clip starts, ends, and whether it speaks. */
  const [trim, setTrim] = useState<VideoEdit | undefined>(initialEdit);
  const [trimOpen, setTrimOpen] = useState(false);
  const [audioOpen, setAudioOpen] = useState(false);
  /**
   * Video mode: sound in the preview.
   *
   * On, because an editor that plays a clip silently is an editor that lies
   * about what is being posted. It drops to off only if the browser refuses to
   * start an audible clip by itself, which is a policy about autoplay rather
   * than a decision anybody made - and then the speaker button below buys it
   * back with the tap that policy is waiting for.
   */
  const [sound, setSound] = useState(true);
  /** Silent because the sender said so, or because autoplay would not start. */
  const silent = !sound || trim?.muted === true;
  const drawing = useRef<Stroke | undefined>(undefined);
  /** Quarter turns, clockwise. Applied at export, previewed with a transform. */
  const [rotation, setRotation] = useState(initialEdit?.rotate ?? 0);
  /** Absent means the whole frame. Applied at export, previewed as a mask. */
  const [crop, setCrop] = useState<Crop | undefined>(initialEdit?.crop);
  const [exportError, setExportError] = useState<string>();
  const [exporting, setExporting] = useState(false);

  const addItem = useCallback(
    (item: Omit<Item, 'id' | 'x' | 'y' | 'scale' | 'rotation'>) =>
      setItems((all) => [
        ...all,
        // Slightly above centre, where the thumb is not, so a new item is
        // never dropped underneath the finger that asked for it.
        { ...item, id: crypto.randomUUID(), x: 0.5, y: 0.4, scale: 1, rotation: 0 },
      ]),
    [],
  );

  /*
   * ---- video: keeping what is placed where it was put ---------------------
   *
   * On a photo, everything placed is painted into the picture at export and
   * cropping or turning the canvas afterwards carries it along for free. A clip
   * is never painted, so its decorations are stored against the *final* frame -
   * the turned, cropped one - and re-framing that picture has to move them by
   * hand, or a sticker sitting on somebody's shoulder ends up in the sky the
   * moment the crop box is nudged.
   *
   * Both of these are the same two lines of arithmetic in different clothes:
   * express the old position in the new frame's units.
   */

  /** What the crop was when the crop tool opened, so the exit can reframe. */
  const cropOnOpen = useRef<Crop | undefined>(undefined);
  const lastTool = useRef<Tool>('none');

  const reframe = useCallback((from: Crop, to: Crop) => {
    if (from.x === to.x && from.y === to.y && from.w === to.w && from.h === to.h) return;

    const move = (point: { x: number; y: number }) => ({
      x: (from.x + point.x * from.w - to.x) / to.w,
      y: (from.y + point.y * from.h - to.y) / to.h,
    });

    setItems((all) =>
      all.map((item) => ({
        ...item,
        ...move(item),
        // Sizes are fractions of the picture's height, so a shorter frame
        // makes the same sticker a larger fraction of it.
        scale: (item.scale * from.h) / to.h,
      })),
    );
    setStrokes((all) => all.map((stroke) => ({ ...stroke, points: stroke.points.map(move) })));
  }, []);

  const WHOLE: Crop = { x: 0, y: 0, w: 1, h: 1 };

  useEffect(() => {
    if (!video) return;
    const previous = lastTool.current;
    lastTool.current = tool;
    if (previous === 'crop' && tool !== 'crop') {
      reframe(cropOnOpen.current ?? WHOLE, crop ?? WHOLE);
    }
    // `crop` is read on the exit edge only; watching it would reframe mid-drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, video, reframe]);

  /** A quarter turn clockwise, with everything on the picture turning too. */
  const turn = useCallback(() => {
    const spun = (point: { x: number; y: number }) => ({ x: 1 - point.y, y: point.x });
    const before = pictureRatio(ratio ?? 1, rotation, crop);

    setItems((all) =>
      all.map((item) => ({
        ...item,
        ...spun(item),
        rotation: item.rotation + Math.PI / 2,
        scale: item.scale / before,
      })),
    );
    setStrokes((all) => all.map((stroke) => ({ ...stroke, points: stroke.points.map(spun) })));
    // The crop rectangle describes the turned picture, so it turns as well.
    setCrop((current) =>
      current
        ? { x: 1 - (current.y + current.h), y: current.x, w: current.h, h: current.w }
        : undefined,
    );
    setRotation((r) => (r + 90) % 360);
  }, [ratio, rotation, crop]);

  /*
   * Start it playing, with sound if the browser will allow it.
   *
   * `autoplay` on an audible clip is refused nearly everywhere, and the refusal
   * is silent - the editor simply showed a still frame that never moved, or
   * played without sound and looked like the clip had none. So playback is
   * asked for explicitly: if the answer is no, the preview drops to silent and
   * tries again, which always succeeds, and the speaker button offers the sound
   * back on a tap.
   */
  useEffect(() => {
    if (!video) return;
    const media = videoRef.current;
    if (!media) return;
    void media.play().catch(() => setSound(false));
    // Also after a sheet closes: opening the sound editor starts an audio
    // graph of its own, and on several browsers that takes the audio focus
    // and stops the clip - which looked like adding music had broken it.
  }, [video, silent, src, trimOpen, audioOpen]);

  // ---- drawing ------------------------------------------------------------

  const toNormalised = useCallback((event: React.PointerEvent) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return undefined;
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  }, []);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const rect = frameRef.current?.getBoundingClientRect();
    const context = canvas?.getContext('2d');
    if (!canvas || !rect || !context) return;

    // Backing store at device resolution; strokes stay crisp on a phone.
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== rect.width * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    context.lineCap = 'round';
    context.lineJoin = 'round';

    const all = drawing.current ? [...strokes, drawing.current] : strokes;
    for (const stroke of all) {
      if (stroke.points.length === 0) continue;
      context.strokeStyle = stroke.colour;
      context.lineWidth = PEN_WIDTH * Math.min(rect.width, rect.height);
      context.beginPath();
      stroke.points.forEach((point, index) => {
        const x = point.x * rect.width;
        const y = point.y * rect.height;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
    }
  }, [strokes]);

  useEffect(paint, [paint]);
  useEffect(() => {
    window.addEventListener('resize', paint);
    return () => window.removeEventListener('resize', paint);
  }, [paint]);

  // ---- export -------------------------------------------------------------

  const flatten = useCallback(async (deliver: (blob: Blob) => void = onDone) => {
    if (exporting) return;

    /*
     * A moving picture leaves exactly as it arrived.
     *
     * Before anything else, because everything below this line turns the
     * picture into a single frame.
     */
    if (untouchable) {
      deliver(untouchable);
      return;
    }

    /*
     * A clip leaves as marks, not as pixels. Same reason, one step further:
     * there is no frame to paint on, so what the user arranged is written
     * down and applied at playback.
     */
    if (video) {
      onDoneVideo?.({
        ...(trim?.trimStart !== undefined ? { trimStart: trim.trimStart } : {}),
        ...(trim?.trimEnd !== undefined ? { trimEnd: trim.trimEnd } : {}),
        ...(trim?.muted ? { muted: true } : {}),
        ...(rotation ? { rotate: rotation as 90 | 180 | 270 } : {}),
        ...(crop ? { crop } : {}),
        ...(strokes.length > 0
          ? { strokes: strokes.map((stroke) => ({ colour: stroke.colour, points: stroke.points })) }
          : {}),
        ...(items.length > 0
          ? {
              overlay: items.map(
                ({ id: _id, ...rest }): VideoOverlayItem => ({
                  ...rest,
                  // Empty labels are a tap that changed nothing; they would
                  // arrive as an invisible plate over somebody's face.
                  value: rest.kind === 'text' ? rest.value.trim() : rest.value,
                }),
              ).filter((item) => item.kind !== 'text' || item.value.length > 0),
            }
          : {}),
      });
      return;
    }

    setExportError(undefined);
    setExporting(true);

    try {
      const image = imageRef.current;
      if (!image) throw new Error('Image is not ready.');

      // Next can fire before decode finishes - natural size is then 0 and the
      // export produces nothing, with no feedback.
      if (!image.complete || image.naturalWidth === 0) {
        try {
          await image.decode();
        } catch {
          throw new Error('Image is still loading. Wait a moment and try again.');
        }
      }

      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (width < 1 || height < 1) {
        throw new Error('Image is still loading. Wait a moment and try again.');
      }

      /*
       * Rotation is applied to the canvas rather than to the annotations.
       *
       * Strokes and text are stored in the *image's* coordinate space, so drawing
       * them after the canvas has been turned puts them exactly where the user
       * left them relative to the picture - which is what they were aiming at.
       * Rotating each point by hand would be the same maths done worse.
       */
      const quarterTurned = rotation % 180 !== 0;
      const out = document.createElement('canvas');
      out.width = quarterTurned ? height : width;
      out.height = quarterTurned ? width : height;

      const context = out.getContext('2d');
      if (!context) throw new Error('Could not prepare the image.');

      context.translate(out.width / 2, out.height / 2);
      context.rotate((rotation * Math.PI) / 180);
      context.translate(-width / 2, -height / 2);

      context.drawImage(image, 0, 0, width, height);

      // Strokes, re-drawn at native size rather than upscaled from the preview  - 
      // scaling a bitmap would soften every line.
      context.lineCap = 'round';
      context.lineJoin = 'round';
      for (const stroke of strokes) {
        if (stroke.points.length === 0) continue;
        context.strokeStyle = stroke.colour;
        context.lineWidth = PEN_WIDTH * Math.min(width, height);
        context.beginPath();
        stroke.points.forEach((point, index) => {
          const x = point.x * width;
          const y = point.y * height;
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        context.stroke();
      }

      const fontSize = Math.round(height * 0.052);
      context.font = `600 ${fontSize}px "Space Grotesk", system-ui, sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';

      /*
       * Stickers first, fetched with CORS.
       *
       * Drawing a cross-origin image onto a canvas taints it, and a tainted
       * canvas throws on `toBlob` - the export would fail at the very last step,
       * after the user had done all the work. `crossOrigin = 'anonymous'` asks
       * for the CORS headers that keep it clean; the packs are served from a CDN
       * that sends them. A sticker that will not load is skipped rather than
       * taking the whole picture down with it.
       */
      await Promise.all(
        items
          .filter((item) => item.kind === 'sticker' && item.url)
          .map(
            (item) =>
              new Promise<void>((resolve) => {
                const sticker = new Image();
                sticker.crossOrigin = 'anonymous';
                sticker.onload = () => {
                  const size = height * 0.18 * item.scale;
                  const ratio = sticker.naturalWidth / sticker.naturalHeight || 1;
                  const w = ratio >= 1 ? size : size * ratio;
                  const h = ratio >= 1 ? size / ratio : size;
                  /*
                   * Turned about its own centre, which is what the preview
                   * does. Drawing rotated means moving the canvas rather than
                   * the image: translate to the point, rotate, then draw
                   * around the origin.
                   */
                  drawTurned(context, item, width, height, () =>
                    context.drawImage(sticker, -w / 2, -h / 2, w, h),
                  );
                  resolve();
                };
                sticker.onerror = () => resolve();
                sticker.src = item.url!;
              }),
          ),
      );

      // Emoji: painted as text, but larger and without the plate a label gets.
      for (const item of items) {
        if (item.kind !== 'emoji') continue;
        const emojiSize = Math.round(height * 0.12 * item.scale);
        context.font = `${emojiSize}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        drawTurned(context, item, width, height, () => context.fillText(item.value, 0, 0));
      }

      context.font = `600 ${fontSize}px "Space Grotesk", system-ui, sans-serif`;

      for (const text of items) {
        if (text.kind !== 'text') continue;
        const value = text.value.trim();
        if (!value) continue;

        /*
         * Sized and turned like the preview, then drawn about the origin -
         * `drawTurned` has already moved the canvas to where this belongs.
         */
        const scaled = Math.round(fontSize * text.scale);
        context.font = `600 ${scaled}px "Space Grotesk", system-ui, sans-serif`;
        const x = 0;
        const y = 0;

        /*
         * A dark plate behind the words, matching the on-screen chip.
         *
         * White text on a bright sky is unreadable, and this is the one place the
         * export must not diverge from what the user arranged.
         *
         * `roundRect` is not on every engine - falling back to a plain rect keeps
         * export from throwing after the user finished editing.
         */
        drawTurned(context, text, width, height, () => {
          const metrics = context.measureText(value);
          const padX = scaled * 0.42;
          const padY = scaled * 0.3;
          const plateX = x - metrics.width / 2 - padX;
          const plateY = y - scaled / 2 - padY;
          const plateW = metrics.width + padX * 2;
          const plateH = scaled + padY * 2;
          const radius = scaled * 0.36;
          context.fillStyle = 'rgba(16, 17, 20, 0.42)';
          context.beginPath();
          if (typeof context.roundRect === 'function') {
            context.roundRect(plateX, plateY, plateW, plateH, radius);
          } else {
            context.rect(plateX, plateY, plateW, plateH);
          }
          context.fill();

          context.fillStyle = text.colour;
          context.fillText(value, x, y);
        });
      }

      /*
       * Crop last, and after rotation on purpose.
       *
       * The rectangle was dragged over the picture as it looked on screen - which
       * is the rotated picture. Cropping the source before turning it would apply
       * the user's rectangle to a different orientation and cut out the wrong
       * part; doing it here means "what was inside the box" is exactly what comes
       * out, whatever else was done first.
       */
      const finished = crop ? cropCanvas(out, crop) : out;

      /*
       * PNG when there is anything to keep transparent, JPEG otherwise.
       *
       * Everything left here as JPEG, which has no alpha channel at all - so a
       * sticker with a cut-out background, a logo, or any PNG somebody sent
       * arrived with its transparency filled in black. The picture was never
       * broken on the way in; it was destroyed on the way out, in the one line
       * that every photo in the product passes through.
       *
       * JPEG stays the default deliberately. A photograph re-encoded as PNG is
       * several times the size for no visible gain, and this is the path a
       * camera shot takes too.
       */
      const type = hasTransparency(finished) ? 'image/png' : 'image/jpeg';

      const blob = await new Promise<Blob | null>((resolve, reject) => {
        try {
          finished.toBlob((result) => resolve(result), type, 0.92);
        } catch (cause) {
          reject(cause instanceof Error ? cause : new Error('Could not export the image.'));
        }
      });

      if (!blob || blob.size === 0) {
        throw new Error('Could not export the image. Try again.');
      }

      deliver(blob);
    } catch (cause) {
      setExportError(
        cause instanceof Error ? cause.message : 'Could not prepare the story. Try again.',
      );
    } finally {
      setExporting(false);
    }
  }, [strokes, items, rotation, crop, onDone, exporting, untouchable, video, onDoneVideo, trim]);

  // ---- render -------------------------------------------------------------

  /*
   * The clip's letterboxed rectangle, after turning and cropping.
   *
   * While the crop box is open the frame goes back to the whole picture -
   * choosing a rectangle out of the rectangle you last chose is not a thing
   * anybody means to do, and it is how a crop tool becomes impossible to undo.
   */
  const framing = tool === 'crop' ? undefined : crop;
  const box = useContainBox(
    stageRef,
    video && ratio ? pictureRatio(ratio, rotation, framing) : undefined,
  );
  /** Both known: the clip's shape, and the room it has. Until then, letterbox. */
  const fitted = Boolean(video && ratio && box && box.width > 0 && box.height > 0);
  const geometry = videoGeometry(box ?? { width: 0, height: 0 }, rotation, framing);

  /*
   * Repaint whenever the surface under the pen changes size or comes back.
   *
   * The strokes live on a canvas sized to the frame, and on a clip the frame
   * changes shape - a quarter turn, a crop chosen, the crop tool opening and
   * taking the canvas away with it. `paint` only re-runs when the strokes
   * themselves change, so without this the lines return to an empty canvas and
   * look deleted until the next one is drawn.
   */
  useEffect(() => {
    paint();
  }, [paint, tool, box?.width, box?.height]);

  /*
   * Placed once, used by both frames. Text, emoji and stickers are dragged and
   * pinched identically whether the picture underneath moves or not - the only
   * difference is that a video sizes them against its own height, so what is
   * arranged here is what a viewer sees on a screen of any size.
   */
  const placedItems = items.map((item) => (
    <DraggableItem
      key={item.id}
      item={item}
      frameRef={frameRef}
      relative={video}
      onChange={(next) => setItems((all) => all.map((t) => (t.id === next.id ? next : t)))}
      onRemove={() => setItems((all) => all.filter((t) => t.id !== item.id))}
    />
  ));

  return (
    <div className="flex h-full flex-col bg-backdrop">
      {/*
        ~6–8px breathing room so the image is not hard against the viewport
        edge. Function of the frame is unchanged.
      */}
      <div
        ref={stageRef}
        className={cn(
          'relative m-2 min-h-0 flex-1 overflow-hidden rounded-xl',
          video && 'grid place-items-center',
        )}
      >
      {video ? (
        /*
          The stage is the screen; the frame is the picture.

          A clip is letterboxed inside the stage, and an emoji dropped at the
          middle belongs in the middle of the *clip* - so everything placed
          lives in a box measured to the video itself, and the black bars
          around it are simply not part of the editor.
        */
        <div
          ref={frameRef}
          className="relative touch-none overflow-hidden rounded-xl bg-black"
          style={{
            // What `cqh` on the placed items is a fraction of.
            containerType: 'size',
            ...(fitted && box
              ? { width: box.width, height: box.height }
              : { width: '100%', height: '100%' }),
          }}
          onPointerDown={(event) => {
            if (tool !== 'draw') return;
            const point = toNormalised(event);
            if (!point) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            drawing.current = { colour, points: [point] };
            paint();
          }}
          onPointerMove={(event) => {
            if (!drawing.current) return;
            const point = toNormalised(event);
            if (!point) return;
            drawing.current.points.push(point);
            paint();
          }}
          onPointerUp={() => {
            if (!drawing.current) return;
            const stroke = drawing.current;
            drawing.current = undefined;
            setStrokes((all) => [...all, stroke]);
          }}
        >
          {/*
            Turned and cropped by transform, never by re-encoding: the picture
            below is the whole clip, shifted so the chosen rectangle lands over
            this frame, and the clip inside it is spun about its own centre.
            The viewer reproduces exactly this from the marks.

            Until the clip has said how tall it is, none of that can be worked
            out - and the clip only says so once it has loaded. Sizing it from
            a box that does not exist yet gave it no size at all, and a browser
            will not load a video it has been told is zero pixels wide: the
            editor sat on a black frame forever, waiting for a number that was
            waiting for it. So it starts as an ordinary letterboxed video and
            takes its measured place the moment it has one.
          */}
          <div style={fitted ? geometry.picture : undefined} className={fitted ? undefined : 'absolute inset-0'}>
            <video
              ref={videoRef}
              src={src}
              autoPlay
              loop
              muted={silent}
              playsInline
              onLoadedMetadata={(event) => {
                const media = event.currentTarget;
                if (media.videoWidth > 0 && media.videoHeight > 0) {
                  setRatio(media.videoWidth / media.videoHeight);
                }
                const from = trim?.trimStart ?? 0;
                if (from > 0) media.currentTime = from;
              }}
              /*
                The preview loops the *trimmed* clip, not the file. Choosing an
                end mark and then watching the editor play past it is the sort of
                thing that makes somebody re-open the trimmer to check.
              */
              onTimeUpdate={(event) => {
                const media = event.currentTarget;
                const from = trim?.trimStart ?? 0;
                const to = trim?.trimEnd;
                if (to !== undefined && media.currentTime >= to) media.currentTime = from;
              }}
              /*
                The preview is never deliberately paused - there is no pause
                control here - so a pause is always something else's doing:
                another audio graph taking focus, the tab going away, a sheet
                opening. Starting it again is what makes the editor feel like a
                thing that is running rather than a thing that stopped.
              */
              onPause={(event) => {
                if (document.hidden) return;
                void event.currentTarget.play().catch(() => undefined);
              }}
              style={fitted ? geometry.video : undefined}
              className={fitted ? undefined : 'absolute inset-0 size-full object-contain'}
            />
          </div>

          {/*
            While the crop box is open the frame shows the whole picture, so
            anything placed on the cropped one would be sitting in the wrong
            place - the lines as much as the stickers. Both come back, moved
            into the new frame, the moment the tool closes.
          */}
          {tool !== 'crop' && (
            <>
              <canvas ref={canvasRef} className="absolute inset-0 size-full" />
              {placedItems}
            </>
          )}

          {tool === 'crop' && (
            <CropOverlay
              crop={crop ?? { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }}
              frameRef={frameRef}
              onChange={setCrop}
            />
          )}

          {/*
            The tap the browser is waiting for.

            Only ever shown when an audible clip was refused a start of its own -
            not as a preference, which is what the trimmer's Sound off is for.
          */}
          {!sound && trim?.muted !== true && (
            <button
              type="button"
              onClick={() => setSound(true)}
              aria-label="Turn on sound"
              className={cn(
                'focus-ring absolute top-2 right-2 grid size-9 place-items-center',
                'rounded-full bg-black/45 text-white backdrop-blur-sm',
                'transition-transform duration-150 ease-standard active:scale-95',
              )}
            >
              <SpeakerOffGlyph />
            </button>
          )}
        </div>
      ) : (
      <div
        ref={frameRef}
        className="absolute inset-0 touch-none"
        onPointerDown={(event) => {
          if (tool !== 'draw') return;
          const point = toNormalised(event);
          if (!point) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drawing.current = { colour, points: [point] };
          paint();
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          const point = toNormalised(event);
          if (!point) return;
          drawing.current.points.push(point);
          paint();
        }}
        onPointerUp={() => {
          if (!drawing.current) return;
          const stroke = drawing.current;
          drawing.current = undefined;
          setStrokes((all) => [...all, stroke]);
        }}
      >
        <img
          ref={imageRef}
          src={src}
          alt="Your snap"
          style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined}
          className="absolute inset-0 size-full object-contain transition-transform duration-quick ease-standard"
        />

        <canvas ref={canvasRef} className="absolute inset-0 size-full" />

        {placedItems}

        {tool === 'crop' && (
          <CropOverlay
            crop={crop ?? { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }}
            frameRef={frameRef}
            onChange={setCrop}
          />
        )}
      </div>
      )}

        <button
          type="button"
          aria-label="Discard snap"
          onClick={onCancel}
          className={cn(
            // ~10% smaller circle, ~15% softer fill - same placement.
            'focus-ring absolute top-3 left-3 z-10 grid size-9 place-items-center',
            'rounded-full bg-black/34 text-white backdrop-blur-sm',
            'transition-colors duration-150 ease-standard',
          )}
        >
          <CloseIcon size={18} />
        </button>
      </div>

      {/* ---- toolbar --------------------------------------------------- */}
      <div
        className={cn(
          'shrink-0 space-y-2.5 px-3 pt-2.5',
          // +8px above browser chrome / home indicator so tools are not crowded.
          'pb-[max(calc(1rem+8px),calc(env(safe-area-inset-bottom)+8px))]',
        )}
      >
        {/*
          No tools on a picture that moves - see `untouchable`. Every one of
          them writes onto a single frame, so offering them would be offering to
          quietly turn an animation into a still. The caption and the view limit
          below still apply, because those are properties of the send rather
          than of the pixels.
        */}
        {!untouchable && (
        <>
        {/*
          One floating bar, in the app's own material.

          The tools were six bare word-chips in a row across the bottom of the
          screen - no icons, no grouping, nothing holding them together - which
          read as a debug strip rather than as part of the product. A glass bar
          with a glyph over each label is the same six controls, given the shape
          everything else that floats here already has.
        */}
        <div
          className={cn(
            'mx-auto w-fit max-w-full rounded-2xl px-1.5 py-1',
            'border border-white/12 bg-white/10 backdrop-blur-xl',
            'shadow-[0_8px_28px_-12px_rgb(0_0_0/0.65)]',
          )}
        >
        <div className="scrollbar-none flex items-center justify-center gap-0.5 overflow-x-auto">
          {/* The one tool only a clip has, first, where the pen sits on a still. */}
          {video && (
            <ToolButton
              label={trim?.trimStart || trim?.trimEnd || trim?.muted ? 'Trimmed' : 'Trim'}
              icon={<ScissorsGlyph />}
              active={Boolean(trim?.trimStart || trim?.trimEnd || trim?.muted)}
              onClick={() => setTrimOpen(true)}
            />
          )}
          <ToolButton
            label="Draw"
            icon={<EditIcon size={17} />}
            active={tool === 'draw'}
            onClick={() => setTool(tool === 'draw' ? 'none' : 'draw')}
          />
          <ToolButton
            label="Text"
            /* The letter is the icon. No glyph in the set says "type here" as
               plainly as a T, and inventing one would be worse than using it. */
            icon={<span className="text-[15px] leading-none font-semibold">T</span>}
            active={false}
            onClick={() => addItem({ kind: 'text', value: 'Tap to edit', colour })}
          />
          <ToolButton
            label="Emoji"
            icon={<SmileIcon size={17} />}
            active={tool === 'emoji'}
            onClick={() => setTool(tool === 'emoji' ? 'none' : 'emoji')}
          />
          <ToolButton
            label="Stickers"
            icon={<ImageIcon size={17} />}
            active={tool === 'sticker'}
            onClick={() => setTool(tool === 'sticker' ? 'none' : 'sticker')}
          />
          <ToolButton
            label="Crop"
            icon={<GridIcon size={17} />}
            active={tool === 'crop'}
            onClick={() => {
              if (tool === 'crop') {
                setTool('none');
                return;
              }
              // Where everything currently sits, so leaving the tool can move
              // it into whatever rectangle was chosen.
              cropOnOpen.current = crop;
              setTool('crop');
              // Opening the tool proposes a crop rather than making the user
              // draw one from nothing on top of their own picture.
              setCrop((current) => current ?? { x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
            }}
          />
          {/*
            A quarter turn per press, which is the whole of rotation as anyone
            uses it - the picture is sideways or it is not. A free-angle dial
            would be a second gesture to learn for a case that barely occurs.

            On a clip the turn is carried by everything on it: what was placed
            beside a face stays beside that face, turned with it.
          */}
          <ToolButton
            label="Rotate"
            icon={<SwapIcon size={17} />}
            active={false}
            onClick={() => (video ? turn() : setRotation((r) => (r + 90) % 360))}
          />
          {/*
            Sound, on a photo as much as on a clip.

            A picture with music on it is a story people post on purpose, and
            this is the one editor both kinds pass through - so the tool lives
            here rather than being a row on the details sheet that only videos
            would find.
          */}
          {onAudioChange && (
            <ToolButton
              label={audio && audio.length > 0 ? `Sound · ${audio.length}` : 'Sound'}
              icon={<NoteGlyph />}
              active={Boolean(audio && audio.length > 0)}
              onClick={() => setAudioOpen(true)}
            />
          )}
          <ToolButton
            label="Undo"
            icon={<ArrowLeftIcon size={17} />}
            active={false}
            disabled={strokes.length === 0}
            onClick={() => setStrokes((all) => all.slice(0, -1))}
          />
        </div>
        </div>

        {tool === 'emoji' && (
          <div
            className={cn(
              'flex items-center justify-center gap-1 overflow-x-auto pb-0.5',
              // Calm fade only - no bounce when the strip opens.
              'animate-fade-in [animation-duration:150ms]',
            )}
          >
            {QUICK_EMOJI.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`Add ${emoji}`}
                onClick={() => addItem({ kind: 'emoji', value: emoji, colour })}
                className={cn(
                  'focus-ring grid size-9 shrink-0 place-items-center rounded-full text-[1.25rem]',
                  'transition-colors duration-150 ease-standard hover:bg-white/10 active:opacity-80',
                )}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        {tool === 'sticker' && (
          <div className="animate-fade-in [animation-duration:150ms]">
            <StickerStrip
              onPick={(sticker) =>
                addItem({ kind: 'sticker', value: sticker.name, url: sticker.url, colour })
              }
              onPickCustomUrl={(url, name) =>
                addItem({ kind: 'sticker', value: name, url, colour })
              }
            />
          </div>
        )}

        {tool === 'crop' && (
          <div
            className={cn(
              'flex items-center justify-center gap-1',
              'animate-fade-in [animation-duration:150ms]',
            )}
          >
            <ToolButton
              label="Reset"
              icon={<ArrowLeftIcon size={17} />}
              active={false}
              onClick={() => setCrop(undefined)}
            />
            <ToolButton
              label="Done"
              icon={<CheckIcon size={17} />}
              active
              onClick={() => setTool('none')}
            />
          </div>
        )}
        </>
        )}

        {/* Caption, view limit - supplied by whoever is using the editor. */}
        {extras}

        {/* Belongs to the pen, so it goes when the pen does. */}
        {!untouchable && (
        <div className="flex items-center justify-center gap-2">
          {COLOURS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={`Colour ${swatch}`}
              aria-pressed={colour === swatch}
              onClick={() => setColour(swatch)}
              style={{ backgroundColor: swatch }}
              className={cn(
                // ~2–3px smaller than size-7; equal gap-2; no scale bounce.
                'focus-ring size-6 shrink-0 rounded-full',
                'transition-[box-shadow,ring-color] duration-150 ease-standard',
                colour === swatch
                  ? 'ring-[1.5px] ring-white ring-offset-1 ring-offset-ink'
                  : 'ring-1 ring-white/20',
              )}
            />
          ))}
        </div>
        )}

        {exportError && (
          <p role="alert" className="text-center text-caption text-danger">
            {exportError}
          </p>
        )}

        {/*
          Side by side, and the primary is the brand's.

          They were two full-width bars stacked against the bottom edge, both
          the same width and weight, one white and one grey - which asks the
          user to read before knowing which one finishes the job. On one line
          the shapes do the telling: "add another" stays a quiet glass control
          and only ever takes the room its words need, and the gradient is the
          same one every primary action in the product wears.
        */}
        <div className="flex items-center gap-2">
          {onAddAnother && (
            <button
              type="button"
              onClick={() => void flatten(onAddAnother)}
              disabled={busy || exporting}
              className={cn(
                'focus-ring flex shrink-0 items-center justify-center gap-2 rounded-full',
                'border border-white/20 bg-white/10 px-4 py-3 text-caption font-medium text-white',
                'backdrop-blur-xl transition-transform duration-150 ease-standard active:scale-[0.97]',
                'disabled:opacity-50',
              )}
            >
              <PlusIcon size={16} />
              {addAnotherLabel}
            </button>
          )}
          <button
            type="button"
            onClick={() => void flatten()}
            disabled={busy || exporting}
            className={cn(
              'focus-ring flex flex-1 items-center justify-center gap-2 rounded-full',
              'bg-brand-gradient py-3 text-body font-semibold text-white',
              'shadow-[0_6px_20px_-8px_rgb(224_85_155/0.75)]',
              'transition-transform duration-150 ease-standard active:scale-[0.98]',
              'disabled:opacity-50',
            )}
          >
            <CheckIcon size={17} />
            {busy || exporting ? 'Working…' : doneLabel}
          </button>
        </div>
      </div>

      {/*
        The trimmer, over the editor rather than beside it.

        Choosing where a clip starts is a different job from arranging things on
        it, and it is the one job that wants the whole clip visible with a pair
        of handles under it. The sheet already exists for chat and already knows
        not to touch the file, so a video story gets the same one.
      */}
      {audioOpen && onAudioChange && (
        <StoryAudioSheet
          audio={audio ?? []}
          onClose={() => setAudioOpen(false)}
          onDone={(next) => {
            onAudioChange(next);
            setAudioOpen(false);
          }}
        />
      )}

      {trimOpen && (
        <VideoTrimSheet
          src={src}
          {...(trim ? { initial: trim } : {})}
          doneLabel="Done"
          onDone={(edit) => {
            if (edit) {
              setTrim(edit);
              // The preview jumps to the new opening frame, so the change is
              // something you see rather than something you are told.
              const media = videoRef.current;
              if (media) media.currentTime = edit.trimStart ?? 0;
            }
            setTrimOpen(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * One tool: a glyph with its name under it.
 *
 * It was a word in a pill. Seven words in a row is a sentence the eye has to
 * read before it can act, and at this size they were also the smallest touch
 * targets on the screen. A shape is recognised without reading, and the label
 * stays underneath so nothing has to be guessed - which is the arrangement
 * every camera app converges on for the same reason.
 */
/** A note. There is no glyph in the set for sound, and this is what sound is. */
function NoteGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={17}
      height={17}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </svg>
  );
}

/** Two arrows on a diagonal: the corner you pull to resize. */
function ResizeGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={12}
      height={12}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 20 20 4M14 4h6v6M10 20H4v-6" />
    </svg>
  );
}

/** A speaker with a slash, for the one tap that buys sound back. */
function SpeakerOffGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="m17 9 4 6M21 9l-4 6" />
    </svg>
  );
}

/** Scissors. The icon set has no cutting glyph, and trim has no other shape. */
function ScissorsGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={17}
      height={17}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="6" cy="6" r="2.6" />
      <circle cx="6" cy="18" r="2.6" />
      <path d="M20 4 8.6 15.4M20 20 8.6 8.6" />
    </svg>
  );
}

function ToolButton({
  label,
  icon,
  active,
  disabled,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={label}
      className={cn(
        'focus-ring flex shrink-0 flex-col items-center gap-1 rounded-xl px-2.5 py-1.5',
        'transition-[background-color,color,transform] duration-150 ease-standard',
        'active:scale-[0.96]',
        active ? 'bg-white text-backdrop' : 'text-white/85 hover:bg-white/10',
        'disabled:opacity-35',
      )}
    >
      <span aria-hidden className="grid h-[18px] place-items-center">
        {icon}
      </span>
      <span aria-hidden className="text-[0.6875rem] leading-none font-medium">
        {label}
      </span>
    </button>
  );
}

/**
 * Crops a finished canvas to a normalised rectangle.
 *
 * Rounded to whole pixels, and never to nothing: a rectangle dragged to a
 * hairline would otherwise produce a zero-width canvas, which `toBlob` answers
 * with `null` and the caller reads as "the export failed".
 */
/**
 * Draws something at an item's place, turned to its angle.
 *
 * The canvas is moved rather than the drawing: translate to where the item
 * belongs, rotate, then let the caller paint around the origin. Doing it the
 * other way - working out where each rotated corner lands - is the same maths
 * repeated at every call site, and it is where a rotated sticker and its
 * rotated shadow stop agreeing.
 *
 * `save`/`restore` are what keep the rotation from leaking into whatever is
 * painted next.
 */
function drawTurned(
  context: CanvasRenderingContext2D,
  item: Pick<Item, 'x' | 'y' | 'rotation'>,
  width: number,
  height: number,
  paint: () => void,
): void {
  context.save();
  context.translate(item.x * width, item.y * height);
  if (item.rotation) context.rotate(item.rotation);
  paint();
  context.restore();
}

/**
 * Whether anything in the finished picture is see-through.
 *
 * Asked of a 64px copy rather than the real canvas. Reading the pixels of a
 * twelve-megapixel export means allocating forty-odd megabytes to answer a
 * yes/no question, on the phone, at the moment the user is waiting for their
 * photo to send. Scaling down first costs one `drawImage` and reads sixteen
 * kilobytes.
 *
 * Downscaling averages, so a transparent region arrives as a partially
 * transparent pixel rather than disappearing - which is the direction that
 * matters. A single stray see-through pixel in a huge image can average away,
 * and that is the right trade: it was invisible anyway, and the alternative is
 * turning every photograph into a PNG on the strength of one pixel.
 */
function hasTransparency(source: HTMLCanvasElement): boolean {
  const probe = document.createElement('canvas');
  const size = 64;
  probe.width = size;
  probe.height = size;

  const context = probe.getContext('2d', { willReadFrequently: true });
  if (!context) return false;

  try {
    context.drawImage(source, 0, 0, size, size);
    const { data } = context.getImageData(0, 0, size, size);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i]! < 250) return true;
    }
    return false;
  } catch {
    // A tainted canvas cannot be read. JPEG is the safe answer: it is what
    // this always produced, so the failure mode is the old behaviour rather
    // than a broken export.
    return false;
  }
}

function cropCanvas(source: HTMLCanvasElement, crop: Crop): HTMLCanvasElement {
  const sx = Math.round(crop.x * source.width);
  const sy = Math.round(crop.y * source.height);
  const sw = Math.max(1, Math.round(crop.w * source.width));
  const sh = Math.max(1, Math.round(crop.h * source.height));

  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  out.getContext('2d')?.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

/**
 * The crop rectangle: drag inside to move it, drag a corner to resize.
 *
 * Four corners rather than eight handles. Edge handles are the difference
 * between adjusting one side and adjusting two, which matters on a desktop with
 * a mouse and is a coin toss on a phone where the handle is smaller than the
 * fingertip. Corners cover both cases with half the targets.
 *
 * Everything outside the rectangle is dimmed rather than hidden, so the picture
 * you are cutting from stays visible while you decide.
 */
function CropOverlay({
  crop,
  frameRef,
  onChange,
}: {
  crop: Crop;
  frameRef: React.RefObject<HTMLDivElement | null>;
  onChange: (crop: Crop) => void;
}) {
  const drag = useRef<
    { corner: string | undefined; x: number; y: number; from: Crop } | undefined
  >(undefined);

  const at = (event: React.PointerEvent) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return undefined;
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  };

  const start = (corner: string | undefined) => (event: React.PointerEvent) => {
    event.stopPropagation();
    const point = at(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { corner, x: point.x, y: point.y, from: crop };
  };

  const move = (event: React.PointerEvent) => {
    const state = drag.current;
    const point = at(event);
    if (!state || !point) return;

    const dx = point.x - state.x;
    const dy = point.y - state.y;
    const { from } = state;
    // Never smaller than a tenth of the frame, so the rectangle cannot be lost.
    const MIN = 0.1;

    if (!state.corner) {
      onChange({
        ...from,
        x: Math.min(1 - from.w, Math.max(0, from.x + dx)),
        y: Math.min(1 - from.h, Math.max(0, from.y + dy)),
      });
      return;
    }

    const left = state.corner.includes('w');
    const top = state.corner.includes('n');

    const x = left ? Math.min(from.x + from.w - MIN, Math.max(0, from.x + dx)) : from.x;
    const y = top ? Math.min(from.y + from.h - MIN, Math.max(0, from.y + dy)) : from.y;
    const w = left ? from.x + from.w - x : Math.min(1 - from.x, Math.max(MIN, from.w + dx));
    const h = top ? from.y + from.h - y : Math.min(1 - from.y, Math.max(MIN, from.h + dy));

    onChange({ x, y, w, h });
  };

  const end = () => {
    drag.current = undefined;
  };

  const corners = [
    ['nw', 'top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize'],
    ['ne', 'top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize'],
    ['sw', 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize'],
    ['se', 'bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize'],
  ] as const;

  return (
    <div className="absolute inset-0 touch-none" onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      {/* The dimmed surround, drawn as four bands rather than a hole. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-backdrop/55" style={{ height: `${crop.y * 100}%` }} />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 bg-backdrop/55"
        style={{ height: `${(1 - crop.y - crop.h) * 100}%` }}
      />
      <div
        className="pointer-events-none absolute left-0 bg-backdrop/55"
        style={{ top: `${crop.y * 100}%`, height: `${crop.h * 100}%`, width: `${crop.x * 100}%` }}
      />
      <div
        className="pointer-events-none absolute right-0 bg-backdrop/55"
        style={{
          top: `${crop.y * 100}%`,
          height: `${crop.h * 100}%`,
          width: `${(1 - crop.x - crop.w) * 100}%`,
        }}
      />

      <div
        role="group"
        aria-label="Crop area"
        onPointerDown={start(undefined)}
        style={{
          left: `${crop.x * 100}%`,
          top: `${crop.y * 100}%`,
          width: `${crop.w * 100}%`,
          height: `${crop.h * 100}%`,
        }}
        className="absolute cursor-move border-2 border-white/90"
      >
        {corners.map(([corner, position]) => (
          <span
            key={corner}
            role="slider"
            tabIndex={0}
            aria-label={`Crop ${corner} corner`}
            aria-valuenow={Math.round(crop.w * 100)}
            onPointerDown={start(corner)}
            className={cn('absolute size-6 rounded-full border-2 border-white bg-backdrop/70', position)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * A horizontal strip of stickers from the installed packs, plus custom
 * sticker / GIF uploads for the story editor.
 *
 * Deliberately not the full `StickerPicker`: that is a tall panel with search
 * and categories, and over a picture you are decorating it would cover the
 * thing you are working on. A strip keeps the image visible, which is the only
 * way to judge where a sticker should go.
 *
 * Custom GIF/sticker files become object URLs placed like pack stickers.
 * Export still flattens to one frame (canvas) — animated GIFs used as stickers
 * freeze on export; pick a still PNG/WebP for stickers you want sharp forever.
 */
function StickerStrip({
  onPick,
  onPickCustomUrl,
}: {
  onPick: (sticker: { name: string; url: string }) => void;
  onPickCustomUrl?: (url: string, name: string) => void;
}) {
  const { packs, loading } = useStickers();
  const stickers = packs.flatMap((pack) => pack.stickers).slice(0, 40);
  const customStickerRef = useRef<HTMLInputElement>(null);
  const customGifRef = useRef<HTMLInputElement>(null);

  const openInput = (el: HTMLInputElement | null) => {
    if (!el) return;
    el.value = '';
    window.requestAnimationFrame(() => el.click());
  };

  const onCustomFile = (file: File | undefined, label: string) => {
    if (!file || !onPickCustomUrl) return;
    const url = URL.createObjectURL(file);
    onPickCustomUrl(url, label);
  };

  return (
    <div className="space-y-2">
      <div className="scrollbar-none flex items-center gap-2 overflow-x-auto pb-1">
        {/* Custom first — the options that were wrongly on “Add to story”. */}
        <button
          type="button"
          onClick={() => openInput(customStickerRef.current)}
          aria-label="Custom sticker"
          className={cn(
            'focus-ring flex size-12 shrink-0 flex-col items-center justify-center gap-0.5',
            'rounded-xl border border-dashed border-white/35 bg-white/8',
            'text-[0.55rem] font-semibold tracking-wide text-white/85',
            'transition-transform duration-instant active:scale-95',
          )}
        >
          <span className="text-[0.95rem] leading-none">✦</span>
          Custom
        </button>
        <button
          type="button"
          onClick={() => openInput(customGifRef.current)}
          aria-label="Custom GIF sticker"
          className={cn(
            'focus-ring flex size-12 shrink-0 flex-col items-center justify-center gap-0.5',
            'rounded-xl border border-dashed border-white/35 bg-white/8',
            'text-[0.55rem] font-semibold tracking-wide text-white/85',
            'transition-transform duration-instant active:scale-95',
          )}
        >
          <span className="text-[0.7rem] font-bold leading-none">GIF</span>
          Custom
        </button>

        {loading && (
          <p className="px-2 text-caption text-white/60">Loading packs…</p>
        )}
        {!loading &&
          stickers.map((sticker) => (
            <button
              key={sticker.id}
              type="button"
              onClick={() => onPick(sticker)}
              aria-label={`Add sticker ${sticker.name}`}
              className={cn(
                'focus-ring size-12 shrink-0 rounded-lg p-1',
                'transition-transform duration-instant hover:bg-white/10 active:scale-110',
              )}
            >
              <img src={sticker.url} alt="" loading="lazy" className="size-full object-contain" />
            </button>
          ))}
        {!loading && stickers.length === 0 && (
          <p className="px-1 text-caption text-white/55">No pack stickers yet</p>
        )}
      </div>

      <input
        ref={customStickerRef}
        type="file"
        accept="image/png,image/webp,image/jpeg,image/*"
        className="pointer-events-none fixed top-0 left-0 h-px w-px opacity-0"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          onCustomFile(file, file?.name || 'Custom sticker');
        }}
      />
      <input
        ref={customGifRef}
        type="file"
        accept="image/gif,.gif,image/webp"
        className="pointer-events-none fixed top-0 left-0 h-px w-px opacity-0"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          onCustomFile(file, file?.name || 'Custom GIF');
        }}
      />
    </div>
  );
}

/**
 * One placed item: draggable, removable, and editable when it is text.
 *
 * `contentEditable` rather than an `<input>` so the chip grows with the words
 * and wraps like the exported version does. Emoji and stickers are not
 * editable - there is nothing in them to edit - so they get the drag and the
 * remove button and nothing else.
 */
function DraggableItem({
  item,
  frameRef,
  relative = false,
  onChange,
  onRemove,
}: {
  item: Item;
  frameRef: React.RefObject<HTMLDivElement | null>;
  /**
   * Size against the frame rather than in pixels.
   *
   * A photo is flattened at its own resolution, so the preview only has to look
   * right on this screen. A video keeps its items as data and hands them to a
   * player on some other screen, so they have to be described as a fraction of
   * the picture - and the preview has to be that same fraction, or the editor
   * is showing something nobody else will see.
   */
  relative?: boolean;
  onChange: (item: Item) => void;
  onRemove: () => void;
}) {
  /*
   * Every finger currently on this item.
   *
   * One is a drag, two are a pinch - which is the whole gesture vocabulary
   * people already have for anything placed on a photo. Keyed by pointer id
   * because a second finger can land and leave without the first moving, and
   * because a stale pointer left in the map is a sticker that resizes itself
   * the next time it is touched.
   */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  /** What the item was when the second finger landed. */
  const pinchStart = useRef<
    { distance: number; angle: number; scale: number; rotation: number } | undefined
  >(undefined);
  /** The same baseline, for the corner handle: one finger instead of two. */
  const sizing = useRef<
    | {
        distance: number;
        angle: number;
        scale: number;
        rotation: number;
        centre: { x: number; y: number };
      }
    | undefined
  >(undefined);

  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return undefined;
    return {
      distance: Math.hypot(b.x - a.x, b.y - a.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
    };
  };

  return (
    <div
      style={{
        left: `${item.x * 100}%`,
        top: `${item.y * 100}%`,
        // The translate keeps the item centred on its point; the rest is the
        // gesture. Order matters: rotate then scale, around that same centre.
        transform: `translate(-50%, -50%) rotate(${item.rotation}rad) scale(${item.scale})`,
      }}
      className="absolute touch-none"
      onPointerDown={(event) => {
        // Stops the draw tool from painting a stroke under the label.
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

        const two = spread();
        if (two) {
          pinchStart.current = {
            distance: two.distance,
            angle: two.angle,
            scale: item.scale,
            rotation: item.rotation,
          };
        }
      }}
      onPointerMove={(event) => {
        if (!pointers.current.has(event.pointerId)) return;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

        const rect = frameRef.current?.getBoundingClientRect();
        if (!rect) return;

        const two = spread();
        if (two && pinchStart.current) {
          const start = pinchStart.current;
          /*
           * Bounded on both sides. A pinch that runs away leaves a sticker
           * bigger than the picture with no way back, and one that collapses
           * leaves nothing to grab - the floor is what makes the gesture
           * reversible.
           */
          const scale = Math.min(
            6,
            Math.max(0.2, (start.scale * two.distance) / (start.distance || 1)),
          );
          onChange({
            ...item,
            scale,
            rotation: start.rotation + (two.angle - start.angle),
            // The midpoint drags too, so a two-finger move is still a move.
            x: Math.min(1, Math.max(0, (two.cx - rect.left) / rect.width)),
            y: Math.min(1, Math.max(0, (two.cy - rect.top) / rect.height)),
          });
          return;
        }

        onChange({
          ...item,
          x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
          y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
        });
      }}
      onPointerUp={(event) => {
        pointers.current.delete(event.pointerId);
        // Lifting one of two ends the pinch; the finger left behind must not
        // resume it from a stale baseline.
        if (pointers.current.size < 2) pinchStart.current = undefined;
      }}
      onPointerCancel={(event) => {
        pointers.current.delete(event.pointerId);
        if (pointers.current.size < 2) pinchStart.current = undefined;
      }}
    >
      <div className="flex items-center gap-1.5">
        {item.kind === 'text' && (
          <span
            role="textbox"
            tabIndex={0}
            contentEditable
            suppressContentEditableWarning
            style={{
              color: item.colour,
              ...(relative ? { fontSize: OVERLAY_SIZE.text } : {}),
            }}
            onBlur={(event) => onChange({ ...item, value: event.currentTarget.textContent ?? '' })}
            className={cn(
              'focus-ring max-w-[70vw] outline-none',
              relative
                ? 'rounded-[0.36em] bg-black/40 px-[0.42em] py-[0.3em] leading-tight font-semibold'
                : 'rounded-lg bg-black/40 px-3 py-1.5 text-h2',
            )}
          >
            {item.value}
          </span>
        )}

        {item.kind === 'emoji' && (
          <span
            style={relative ? { fontSize: OVERLAY_SIZE.emoji } : undefined}
            className={cn('leading-none select-none', !relative && 'text-[3rem]')}
            aria-label={item.value}
          >
            {item.value}
          </span>
        )}

        {item.kind === 'sticker' && item.url && (
          <img
            src={item.url}
            alt={item.value}
            draggable={false}
            style={relative ? { height: OVERLAY_SIZE.sticker } : undefined}
            className={cn(
              'object-contain select-none',
              relative ? 'w-auto max-w-none' : 'size-24',
            )}
          />
        )}

        {/*
          The controls do not grow with the thing they control.

          They live inside the item's own transform, so a sticker pinched to
          four times its size took its little × with it - a black disc a third
          of the picture wide, sitting on the story. Undoing the item's scale
          here keeps both at the size a thumb expects, whatever the item does.
        */}
        <button
          type="button"
          aria-label={`Remove ${item.kind === 'text' ? 'text' : item.value}`}
          onClick={onRemove}
          style={{ transform: `scale(${1 / item.scale})` }}
          className="focus-ring grid size-6 shrink-0 place-items-center rounded-full bg-black/50 text-white"
        >
          <CloseIcon size={13} />
        </button>

        {/*
          A corner to pull, because a pinch is not always available.

          Two fingers scale anything here, but on a label the first finger lands
          on editable text and the browser takes it for a caret - so typing was
          reachable and resizing was not, which is exactly backwards for the one
          item people most want bigger. Dragging this handle sets the size from
          the distance to the item's centre, and the turn from the angle, so one
          finger or a mouse does what two fingers do.
        */}
        <span
          role="slider"
          tabIndex={0}
          aria-label="Resize"
          aria-valuenow={Math.round(item.scale * 100)}
          aria-valuemin={20}
          aria-valuemax={600}
          onKeyDown={(event) => {
            const step = event.key === 'ArrowUp' ? 0.1 : event.key === 'ArrowDown' ? -0.1 : 0;
            if (!step) return;
            event.preventDefault();
            onChange({ ...item, scale: Math.min(6, Math.max(0.2, item.scale + step)) });
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            const rect = frameRef.current?.getBoundingClientRect();
            if (!rect) return;
            const centre = {
              x: rect.left + item.x * rect.width,
              y: rect.top + item.y * rect.height,
            };
            sizing.current = {
              distance: Math.hypot(event.clientX - centre.x, event.clientY - centre.y) || 1,
              angle: Math.atan2(event.clientY - centre.y, event.clientX - centre.x),
              scale: item.scale,
              rotation: item.rotation,
              centre,
            };
          }}
          onPointerMove={(event) => {
            const start = sizing.current;
            if (!start) return;
            const distance = Math.hypot(
              event.clientX - start.centre.x,
              event.clientY - start.centre.y,
            );
            const angle = Math.atan2(
              event.clientY - start.centre.y,
              event.clientX - start.centre.x,
            );
            onChange({
              ...item,
              scale: Math.min(6, Math.max(0.2, (start.scale * distance) / start.distance)),
              rotation: start.rotation + (angle - start.angle),
            });
          }}
          onPointerUp={() => {
            sizing.current = undefined;
          }}
          onPointerCancel={() => {
            sizing.current = undefined;
          }}
          style={{ transform: `scale(${1 / item.scale})` }}
          className={cn(
            'focus-ring grid size-6 shrink-0 cursor-nwse-resize touch-none place-items-center',
            'rounded-full bg-black/50 text-white',
          )}
        >
          <ResizeGlyph />
        </span>
      </div>
    </div>
  );
}
