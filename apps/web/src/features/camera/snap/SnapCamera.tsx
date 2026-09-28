import { cn } from '@pingo/ui';
import {
  CircleOff, Grid3x3, ImagePlus, Moon, Music2, PictureInPicture2, Plus, ScanLine, Search, Sparkles, SwitchCamera, Timer, X, Zap, ZapOff,
  Rows2, Columns2,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { ClipSheet, MusicSheet, Panel, type Song } from '../../music/sheets.js';
import { CAMERA_KIT_GROUP, CAMERA_KIT_TOKEN } from './camera-kit.js';

/**
 * The camera.
 *
 * Snap's Camera Kit renders the live picture with an AR Lens on it; PINGO's own
 * looks ride on top as a filter. The looks scroll through a slot above the
 * dock, the one in the slot is what the camera sees, and the ones used most
 * come first. Tap the shutter - the sweep ring, as on every story - to take a
 * photo, hold to record, with the chosen part of a song recorded into the clip.
 * The tools sit in one bar at the top; the dock at the bottom has the gallery,
 * the shutter and flip, like the app's own dock.
 *
 * If Camera Kit cannot start (no token, an old browser, no WebGL) the camera
 * still works: the plain feed, and the looks.
 */

export interface SnapShot { kind: 'photo' | 'video'; blob: Blob; song?: Song }

interface Lens { key: string; name: string; css: string; icon?: string; ar?: boolean; ck?: unknown }
const LOOKS: Lens[] = [
  { key: 'look:smooth', name: 'Smooth', css: 'contrast(.95) brightness(1.06) saturate(1.05) blur(.4px)' },
  { key: 'look:cinematic', name: 'Cinematic', css: 'contrast(1.18) saturate(.85) sepia(.12) hue-rotate(-8deg)' },
  { key: 'look:dreamy', name: 'Dreamy', css: 'brightness(1.1) saturate(1.2) contrast(.9) blur(.6px)' },
  { key: 'look:warm', name: 'Warm', css: 'sepia(.25) saturate(1.3) hue-rotate(-12deg)' },
  { key: 'look:cool', name: 'Cool', css: 'saturate(1.1) hue-rotate(12deg) brightness(1.03)' },
  { key: 'look:mono', name: 'B&W', css: 'grayscale(1) contrast(1.15)' },
  { key: 'look:bloom', name: 'Bloom', css: 'brightness(1.12) saturate(1.25) contrast(1.05)' },
  { key: 'look:sepia', name: 'Sepia', css: 'sepia(.8)' },
  { key: 'look:fade', name: 'Fade', css: 'contrast(.82) brightness(1.08) saturate(.8)' },
];
const NONE: Lens = { key: 'none', name: 'None', css: '' };
const TIMERS = [0, 3, 10] as const;
/** The longest one hold records, and the length of the ring around the shutter. */
const REC_MAX_MS = 15_000;
const NIGHT = 'brightness(1.35) contrast(1.05)';

// What this person uses most comes first, as on Snapchat. A use is a snap taken
// through the lens, or two and a half seconds spent looking through it.
const USE_KEY = 'pingo.lensUse';
const readUse = (): Record<string, { n: number; t: number }> => { try { return JSON.parse(localStorage.getItem(USE_KEY) ?? '{}') as Record<string, { n: number; t: number }>; } catch { return {}; } };
const noteUse = (l: Lens) => {
  if (l.key === 'none') return;
  const u = readUse(); const e = (u[l.key] ??= { n: 0, t: 0 }); e.n += 1; e.t = Date.now();
  try { localStorage.setItem(USE_KEY, JSON.stringify(u)); } catch { /* private mode: order just resets */ }
};
/*
 * Filters first, then AR lenses - Snapchat's order - each by how much this
 * person uses them. A filter is what most shots want; a lens is a choice.
 */
const ranked = (list: Lens[]) => {
  const u = readUse(); const sc = (l: Lens) => u[l.key] ?? { n: 0, t: 0 };
  const order = (group: Lens[]) => group.map((l, i) => [l, i] as const).sort(([a, ai], [b, bi]) => sc(b).n - sc(a).n || sc(b).t - sc(a).t || ai - bi).map(([l]) => l);
  return [NONE, ...order(list.filter((l) => !l.ar)), ...order(list.filter((l) => l.ar))];
};

type CK = typeof import('@snap/camera-kit');

export function SnapCamera({ onShot, onGallery, onClose, preferred = 'user', song: keptSong, onSong }: {
  onShot: (shot: SnapShot) => void;
  onGallery: (file: File) => void;
  onClose: () => void;
  preferred?: 'user' | 'environment';
  /**
   * The chosen song, held by the screen. The camera unmounts while a shot is
   * being edited, and a song kept only in here was gone when it came back -
   * Snapchat keeps it from one snap to the next.
   */
  song?: Song;
  onSong?: (song: Song | undefined) => void;
}) {
  const view = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const ckCanvas = useRef<HTMLCanvasElement | null>(null);
  const stream = useRef<MediaStream | undefined>(undefined);
  const kit = useRef<{ mod: CK; ck: Awaited<ReturnType<CK['bootstrapCameraKit']>>; session: Awaited<ReturnType<Awaited<ReturnType<CK['bootstrapCameraKit']>>['createSession']>> } | undefined>(undefined);
  const car = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [facing, setFacing] = useState<'user' | 'environment'>(preferred);
  /** For Camera Kit, which arrives later and must pick up whichever way the camera faces by then. */
  const facingNow = useRef(preferred);
  facingNow.current = facing;
  const [lenses, setLenses] = useState<Lens[]>(() => ranked(LOOKS));
  const [current, setCurrent] = useState(0);
  const [kitOn, setKitOn] = useState(false);
  const [noCamera, setNoCamera] = useState(false);
  /** The first frame is on its way. A black card with nothing on it for two seconds read as a broken camera. */
  const [started, setStarted] = useState(false);
  const [rail, setRail] = useState(false);
  const [torch, setTorch] = useState(false);
  const [timer, setTimer] = useState<(typeof TIMERS)[number]>(0);
  const [count, setCount] = useState<number>();
  const [grid, setGrid] = useState(false);
  const [night, setNight] = useState(false);
  const [zoom, setZoomState] = useState(1);
  const [dual, setDual] = useState<'off' | 'pip' | 'split' | 'side'>('off');
  const [dualOpen, setDualOpen] = useState(false);
  const [tip, setTip] = useState<string>();
  const [recording, setRecording] = useState(false);
  const [sheet, setSheet] = useState<'music' | 'clip' | 'search' | null>(null);
  const [ownSong, setOwnSong] = useState<Song>();
  const song = onSong ? keptSong : ownSong;
  const setSong = onSong ?? setOwnSong;
  const [flash, setFlash] = useState(0);
  const [nameShown, setNameShown] = useState<string>();
  const second = useRef<MediaStream | undefined>(undefined);
  const pipVideo = useRef<HTMLVideoElement>(null);
  const player = useRef<HTMLAudioElement | undefined>(undefined);

  const lens = lenses[current] ?? NONE;
  const look = [lens.css, night ? NIGHT : ''].filter(Boolean).join(' ') || 'none';


  const say = (text: string) => { setTip(text); window.setTimeout(() => setTip((t) => (t === text ? undefined : t)), 1200); };

  // ---- the camera --------------------------------------------------------------
  const openStream = useCallback(async (f: 'user' | 'environment') => {
    stream.current?.getTracks().forEach((t) => t.stop());
    /*
     * 1080p asked for, not 720p. The shot is 1080x1920, and a 1280x720 frame
     * cropped to portrait leaves a strip 405 pixels wide - stretched nearly three
     * times over, which is what made every photo look soft. Phones hand back
     * their 1080p mode for this, in whichever orientation they are held.
     */
    stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: f, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, audio: false });
    return stream.current;
  }, []);

  const setSource = useCallback(async (f: 'user' | 'environment') => {
    const k = kit.current;
    try {
      const s = await openStream(f);
      setNoCamera(false);
      if (k) {
        const source = k.mod.createMediaStreamSource(s, { cameraType: f === 'user' ? 'user' : 'environment', ...(f === 'user' ? { transform: k.mod.Transform2D.MirrorX } : {}) });
        await k.session.setSource(source);
        await source.setRenderSize(720, 1280).catch(() => undefined);
        // The plain picture keeps running underneath - see `surface`.
        if (videoRef.current) { videoRef.current.srcObject = s; void videoRef.current.play().catch(() => undefined); }
        setStarted(true);
      } else if (videoRef.current) {
        const v = videoRef.current;
        v.srcObject = s; void v.play().catch(() => undefined);
        if (v.readyState >= 2) setStarted(true);
        else v.addEventListener('loadeddata', () => setStarted(true), { once: true });
      }
    } catch {
      setNoCamera(true);
    }
  }, [openStream]);

  /*
   * The plain camera first, Camera Kit when it is ready.
   *
   * Nothing used to open until the Camera Kit SDK had downloaded and booted -
   * many seconds on a slow link - so the viewfinder sat black, and a shot taken
   * in that window came out black. Now the phone's camera is on screen at once,
   * through a plain <video>, and Camera Kit takes over the same stream without
   * a flicker once it can.
   */
  useEffect(() => {
    let dead = false;
    (async () => {
      await setSource(preferred);
      // Left before the camera answered: turn it straight back off.
      if (dead) { stream.current?.getTracks().forEach((t) => t.stop()); return; }
      try {
        const mod = await import('@snap/camera-kit');
        const ck = await mod.bootstrapCameraKit({ apiToken: CAMERA_KIT_TOKEN });
        const canvas = document.createElement('canvas');
        const session = await ck.createSession({ liveRenderTarget: canvas });
        if (dead) { void session.destroy(); return; }
        canvas.className = 'absolute inset-0 size-full object-cover';
        // The lenses load on their own: a slow or missing camera must not hold them up.
        const loading = ck.lensRepository.loadLensGroups([CAMERA_KIT_GROUP]);
        const s = stream.current;
        if (s) {
          const f = facingNow.current;
          const source = mod.createMediaStreamSource(s, { cameraType: f === 'user' ? 'user' : 'environment', ...(f === 'user' ? { transform: mod.Transform2D.MirrorX } : {}) });
          await session.setSource(source);
          await source.setRenderSize(720, 1280).catch(() => undefined);
        }
        await session.play('live').catch(() => undefined);
        if (dead) { void session.destroy(); return; }
        // Swapped in only now, fully running, so the picture never drops to black.
        kit.current = { mod, ck, session };
        ckCanvas.current = canvas;
        // Hidden and idle until an AR lens is picked - see the lens effect below.
        canvas.style.opacity = '0';
        void session.pause('live').catch(() => undefined);
        view.current?.prepend(canvas);
        setKitOn(true);
        // Flipped while Camera Kit was loading: its source is a stream that has since stopped.
        if (!s || stream.current !== s) await setSource(facingNow.current);
        const { lenses: found } = await loading;
        if (dead) return;
        setLenses(ranked([...found.map((l) => ({ key: `ck:${l.id}`, name: l.name.trim(), css: '', ar: true, ...(l.iconUrl ? { icon: l.iconUrl } : {}), ck: l })), ...LOOKS]));
      } catch (cause) {
        // The plain camera is already running; it simply stays.
        console.warn('[camera] Camera Kit did not start; plain camera', cause);
        kit.current = undefined;
      }
    })();
    return () => {
      dead = true;
      stream.current?.getTracks().forEach((t) => t.stop());
      second.current?.getTracks().forEach((t) => t.stop());
      player.current?.pause();
      const k = kit.current; kit.current = undefined;
      void k?.session.destroy().catch(() => undefined);
      ckCanvas.current?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The chosen lens: Camera Kit applies an AR one; a look is just a filter.
  const dwell = useRef<number | undefined>(undefined);
  useEffect(() => {
    const k = kit.current;
    if (k) void (lens.ck ? k.session.applyLens(lens.ck as never) : k.session.removeLens()).catch(() => undefined);
    /*
     * Camera Kit only while an AR lens is on. Its canvas is a 720p WebGL
     * re-render of the camera - softer than the camera itself and heavy enough
     * to make the viewfinder lag - so with no lens the phone's own full
     * resolution picture is what shows, and Camera Kit is paused.
     */
    if (k) void (lens.ck ? k.session.play('live') : k.session.pause()).catch(() => undefined);
    if (ckCanvas.current) ckCanvas.current.style.opacity = lens.ck ? '1' : '0';
    window.clearTimeout(dwell.current);
    if (lens.key !== 'none') dwell.current = window.setTimeout(() => noteUse(lens), 2500);
    setNameShown(lens.key === 'none' ? undefined : lens.name + (lens.ar ? ' · Camera Kit' : ''));
    const t = window.setTimeout(() => setNameShown(undefined), 1400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lens.key]);

  const track = () => stream.current?.getVideoTracks()[0];
  const caps = () => { try { return (track()?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean; zoom?: { min: number; max: number }; exposureCompensation?: { min: number; max: number } }; } catch { return {}; } };
  const constrain = (c: Record<string, unknown>) => void track()?.applyConstraints({ advanced: [c] } as MediaTrackConstraints).catch(() => undefined);

  const flip = async () => { const f = facing === 'user' ? 'environment' : 'user'; setFacing(f); setZoomState(1); await setSource(f); if (torch && f === 'environment' && caps().torch) constrain({ torch: true }); };
  const toggleTorch = () => { const on = !torch; setTorch(on); say(on ? 'Flash on' : 'Flash off'); if (facing === 'environment' && caps().torch) constrain({ torch: on }); };
  const setZoom = (z: number) => {
    setZoomState(z);
    const zc = caps().zoom;
    if (zc && z >= zc.min && z <= zc.max) constrain({ zoom: z });
  };
  const toggleNight = () => { const on = !night; setNight(on); say(on ? 'Night mode on' : 'Night mode off'); const ex = caps().exposureCompensation; if (ex) constrain({ exposureCompensation: on ? ex.max : 0 }); };
  const chooseDual = async (d: typeof dual) => {
    setDual(d); setDualOpen(false);
    if (d === 'off') { second.current?.getTracks().forEach((t) => t.stop()); second.current = undefined; return; }
    if (second.current) return;
    try {
      second.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing === 'user' ? 'environment' : 'user' }, audio: false });
      if (pipVideo.current) { pipVideo.current.srcObject = second.current; void pipVideo.current.play().catch(() => undefined); }
    } catch {
      setDual('off'); say("This phone can't run both cameras at once");
    }
  };

  // The software zoom when the lens has none of its own.
  const cssZoom = (() => { const zc = caps().zoom; return zc && zoom >= zc.min && zoom <= zc.max ? 1 : Math.max(1, zoom); })();

  // ---- the shutter ----------------------------------------------------------------
  /*
   * What the shutter reads from: the camera itself, unless an AR lens is on.
   *
   * Camera Kit renders at 720x1280, so every shot taken through its canvas was
   * a 720p picture blown up to 1080p - even with no lens at all, just a colour
   * look that a CSS filter applies equally well to the raw frame. Only an AR
   * lens needs Camera Kit's pixels; everything else is taken at the camera's
   * full resolution from the plain video, which keeps running underneath.
   */
  const surface = (): HTMLCanvasElement | HTMLVideoElement | undefined => {
    const v = videoRef.current;
    if (kit.current && lens.ck) return ckCanvas.current ?? undefined;
    if (v && v.readyState >= 2 && v.videoWidth) return v;
    return (kit.current ? ckCanvas.current : v) ?? undefined;
  };
  const drawFrame = (g: CanvasRenderingContext2D, W: number, H: number) => {
    const src = surface(); if (!src) return;
    const w = (src as HTMLVideoElement).videoWidth || src.width, h = (src as HTMLVideoElement).videoHeight || src.height; if (!w || !h) return;
    const k = Math.max(W / w, H / h) * cssZoom;
    g.save(); g.filter = look;
    g.imageSmoothingQuality = 'high';
    // Camera Kit mirrors the front camera itself; the plain video does not.
    if (src instanceof HTMLVideoElement && facing === 'user') { g.translate(W, 0); g.scale(-1, 1); }
    g.drawImage(src, (W - w * k) / 2, (H - h * k) / 2, w * k, h * k);
    g.restore();
  };

  const snap = async () => {
    if (torch && facing === 'user') { setFlash(2); await new Promise((r) => setTimeout(r, 260)); }
    const c = document.createElement('canvas'); c.width = 1080; c.height = 1920;
    drawFrame(c.getContext('2d')!, c.width, c.height);
    setFlash(1); window.setTimeout(() => setFlash(0), 350);
    noteUse(lens);
    c.toBlob((b) => { if (b) onShot({ kind: 'photo', blob: b, ...(song ? { song } : {}) }); }, 'image/jpeg', 0.92);
  };
  const afterTimer = (fn: () => void) => {
    if (!timer) return fn();
    let left: number = timer; setCount(left);
    const t = window.setInterval(() => { left -= 1; if (left > 0) setCount(left); else { window.clearInterval(t); setCount(undefined); fn(); } }, 1000);
  };

  /*
   * Hold to record, Snapchat's way.
   *
   * The press owns the clip, not the recorder: `pressed` is what the finger is
   * doing, and a recorder that is still waiting on the microphone when the
   * finger lifts is told to stop the moment it starts. It used to look for a
   * recorder that did not exist yet, so a quick hold never stopped - the ring
   * ran, no clip came, and nothing could end it.
   */
  const rec = useRef<{ stop: () => void } | undefined>(undefined);
  const pressed = useRef(false);
  const actx = useRef<{ ctx: AudioContext; dest: MediaStreamAudioDestinationNode } | undefined>(undefined);
  /** The latest drawFrame, so a clip picks up zoom and looks changed mid-recording. */
  const drawNow = useRef(drawFrame);
  drawNow.current = drawFrame;
  const startRec = async () => {
    let wanted = true;
    rec.current = { stop: () => { wanted = false; } };
    setRecording(true);
    const c = document.createElement('canvas'); c.width = 720; c.height = 1280; const g = c.getContext('2d')!;
    drawNow.current(g, 720, 1280);
    const out = c.captureStream(30);
    let mic: MediaStream | undefined;
    if (song) {
      const a = (player.current ??= new Audio()); a.crossOrigin = 'anonymous';
      if (!actx.current) {
        const ctx = new AudioContext(); const dest = ctx.createMediaStreamDestination();
        const node = ctx.createMediaElementSource(a); node.connect(ctx.destination); node.connect(dest);
        actx.current = { ctx, dest };
      }
      void actx.current.ctx.resume();
      out.addTrack(actx.current.dest.stream.getAudioTracks()[0]!);
      if (!a.src.endsWith(song.url)) a.src = song.url;
      a.currentTime = song.start; void a.play().catch(() => undefined);
    } else {
      try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); out.addTrack(mic.getAudioTracks()[0]!); } catch { /* a silent clip */ }
    }
    const type = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    const chunks: Blob[] = [];
    let r: MediaRecorder;
    try {
      r = new MediaRecorder(out, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 6_000_000 });
    } catch {
      out.getTracks().forEach((t) => t.stop()); mic?.getTracks().forEach((t) => t.stop());
      rec.current = undefined; setRecording(false); say("This phone can't record video here");
      return;
    }
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    let live = true;
    const began = Date.now();
    const draw = () => { if (!live) return; drawNow.current(g, 720, 1280); requestAnimationFrame(draw); };
    const limit = window.setTimeout(() => stop(), REC_MAX_MS);
    const stop = () => {
      if (!live) return; live = false; window.clearTimeout(limit); setRecording(false); rec.current = undefined;
      r.onstop = () => {
        out.getTracks().forEach((t) => t.stop());
        mic?.getTracks().forEach((t) => t.stop());
        player.current?.pause();
        const blob = new Blob(chunks, { type: r.mimeType || type || 'video/webm' });
        if (!blob.size) { say('That clip did not record. Try again'); return; }
        noteUse(lens);
        onShot({ kind: 'video', blob, ...(song ? { song } : {}) });
      };
      // A clip gets at least a moment, so a tap-and-release still holds a frame.
      const short = 600 - (Date.now() - began);
      if (short > 0) window.setTimeout(() => r.stop(), short); else r.stop();
    };
    r.start(250); draw();
    rec.current = { stop };
    // Let go while the microphone was still being asked for.
    if (!wanted || !pressed.current) stop();
  };

  const hold = useRef<number | undefined>(undefined);
  /** Where the finger went down, and the zoom then: sliding up from there zooms in. */
  const slide = useRef<{ y: number; z: number } | undefined>(undefined);
  const zoomTop = () => Math.min(8, caps().zoom?.max ?? 4);
  const onShutterDown = (e: React.PointerEvent) => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    pressed.current = true;
    slide.current = { y: e.clientY, z: zoom };
    hold.current = window.setTimeout(() => { hold.current = undefined; if (pressed.current) void startRec(); }, 280);
  };
  const onShutterMove = (e: React.PointerEvent) => {
    const from = slide.current; if (!from || !pressed.current || hold.current) return;
    // A full swipe up the screen is the whole range; back down returns to where it began.
    const reach = Math.max(200, window.innerHeight * 0.55);
    const z = Math.min(zoomTop(), Math.max(1, from.z + ((from.y - e.clientY) / reach) * (zoomTop() - 1)));
    if (Math.abs(z - zoom) > 0.02) setZoom(Math.round(z * 100) / 100);
  };
  const onShutterUp = () => {
    if (!pressed.current) return;
    pressed.current = false; slide.current = undefined;
    if (hold.current) { window.clearTimeout(hold.current); hold.current = undefined; afterTimer(() => void snap()); return; }
    rec.current?.stop();
  };

  // ---- the lens row ------------------------------------------------------------
  const pickAt = useRef<number | undefined>(undefined);
  const frameReq = useRef<number | undefined>(undefined);
  /*
   * Every tile sized by how far it is from the slot, each frame of the scroll -
   * the Snapchat roll. It used to snap between two sizes once scrolling had
   * stopped, which is what read as stuttering. Written straight to the style,
   * outside React, so a scroll never re-renders the camera.
   */
  const shade = useCallback(() => {
    frameReq.current = undefined;
    const el = car.current; if (!el) return;
    const mid = el.scrollLeft + el.clientWidth / 2;
    for (const child of el.children) {
      const b = child as HTMLElement;
      const d = Math.min(1, Math.abs(b.offsetLeft + b.offsetWidth / 2 - mid) / 140);
      b.style.transform = `scale(${1 - d * 0.2})`;
      b.style.opacity = String(1 - d * 0.35);
    }
  }, []);
  useLayoutEffect(() => { shade(); }, [shade, lenses]);
  const onScroll = () => {
    const el = car.current; if (!el) return;
    frameReq.current ??= requestAnimationFrame(shade);
    window.clearTimeout(pickAt.current);
    pickAt.current = window.setTimeout(() => {
      const mid = el.scrollLeft + el.clientWidth / 2;
      let best = 0, d = Infinity;
      [...el.children].forEach((b, j) => { const c = (b as HTMLElement).offsetLeft + (b as HTMLElement).offsetWidth / 2; if (Math.abs(c - mid) < d) { d = Math.abs(c - mid); best = j; } });
      setCurrent(best);
    }, 90);
  };
  const goTo = (i: number) => { (car.current?.children[i] as HTMLElement | undefined)?.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' }); setCurrent(i); };

  const playSong = (s: Song) => {
    const a = (player.current ??= new Audio()); a.crossOrigin = 'anonymous';
    if (!a.src.endsWith(s.url)) a.src = s.url;
    a.currentTime = s.start; void a.play().catch(() => undefined);
    a.ontimeupdate = () => { if (a.currentTime > s.start + 15) a.currentTime = s.start; };
  };

  // Back from a shot with a song still chosen: it carries on playing, as it was.
  useEffect(() => {
    if (song) playSong(song);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-500 bg-black text-white select-none">
      {/* The viewfinder: a card, the same shape as the editor's stage, so taking a
          shot and editing it happen in one frame. */}
      <div ref={view} className="absolute inset-x-0 top-0 bottom-[132px] overflow-hidden rounded-b-[16px] bg-[#111]"
        onDoubleClick={() => void flip()} onClick={() => setDualOpen(false)}>
        {/* Always mounted: with Camera Kit on it is hidden but still the full-resolution source for the shutter. */}
        {/* Mirrored with transform, not the -scale-x utility: LookStyle writes an
            inline `scale` for zoom, which silently undid that flip, so the selfie
            view started the wrong way round and jumped once Camera Kit took over. */}
        <video ref={videoRef} className={cn('absolute inset-0 size-full object-cover', kitOn && !!lens.ck && 'pointer-events-none opacity-0')} style={facing === 'user' ? { transform: 'scaleX(-1)' } : undefined} muted playsInline autoPlay />
        {!started && !noCamera && (
          <div role="status" className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-3 text-[13px] font-medium text-white/65">
            <span aria-hidden className="size-7 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
            Starting camera…
          </div>
        )}
        {noCamera && <p className="absolute inset-x-8 top-1/2 -translate-y-1/2 text-center text-white/75">No camera here. Pick a photo from your gallery instead.</p>}
        {dual !== 'off' && (
          <video ref={pipVideo} muted playsInline autoPlay className={cn('absolute z-[2] object-cover',
            dual === 'pip' && 'top-24 left-4 h-[150px] w-[104px] rounded-[16px] ring-2 ring-white/80',
            dual === 'split' && 'inset-x-0 bottom-0 h-1/2 border-t border-white/60',
            dual === 'side' && 'inset-y-0 right-0 w-1/2 border-l border-white/60')} />
        )}
        {grid && <div className="pointer-events-none absolute inset-0 z-[1] bg-[linear-gradient(90deg,transparent_calc(33.33%-.5px),rgba(255,255,255,.35)_0_calc(33.33%+.5px),transparent_0_calc(66.66%-.5px),rgba(255,255,255,.35)_0_calc(66.66%+.5px),transparent_0),linear-gradient(transparent_calc(33.33%-.5px),rgba(255,255,255,.35)_0_calc(33.33%+.5px),transparent_0_calc(66.66%-.5px),rgba(255,255,255,.35)_0_calc(66.66%+.5px),transparent_0)]" />}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-32 bg-gradient-to-b from-black/35 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-40 bg-gradient-to-t from-black/45 to-transparent" />
      </div>

      {/* top: close on the left, every tool in one bar on the right */}
      <div className="absolute inset-x-3 top-3 z-10 flex items-start justify-between gap-2">
        <button type="button" aria-label="Close camera" onClick={onClose} className="media-glass grid size-10 shrink-0 place-items-center rounded-full"><X size={20} /></button>
        <div className="flex flex-col items-end gap-1.5">
          <div className="media-glass flex items-center gap-0.5 rounded-full p-0.5">
            <Tool label="Flash" on={torch} onClick={toggleTorch}>{torch ? <Zap /> : <ZapOff />}</Tool>
            <Tool label="Timer" on={timer > 0} onClick={() => { const t = TIMERS[(TIMERS.indexOf(timer) + 1) % TIMERS.length]!; setTimer(t); say(t ? `Timer ${t}s` : 'Timer off'); }}>
              <Timer />{timer > 0 && <small className="absolute -top-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-sweep text-[9px] font-bold text-white">{timer}</small>}
            </Tool>
            <Tool label="Music" on={!!song} onClick={() => setSheet('music')}><Music2 /></Tool>
            <Tool label="Dual camera" on={dual !== 'off'} onClick={() => setDualOpen((o) => !o)}><PictureInPicture2 /></Tool>
            <Tool label="More" on={rail} onClick={() => setRail((r) => !r)}><Plus className={cn('transition-transform', rail && 'rotate-45')} /></Tool>
          </div>
          {rail && (
            <div className="media-glass animate-panel-in flex items-center gap-0.5 rounded-full p-0.5">
              <Tool label="Grid" on={grid} onClick={() => setGrid((g) => !g)}><Grid3x3 /></Tool>
              <Tool label="Night mode" on={night} onClick={toggleNight}><Moon /></Tool>
              <Tool label="Scan" onClick={() => say('Scan a PINGO code')}><ScanLine /></Tool>
            </div>
          )}
          {dualOpen && (
            <div className="media-glass animate-panel-in w-[220px] rounded-[16px] p-3">
              <h4 className="text-[14px] font-semibold">Dual camera</h4>
              <p className="mb-2.5 text-[12px] text-white/60">{{ off: 'Off', pip: 'Picture in picture', split: 'Top and bottom', side: 'Side by side' }[dual]}</p>
              <div className="flex gap-1 rounded-full bg-white/10 p-1">
                {([['split', Rows2], ['side', Columns2], ['pip', PictureInPicture2], ['off', X]] as const).map(([k, Icon]) => (
                  <button key={k} type="button" aria-label={k} onClick={() => void chooseDual(k)} className={cn('grid h-8 flex-1 place-items-center rounded-full', dual === k && 'bg-white text-black')}><Icon size={17} /></button>
                ))}
              </div>
            </div>
          )}
          {tip && <div className="media-glass rounded-full px-3 py-1.5 text-[12.5px] font-semibold">{tip}</div>}
        </div>
      </div>
      {song && (
        <button type="button" onClick={() => setSheet('clip')} className="media-glass animate-panel-in absolute top-[62px] left-3 z-10 flex h-8 max-w-[200px] items-center gap-2 rounded-full pr-1 pl-1 text-[12.5px] font-semibold">
          <img src={song.img} alt="" className="size-6 animate-spin rounded-full [animation-duration:4s]" />
          <span className="truncate">{song.name} · {song.artist}</span>
          <span role="button" aria-label="Remove song" onClick={(e) => { e.stopPropagation(); setSong(undefined); player.current?.pause(); }} className="grid size-6 shrink-0 place-items-center rounded-full bg-white/15"><X size={13} /></span>
        </button>
      )}

      {/* over the bottom of the viewfinder: zoom, the look's name, and the looks */}
      <div className={cn('absolute inset-x-0 bottom-[250px] z-10 text-center text-[13px] font-semibold transition-opacity [text-shadow:0_1px_8px_rgba(0,0,0,.6)]', nameShown ? 'opacity-100' : 'opacity-0')}>{nameShown ?? lens.name}</div>
      <button type="button" aria-label="Search lenses" onClick={() => setSheet('search')} className="media-glass absolute right-3 bottom-[214px] z-10 flex h-8 max-w-[120px] items-center gap-1.5 rounded-full pr-3 pl-2.5 text-[12.5px] font-semibold">
        <Sparkles size={15} className="shrink-0" /><span className="truncate">{lens.key === 'none' ? 'Looks' : lens.name}</span>
      </button>
      <div className="media-glass absolute bottom-[214px] left-1/2 z-10 flex -translate-x-1/2 gap-0.5 rounded-full p-0.5">
        {[0.5, 1, 2].map((z) => (
          <button key={z} type="button" onClick={() => setZoom(z)} className={cn('h-7 min-w-7 rounded-full px-1 text-[11.5px] font-bold tabular-nums', zoom === z && 'bg-white text-black')}>{zoom === z ? `${z === 0.5 ? '.5' : z}×` : z === 0.5 ? '.5' : z}</button>
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-[142px] z-10 h-[62px]">
        {/* The slot the looks scroll through. What sits in it is what the camera sees. */}
        <span aria-hidden className="bg-sweep pointer-events-none absolute top-1/2 left-1/2 z-[1] size-[62px] -translate-x-1/2 -translate-y-1/2 rounded-full p-[3px] [mask:linear-gradient(#000_0_0)_content-box_exclude,linear-gradient(#000_0_0)]" />
        <div ref={car} onScroll={onScroll} className="scrollbar-none absolute inset-0 flex snap-x snap-mandatory items-center gap-2.5 overflow-x-auto px-[calc(50%-26px)]">
          {lenses.map((l, i) => (
            <button key={l.key} type="button" onClick={() => goTo(i)} aria-label={l.name} aria-pressed={i === current}
              className="relative grid size-[52px] shrink-0 snap-center place-items-center overflow-hidden rounded-full bg-white/12 ring-1 ring-white/20 will-change-transform">
              <Tile l={l} />
              {l.ar && <span className="bg-sweep absolute right-0.5 bottom-0.5 rounded-full px-1 text-[8px] leading-[12px] font-extrabold">AR</span>}
            </button>
          ))}
        </div>
      </div>

      {/* the dock: gallery, the shutter, flip - the camera's own version of the app's dock */}
      <input ref={fileRef} type="file" accept="image/*,video/*" className="pointer-events-none fixed top-0 left-0 h-px w-px opacity-0" tabIndex={-1} aria-hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onGallery(f); }} />
      <div className="absolute inset-x-0 bottom-0 z-10 flex h-[132px] items-center justify-between px-7 pb-[env(safe-area-inset-bottom)]">
        <div className="flex w-[92px]">
          <button type="button" aria-label="Gallery" onClick={() => fileRef.current?.click()} className="grid size-11 place-items-center rounded-[12px] bg-white/10 ring-1 ring-white/15"><ImagePlus size={20} /></button>
        </div>
        <button type="button" aria-label={recording ? 'Recording' : 'Take a snap, hold to record'}
          onPointerDown={onShutterDown} onPointerMove={onShutterMove} onPointerUp={onShutterUp} onPointerCancel={onShutterUp} onLostPointerCapture={onShutterUp} onContextMenu={(e) => e.preventDefault()}
          style={{ touchAction: 'none', WebkitTouchCallout: 'none' }}
          className={cn('bg-sweep-ring relative size-[80px] shrink-0 rounded-full p-[4px] shadow-[0_6px_24px_rgba(139,93,255,.35)] transition-transform duration-200', recording && 'scale-[1.14]')}>
          <span className={cn('grid size-full place-items-center overflow-hidden rounded-full border-[3px] border-black bg-white transition-all duration-200', recording && 'scale-[.62] rounded-[14px] border-0 bg-danger')}>
            {!recording && lens.key !== 'none' && <Tile l={lens} big />}
          </span>
          {recording && (
            <svg viewBox="0 0 100 100" className="absolute -inset-[8px] size-[96px] -rotate-90">
              <defs><linearGradient id="rec-sweep" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8b5dff" /><stop offset=".5" stopColor="#e0559b" /><stop offset="1" stopColor="#ffcc4d" /></linearGradient></defs>
              <circle cx="50" cy="50" r="46" fill="none" stroke="url(#rec-sweep)" strokeWidth="5" strokeLinecap="round" strokeDasharray="289" strokeDashoffset="289" style={{ animation: `snap-rec ${REC_MAX_MS}ms linear forwards` }} />
            </svg>
          )}
        </button>
        <div className="flex w-[92px] justify-end">
          <button type="button" aria-label="Flip" onClick={() => void flip()} className="grid size-11 place-items-center rounded-full bg-white/10 ring-1 ring-white/15"><SwitchCamera size={20} /></button>
        </div>
      </div>
      <style>{'@keyframes snap-rec { to { stroke-dashoffset: 0; } }'}</style>

      {count !== undefined && <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center text-[120px] font-bold [text-shadow:0_8px_30px_rgba(0,0,0,.5)]">{count}</div>}
      <div className={cn('pointer-events-none absolute inset-0 z-40 bg-white transition-opacity', flash ? 'opacity-100' : 'opacity-0', flash === 1 && 'duration-300')} />

      {sheet === 'music' && <MusicSheet close={() => setSheet(null)} onPreview={(s) => { if (s) playSong(s); else player.current?.pause(); }} chooseSong={(s) => { setSong(s); playSong(s); setSheet('clip'); }} />}
      {sheet === 'clip' && <ClipSheet close={() => setSheet(null)} {...(song ? { song } : {})} setSong={(s) => { setSong(s); playSong(s); }} />}
      {sheet === 'search' && <LensSearch lenses={lenses} current={current} onPick={(i) => { setSheet(null); goTo(i); }} onClose={() => setSheet(null)} />}
      {/* the style that lets the looks reach the Camera Kit canvas */}
      <LookStyle host={view} look={look} zoom={cssZoom} />
    </div>
  );
}

/** A tool in the top bar. Lit (white) while it is on. */
function Tool({ label, on, onClick, children }: { label: string; on?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} aria-pressed={on} onClick={onClick}
      className={cn('relative grid size-9 place-items-center rounded-full transition-colors active:scale-90 [&>svg]:size-[19px]', on && 'bg-white text-black')}>{children}</button>
  );
}

/**
 * A look's face, round like Snapchat's.
 *
 * A lens shows its Camera Kit icon. A filter shows a photograph through that
 * very filter - a face for Smooth, a city for Cinematic, snow for Cool - so a
 * tile is a picture of what the filter does, the way Snapchat's are, rather
 * than a name or a symbol. The photos are small and ship with the app
 * (public/camera/looks); the filter is the same CSS the camera uses, so the
 * tile cannot promise a look the camera does not give.
 */
function Tile({ l, big }: { l: Lens; big?: boolean }) {
  if (l.icon) return <img src={l.icon} alt="" className="size-full object-cover" draggable={false} />;
  if (l.key === 'none') return <CircleOff size={big ? 22 : 20} className={big ? 'text-black/70' : 'text-white/85'} />;
  const photo = l.key.startsWith('look:') ? `/camera/looks/${l.key.slice(5)}.webp` : undefined;
  if (!photo) return <span className="text-[15px] font-semibold text-white/90">{l.name.slice(0, 2)}</span>;
  return <img src={photo} alt="" className="size-full object-cover" style={{ filter: l.css }} draggable={false} decoding="async" />;
}

/** Applies the look and the software zoom to whatever is rendering the feed. */
function LookStyle({ host, look, zoom }: { host: React.RefObject<HTMLDivElement | null>; look: string; zoom: number }) {
  useEffect(() => {
    const el = host.current; if (!el) return;
    el.querySelectorAll<HTMLElement>(':scope > canvas, :scope > video').forEach((m) => { m.style.filter = look; m.style.scale = String(zoom); m.style.transition = 'filter .35s'; });
  });
  return null;
}

function LensSearch({ lenses, current, onPick, onClose }: { lenses: Lens[]; current: number; onPick: (i: number) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | 'used' | 'ar' | 'look'>('all');
  const used = useMemo(() => readUse(), []);
  const hits = lenses.map((l, i) => [l, i] as const).filter(([l, i]) => i > 0
    && (kind === 'all' || (kind === 'used' ? !!used[l.key] : kind === 'ar' ? !!l.ar : !l.ar))
    && (!q.trim() || l.name.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <Panel onClose={onClose}>
      <label className="mx-3.5 mb-2.5 flex h-10 shrink-0 items-center gap-2 rounded-[12px] bg-media-field px-3 text-white/55">
        <Search size={16} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search lenses and filters" className="min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none" />
      </label>
      <div className="flex shrink-0 gap-2 px-3.5 pb-2.5">
        {([['all', 'All'], ['used', 'Most used'], ['ar', 'AR lenses'], ['look', 'Filters']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={cn('rounded-full px-3 py-1.5 text-[13px] font-semibold', kind === k ? 'bg-white text-black' : 'bg-white/8')}>{l}</button>
        ))}
      </div>
      <div className="grid grid-cols-4 content-start gap-x-2 gap-y-3.5 overflow-y-auto px-3.5 pb-4">
        {hits.map(([l, i]) => (
          <button key={l.key} type="button" onClick={() => onPick(i)} className="flex min-w-0 flex-col items-center gap-1.5 text-[11.5px] font-semibold text-white/85">
            <span className={cn('relative grid size-[62px] place-items-center overflow-hidden rounded-[16px] bg-white/10', i === current ? 'ring-[2.5px] ring-white' : 'ring-1 ring-white/15')}>
              {l.icon ? <img src={l.icon} alt="" className="size-full object-cover" /> : <span className="text-[18px] font-semibold text-white/90">{l.name.slice(0, 2)}</span>}
              {l.ar && <span className="bg-sweep absolute right-0.5 bottom-0.5 rounded-full px-1 text-[8px] leading-[12px] font-extrabold">AR</span>}
            </span>
            <span className="w-full truncate text-center">{l.name}</span>
          </button>
        ))}
        {hits.length === 0 && <p className="col-span-4 py-6 text-center text-white/50">No lens called "{q}"</p>}
      </div>
    </Panel>
  );
}
