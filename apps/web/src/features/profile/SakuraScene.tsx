import { useId, useMemo } from 'react';

/**
 * The world behind the invite card: a spring sky, cherry trees out of focus at
 * the edges, a branch in the top corner, and petals drifting down.
 *
 * Drawn, not photographed - an SVG of blossoms and bokeh, blurred by depth - so
 * it is sharp on any screen, costs a few kilobytes, and matches the voxel tree
 * on the card without a stock photo's colours fighting it.
 *
 * The petals only fall behind the card. The card is frosted, so they read as
 * shapes moving through glass, and nothing ever crosses the code.
 */

/** A small deterministic random, so the scene is the same on every open. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const PINKS = ['#f4a3bd', '#f7b8cb', '#ee8fae', '#fbd0dd', '#f29ab6', '#fde1ea', '#f7c2d2'];

/** A five-petal blossom at (x, y), radius r. */
function Blossom({ x, y, r, fill, turn }: { x: number; y: number; r: number; fill: string; turn: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${turn})`}>
      {[0, 72, 144, 216, 288].map((a) => (
        <ellipse key={a} cx={0} cy={-r * 0.55} rx={r * 0.42} ry={r * 0.6} fill={fill} transform={`rotate(${a})`} />
      ))}
      <circle r={r * 0.2} fill="#fff4f7" />
    </g>
  );
}

/** One out-of-focus cluster of blossoms: lots of soft circles, blurred together. */
function Cluster({ cx, cy, spread, count, size, seed }: { cx: number; cy: number; spread: number; count: number; size: number; seed: number }) {
  const dots = useMemo(() => {
    const rnd = seeded(seed);
    return Array.from({ length: count }, () => {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * spread;
      return { x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d * 0.8, r: size * (0.55 + rnd() * 0.7), fill: PINKS[Math.floor(rnd() * PINKS.length)]! };
    });
  }, [cx, cy, spread, count, size, seed]);
  return <>{dots.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={d.fill} />)}</>;
}

export function SakuraBackdrop() {
  const near = useMemo(() => {
    const rnd = seeded(7);
    // Blossoms along the branches in the top corners, in focus.
    const along: [number, number][] = [
      [10, 84], [34, 66], [58, 52], [82, 40], [106, 30], [130, 22], [156, 14], [182, 8],
      [22, 120], [48, 104], [70, 80], [96, 60], [120, 46], [4, 150], [30, 142], [140, 40], [60, 20], [100, 10],
      [300, 8], [330, 22], [356, 40], [380, 30], [345, 60],
    ];
    return along.flatMap(([x, y], i) =>
      Array.from({ length: 7 }, (_, j) => ({
        key: `${i}-${j}`,
        x: x + (rnd() - 0.5) * 36,
        y: y + (rnd() - 0.5) * 30,
        r: 6.5 + rnd() * 6.5,
        fill: PINKS[Math.floor(rnd() * PINKS.length)]!,
        turn: rnd() * 72,
      })),
    );
  }, []);

  return (
    <svg aria-hidden className="absolute inset-0 size-full" viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#dcc3e6" />
          <stop offset="0.3" stopColor="#f0c6d6" />
          <stop offset="0.7" stopColor="#f6c9d5" />
          <stop offset="1" stopColor="#f3cdd8" />
        </linearGradient>
        <radialGradient id="skylight" cx="0.52" cy="0.1" r="0.42">
          <stop offset="0" stopColor="#c6c8f2" stopOpacity="1" />
          <stop offset="1" stopColor="#c6c8f2" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="ground" cx="0.5" cy="1.02" r="0.62">
          <stop offset="0" stopColor="#fff4f6" stopOpacity="0.95" />
          <stop offset="1" stopColor="#fff4f6" stopOpacity="0" />
        </radialGradient>
        <filter id="far" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" /></filter>
        <filter id="mid" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" /></filter>
        <filter id="fore" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" /></filter>
        <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="0.5" /></filter>
      </defs>

      <rect width="390" height="844" fill="url(#sky)" />
      <rect width="390" height="844" fill="url(#skylight)" />

      {/* Trees along both sides, soft, full height. */}
      <g filter="url(#far)">
        <Cluster cx={360} cy={70} spread={80} count={60} size={15} seed={11} />
        <Cluster cx={392} cy={220} spread={60} count={50} size={15} seed={12} />
        <Cluster cx={-4} cy={250} spread={60} count={50} size={15} seed={13} />
        <Cluster cx={392} cy={390} spread={55} count={46} size={14} seed={14} />
        <Cluster cx={-6} cy={430} spread={55} count={46} size={14} seed={15} />
        <Cluster cx={390} cy={560} spread={55} count={44} size={14} seed={16} />
        <Cluster cx={-4} cy={600} spread={55} count={44} size={14} seed={17} />
      </g>
      <g filter="url(#mid)" opacity="0.95">
        <Cluster cx={-2} cy={330} spread={30} count={24} size={9} seed={41} />
        <Cluster cx={392} cy={300} spread={30} count={24} size={9} seed={42} />
        <Cluster cx={0} cy={520} spread={28} count={20} size={9} seed={43} />
        <Cluster cx={390} cy={480} spread={28} count={20} size={9} seed={44} />
      </g>

      {/* The ground, a pale haze. */}
      <rect y="600" width="390" height="244" fill="url(#ground)" />

      {/* The branches in the top corners, in focus. */}
      <g filter="url(#soft)">
        <path d="M-12 100 C 30 74, 80 44, 200 2" stroke="#7d5047" strokeWidth="7" fill="none" strokeLinecap="round" />
        <path d="M44 70 C 58 86, 66 104, 64 128" stroke="#7d5047" strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M104 40 C 118 52, 126 66, 130 82" stroke="#7d5047" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        <path d="M-12 160 C 8 146, 22 132, 32 112" stroke="#7d5047" strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M150 20 C 160 30, 164 44, 162 58" stroke="#7d5047" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M402 44 C 370 30, 340 20, 290 -4" stroke="#7d5047" strokeWidth="4.5" fill="none" strokeLinecap="round" />
        {near.map((b) => <Blossom key={b.key} x={b.x} y={b.y} r={b.r} fill={b.fill} turn={b.turn} />)}
      </g>

      {/* Blossoms right in front of the lens, blurred large. */}
      <g filter="url(#fore)" opacity="0.95">
        <Cluster cx={30} cy={810} spread={70} count={30} size={22} seed={31} />
        <Cluster cx={-10} cy={720} spread={40} count={18} size={20} seed={32} />
        <Cluster cx={385} cy={830} spread={50} count={20} size={20} seed={33} />
      </g>
    </svg>
  );
}

/** One sakura petal: rounded, with the small notch at its tip. */
export function Petal({ size = 12, className, style }: { size?: number; className?: string; style?: React.CSSProperties }) {
  // Its own gradient id: a shared one resolved to the first petal on the page, and when that one was hidden every petal lost its fill.
  const id = useId().replace(/:/g, '');
  return (
    <svg aria-hidden viewBox="-8 -9 16 18" width={size} height={size * 1.12} className={className} style={style}>
      <defs>
        <linearGradient id={`petal${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fdd0de" />
          <stop offset="1" stopColor="#f083a8" />
        </linearGradient>
      </defs>
      <path d="M0 8.5 C -6 4.5, -7 -3, -3 -7.5 L -1.2 -6 L 0 -8.2 L 1.2 -6 L 3 -7.5 C 7 -3, 6 4.5, 0 8.5 Z" fill={`url(#petal${id})`} />
      <path d="M0 7 C -1 2, -0.6 -2, 0 -5" stroke="#f7a9c2" strokeWidth="0.7" fill="none" />
    </svg>
  );
}

const FALLING = [
  { left: 6, delay: 0, dur: 11, size: 14, drift: 40 },
  { left: 22, delay: 3.5, dur: 13, size: 11, drift: -30 },
  { left: 38, delay: 7, dur: 12, size: 13, drift: 36 },
  { left: 58, delay: 1.8, dur: 14, size: 10, drift: -40 },
  { left: 74, delay: 5.2, dur: 12.5, size: 14, drift: 30 },
  { left: 90, delay: 9, dur: 13.5, size: 12, drift: -34 },
  { left: 48, delay: 11, dur: 12, size: 11, drift: 26 },
  { left: 14, delay: 8.4, dur: 14.5, size: 12, drift: -20 },
];

/** Petals drifting down behind the card. Still for reduced motion. */
export function FallingPetals() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {FALLING.map((p, i) => (
        <span
          key={i}
          className="sakura-fall absolute -top-8"
          style={{ left: `${p.left}%`, animationDelay: `-${p.delay}s`, animationDuration: `${p.dur}s`, ['--drift' as string]: `${p.drift}px` }}
        >
          <Petal size={p.size} className="sakura-spin" style={{ animationDuration: `${p.dur / 3}s` }} />
        </span>
      ))}
    </div>
  );
}
