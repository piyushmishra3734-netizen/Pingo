import { cn } from '@pingo/ui';
import {
  CircleOff, Grid3x3, ImagePlus, Moon, Music2, PictureInPicture2, Plus, ScanLine, Search, Sparkles, SwitchCamera, Timer, X, Zap, ZapOff,
  Rows2, Columns2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ClipSheet, MusicSheet, Panel, type Song } from '../../music/sheets.js';
import { CAMERA_KIT_GROUP, CAMERA_KIT_TOKEN } from './camera-kit.js';

/**
 * The camera, Snapchat's way.
 *
 * Snap's Camera Kit renders the live picture with an AR Lens on it; PINGO's own
 * looks ride on top as a filter. The Lenses sit in a row around the shutter,
 * the one chosen shows inside it, and the ones used most come first. Tap to
 * take a photo, hold to record - with the chosen part of a song recorded into
 * the clip.
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
const ranked = (list: Lens[]) => {
  const u = readUse(); const sc = (l: Lens) => u[l.key] ?? { n: 0, t: 0 };
  return [NONE, ...list.map((l, i) => [l, i] as const).sort(([a, ai], [b, bi]) => sc(b).n - sc(a).n || sc(b).t - sc(a).t || ai - bi).map(([l]) => l)];
};

type CK = typeof import('@snap/camera-kit');

export function SnapCamera({ onShot, onGallery, onClose, preferred = 'user' }: {
  onShot: (shot: SnapShot) => void;
  onGallery: (file: File) => void;
  onClose: () => void;
  preferred?: 'user' | 'environment';
}) {
  const view = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const ckCanvas = useRef<HTMLCanvasElement | null>(null);
  const stream = useRef<MediaStream | undefined>(undefined);
  const kit = useRef<{ mod: CK; ck: Awaited<ReturnType<CK['bootstrapCameraKit']>>; session: Awaited<ReturnType<Awaited<ReturnType<CK['bootstrapCameraKit']>>['createSession']>> } | undefined>(undefined);
  const car = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [facing, setFacing] = useState<'user' | 'environment'>(preferred);
  const [lenses, setLenses] = useState<Lens[]>(() => ranked(LOOKS));
  const [current, setCurrent] = useState(0);
  const [kitOn, setKitOn] = useState(false);
  const [noCamera, setNoCamera] = useState(false);
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
  const [song, setSong] = useState<Song>();
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
    stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: f, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
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
      } else if (videoRef.current) {
        videoRef.current.srcObject = s; void videoRef.current.play().catch(() => undefined);
      }
    } catch {
      setNoCamera(true);
    }
  }, [openStream]);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const mod = await import('@snap/camera-kit');
        const ck = await mod.bootstrapCameraKit({ apiToken: CAMERA_KIT_TOKEN });
        const canvas = document.createElement('canvas');
        const session = await ck.createSession({ liveRenderTarget: canvas });
        if (dead) { void session.destroy(); return; }
        kit.current = { mod, ck, session };
        ckCanvas.current = canvas;
        canvas.className = 'absolute inset-0 size-full object-cover';
        view.current?.prepend(canvas);
        // The lenses load on their own: a slow or missing camera must not hold them up.
        const loading = ck.lensRepository.loadLensGroups([CAMERA_KIT_GROUP]);
        setKitOn(true);
        await setSource(preferred);
        void session.play('live').catch(() => undefined);
        const { lenses: found } = await loading;
        if (dead) return;
        setLenses(ranked([...found.map((l) => ({ key: `ck:${l.id}`, name: l.name.trim(), css: '', ar: true, ...(l.iconUrl ? { icon: l.iconUrl } : {}), ck: l })), ...LOOKS]));
      } catch (cause) {
        console.warn('[camera] Camera Kit did not start; plain camera', cause);
        kit.current = undefined;
        if (!dead) await setSource(preferred);
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
  const surface = (): HTMLCanvasElement | HTMLVideoElement | undefined => (kit.current ? ckCanvas.current ?? undefined : videoRef.current ?? undefined);
  const drawFrame = (g: CanvasRenderingContext2D, W: number, H: number) => {
    const src = surface(); if (!src) return;
    const w = (src as HTMLVideoElement).videoWidth || src.width, h = (src as HTMLVideoElement).videoHeight || src.height; if (!w || !h) return;
    const k = Math.max(W / w, H / h) * cssZoom;
    g.save(); g.filter = look;
    if (!kit.current && facing === 'user') { g.translate(W, 0); g.scale(-1, 1); }
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

  const rec = useRef<{ r: MediaRecorder; stop: () => void } | undefined>(undefined);
  const actx = useRef<{ ctx: AudioContext; dest: MediaStreamAudioDestinationNode } | undefined>(undefined);
  const startRec = async () => {
    const c = document.createElement('canvas'); c.width = 720; c.height = 1280; const g = c.getContext('2d')!;
    const out = c.captureStream(30);
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
      try { const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } }); out.addTrack(mic.getAudioTracks()[0]!); } catch { /* a silent clip */ }
    }
    const type = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    const chunks: Blob[] = [];
    const r = new MediaRecorder(out, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 5_000_000 });
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    let live = true;
    const draw = () => { if (!live) return; drawFrame(g, 720, 1280); requestAnimationFrame(draw); };
    const limit = window.setTimeout(() => stop(), 10_000);
    const stop = () => {
      if (!live) return; live = false; window.clearTimeout(limit); setRecording(false);
      r.onstop = () => {
        out.getTracks().forEach((t) => t.stop());
        player.current?.pause();
        noteUse(lens);
        onShot({ kind: 'video', blob: new Blob(chunks, { type: r.mimeType || 'video/webm' }), ...(song ? { song } : {}) });
      };
      r.stop();
    };
    rec.current = { r, stop };
    r.start(250); setRecording(true); draw();
  };

  const hold = useRef<number | undefined>(undefined);
  const onShutterDown = (e: React.PointerEvent) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic */ } hold.current = window.setTimeout(() => { hold.current = undefined; void startRec(); }, 300); };
  const onShutterUp = () => {
    if (hold.current) { window.clearTimeout(hold.current); hold.current = undefined; afterTimer(() => void snap()); return; }
    rec.current?.stop(); rec.current = undefined;
  };

  // ---- the lens row ------------------------------------------------------------
  const pickAt = useRef<number | undefined>(undefined);
  const onScroll = () => {
    const el = car.current; if (!el) return;
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

  const glass = 'bg-black/28 backdrop-blur-md ring-1 ring-white/15';
  const RailBtn = ({ label, on, onClick, children }: { label: string; on?: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" aria-label={label} onClick={onClick} className={cn('relative grid size-10 place-items-center rounded-full text-[20px] active:scale-90 [&>svg]:size-5', on && 'text-[#ff7eb6]')}>{children}</button>
  );

  return (
    <div className="fixed inset-0 z-500 flex flex-col bg-black text-white select-none">
      <div ref={view} className="relative min-h-0 flex-1 overflow-hidden rounded-b-[28px] bg-[#111]"
        onDoubleClick={() => void flip()} onClick={() => setDualOpen(false)}>
        {!kitOn && <video ref={videoRef} className={cn('absolute inset-0 size-full object-cover', facing === 'user' && '-scale-x-100')} muted playsInline autoPlay />}
        {noCamera && <p className="absolute inset-x-8 top-1/2 -translate-y-1/2 text-center text-white/75">No camera here. Pick a photo from your gallery instead.</p>}
        {dual !== 'off' && (
          <video ref={pipVideo} muted playsInline autoPlay className={cn('absolute z-[2] object-cover',
            dual === 'pip' && 'top-24 left-4 h-[150px] w-[104px] rounded-[18px] ring-2 ring-white/80',
            dual === 'split' && 'inset-x-0 bottom-0 h-1/2 border-t border-white/60',
            dual === 'side' && 'inset-y-0 right-0 w-1/2 border-l border-white/60')} />
        )}
        {grid && <div className="pointer-events-none absolute inset-0 z-[1] bg-[linear-gradient(90deg,transparent_calc(33.33%-.5px),rgba(255,255,255,.35)_0_calc(33.33%+.5px),transparent_0_calc(66.66%-.5px),rgba(255,255,255,.35)_0_calc(66.66%+.5px),transparent_0),linear-gradient(transparent_calc(33.33%-.5px),rgba(255,255,255,.35)_0_calc(33.33%+.5px),transparent_0_calc(66.66%-.5px),rgba(255,255,255,.35)_0_calc(66.66%+.5px),transparent_0)]" />}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-36 bg-gradient-to-b from-black/35 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-52 bg-gradient-to-t from-black/40 to-transparent" />
      </div>

      {/* top: close, song, and the rail */}
      <div className="absolute top-3.5 left-3.5 z-10 flex gap-2">
        <button type="button" aria-label="Close camera" onClick={onClose} className={cn('grid size-[42px] place-items-center rounded-full', glass)}><X size={20} /></button>
        <button type="button" aria-label="Search lenses" onClick={() => setSheet('search')} className={cn('grid size-[42px] place-items-center rounded-full', glass)}><Search size={20} /></button>
      </div>
      {song && (
        <button type="button" onClick={() => setSheet('clip')} className={cn('animate-panel-in absolute top-[18px] left-1/2 z-10 flex h-[34px] max-w-[190px] -translate-x-1/2 items-center gap-2 rounded-full pr-1.5 pl-1 text-[13px] font-semibold', glass)}>
          <img src={song.img} alt="" className="size-6 animate-spin rounded-full [animation-duration:4s]" />
          <span className="truncate">{song.name} · {song.artist}</span>
          <span role="button" aria-label="Remove song" onClick={(e) => { e.stopPropagation(); setSong(undefined); player.current?.pause(); }} className="grid size-[22px] shrink-0 place-items-center rounded-full bg-white/18"><X size={13} /></span>
        </button>
      )}
      <div className={cn('absolute top-3.5 right-3.5 z-10 flex flex-col items-center gap-0.5 rounded-[26px] p-1', glass)}>
        <RailBtn label="Flip" onClick={() => void flip()}><SwitchCamera /></RailBtn>
        <RailBtn label="Flash" on={torch} onClick={toggleTorch}>{torch ? <Zap /> : <ZapOff />}</RailBtn>
        <RailBtn label="Dual camera" on={dual !== 'off'} onClick={() => setDualOpen((o) => !o)}><PictureInPicture2 /></RailBtn>
        <RailBtn label="Music" on={!!song} onClick={() => setSheet('music')}><Music2 /></RailBtn>
        <RailBtn label="Timer" on={timer > 0} onClick={() => { const t = TIMERS[(TIMERS.indexOf(timer) + 1) % TIMERS.length]!; setTimer(t); say(t ? `Timer ${t}s` : 'Timer off'); }}>
          <Timer />{timer > 0 && <small className="absolute right-1 bottom-1 text-[9px] font-bold">{timer}</small>}
        </RailBtn>
        {rail && (
          <>
            <RailBtn label="Grid" on={grid} onClick={() => setGrid((g) => !g)}><Grid3x3 /></RailBtn>
            <RailBtn label="Night mode" on={night} onClick={toggleNight}><Moon /></RailBtn>
            <RailBtn label="Scan" onClick={() => say('Scan a PINGO code')}><ScanLine /></RailBtn>
          </>
        )}
        <RailBtn label="More" onClick={() => setRail((r) => !r)}><Plus className={cn('transition-transform', rail && 'rotate-45')} /></RailBtn>
      </div>
      {tip && <div className={cn('absolute top-20 right-[66px] z-10 rounded-xl px-3 py-1.5 text-[12.5px] font-semibold', glass)}>{tip}</div>}
      {dualOpen && (
        <div className={cn('animate-panel-in absolute top-28 right-[66px] z-20 w-[212px] rounded-[20px] p-3', glass)}>
          <h4 className="text-[15px] font-bold">Dual Camera</h4>
          <p className="mb-2.5 text-[12px] font-bold text-[#ff7eb6]">{{ off: 'Off', pip: 'Picture in picture', split: 'Top and bottom', side: 'Side by side' }[dual]}</p>
          <div className="flex gap-1 rounded-full bg-white/10 p-1">
            {([['split', Rows2], ['side', Columns2], ['pip', PictureInPicture2], ['off', X]] as const).map(([k, Icon]) => (
              <button key={k} type="button" aria-label={k} onClick={() => void chooseDual(k)} className={cn('grid h-9 flex-1 place-items-center rounded-full', dual === k && 'bg-[#e0559b]')}><Icon size={18} /></button>
            ))}
          </div>
        </div>
      )}

      {/* zoom, the lens name, and the row round the shutter */}
      <div className="absolute inset-x-0 bottom-[258px] z-10 text-center text-[14px] font-bold [text-shadow:0_1px_8px_rgba(0,0,0,.6)]">{nameShown}</div>
      <div className={cn('absolute bottom-[212px] left-1/2 z-10 flex -translate-x-1/2 gap-1 rounded-full p-1', glass)}>
        {[0.5, 1, 2].map((z) => (
          <button key={z} type="button" onClick={() => setZoom(z)} className={cn('size-8 rounded-full text-[11.5px] font-bold', zoom === z && 'bg-white/20 text-[12.5px] text-[#ff7eb6]')}>{zoom === z ? `${z === 0.5 ? '.5' : z}×` : z === 0.5 ? '.5' : z}</button>
        ))}
      </div>
      <button type="button" aria-label="Gallery" onClick={() => fileRef.current?.click()} className={cn('absolute bottom-[212px] left-3.5 z-10 grid size-[42px] place-items-center rounded-full', glass)}><ImagePlus size={20} /></button>
      <button type="button" aria-label="Explore lenses" onClick={() => setSheet('search')} className={cn('absolute right-3.5 bottom-[212px] z-10 grid size-[42px] place-items-center rounded-full', glass)}><Sparkles size={20} /></button>
      <input ref={fileRef} type="file" accept="image/*,video/*" className="pointer-events-none fixed top-0 left-0 h-px w-px opacity-0" tabIndex={-1} aria-hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onGallery(f); }} />

      <div className="absolute inset-x-0 bottom-[110px] z-10 h-24">
        <div ref={car} onScroll={onScroll} className="scrollbar-none absolute inset-0 flex snap-x snap-mandatory items-center gap-3.5 overflow-x-auto px-[calc(50%-29px)]">
          {lenses.map((l, i) => (
            <button key={l.key} type="button" onClick={() => goTo(i)} aria-label={l.name}
              className={cn('relative size-[58px] shrink-0 snap-center overflow-hidden rounded-full ring-2 ring-white/50 transition-opacity', i === current && 'opacity-0', !l.icon && 'grid place-items-center bg-white/14')}>
              {l.icon ? <img src={l.icon} alt="" className="size-full object-cover" />
                : l.key === 'none' ? <CircleOff size={22} />
                  : <span className="size-full bg-[url(/pingo-icon.png)] bg-cover" style={{ filter: l.css }} />}
              {l.ar && <span className="absolute bottom-[3px] left-1/2 -translate-x-1/2 rounded-md bg-[#e0559b] px-1 text-[8.5px] font-extrabold">AR</span>}
            </button>
          ))}
        </div>
        <button type="button" aria-label={recording ? 'Recording' : 'Take a snap, hold to record'}
          onPointerDown={onShutterDown} onPointerUp={onShutterUp} onPointerCancel={onShutterUp} onContextMenu={(e) => e.preventDefault()}
          className={cn('absolute top-1/2 left-1/2 size-[86px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[5px] border-white shadow-lg transition-transform', recording && 'scale-[1.18] border-white/35')}>
          <span className="absolute inset-[5px] overflow-hidden rounded-full">
            {lens.icon ? <img src={lens.icon} alt="" className="size-full object-cover" /> : lens.key !== 'none' ? <span className="block size-full bg-[url(/pingo-icon.png)] bg-cover" style={{ filter: lens.css }} /> : null}
          </span>
          {recording && (
            <svg viewBox="0 0 100 100" className="absolute -inset-[9px] size-[94px] -rotate-90">
              <circle cx="50" cy="50" r="45" fill="none" stroke="#e0559b" strokeWidth="6" strokeLinecap="round" strokeDasharray="283" strokeDashoffset="283" style={{ animation: 'snap-rec 10s linear forwards' }} />
            </svg>
          )}
        </button>
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
      <label className="mx-3.5 mb-2.5 flex h-[38px] shrink-0 items-center gap-2 rounded-[10px] bg-[#2c2c2e] px-3 text-white/55">
        <Search size={16} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search lenses and filters" className="min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none" />
      </label>
      <div className="flex shrink-0 gap-2 px-3.5 pb-2.5">
        {([['all', 'All'], ['used', 'Most used'], ['ar', 'AR lenses'], ['look', 'Filters']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={cn('rounded-full px-3 py-1.5 text-[13px] font-bold', kind === k ? 'bg-[#e0559b]' : 'bg-white/8')}>{l}</button>
        ))}
      </div>
      <div className="grid grid-cols-4 content-start gap-x-2 gap-y-3.5 overflow-y-auto px-3.5 pb-4">
        {hits.map(([l, i]) => (
          <button key={l.key} type="button" onClick={() => onPick(i)} className="flex min-w-0 flex-col items-center gap-1.5 text-[11.5px] font-semibold text-white/85">
            <span className={cn('relative grid size-[62px] place-items-center overflow-hidden rounded-full bg-white/10 ring-2', i === current ? 'ring-[#ff7eb6]' : 'ring-white/35')}>
              {l.icon ? <img src={l.icon} alt="" className="size-full object-cover" /> : <span className="size-full bg-[url(/pingo-icon.png)] bg-cover" style={{ filter: l.css }} />}
              {l.ar && <span className="absolute bottom-[3px] left-1/2 -translate-x-1/2 rounded-md bg-[#e0559b] px-1 text-[8.5px] font-extrabold">AR</span>}
            </span>
            <span className="w-full truncate text-center">{l.name}</span>
          </button>
        ))}
        {hits.length === 0 && <p className="col-span-4 py-6 text-center text-white/50">No lens called "{q}"</p>}
      </div>
    </Panel>
  );
}
