import { cn } from '../utils/cn.js';
import { markGeometry } from './PingoMark.js';

/**
 * The monogram in each of its live states — the "dot animations" row on the
 * branding board.
 *
 * The letter never changes; only the dot does. Recording is the single exception,
 * inverting the tile to brand purple because a live microphone is the one status
 * that should be unmissable.
 *
 * Used for the splash screen, empty-state loaders and anywhere the app itself
 * needs to express status. It is the brand equivalent of a spinner.
 */

export type MarkState =
  | 'idle'
  | 'online'
  | 'typing'
  | 'recording'
  | 'loading'
  | 'notification';

export interface PingoMarkStateProps {
  state?: MarkState;
  /** Tile edge length in px. The mark scales inside it. */
  size?: number;
  /** Count shown when `state` is `notification`. */
  count?: number;
  className?: string;
  /** Renders the mark alone, without the rounded tile behind it. */
  bare?: boolean;
  label?: string;
}

/** Centre of the P's bowl — the point the loading dot orbits. */
const BOWL_CENTER = { x: 18.5, y: 17 } as const;
const ORBIT_RADIUS = 13;

const SEQUENCE_DELAYS = ['-400ms', '-200ms', '0ms'] as const;

export function PingoMarkState({
  state = 'idle',
  size = 56,
  count = 0,
  className,
  bare = false,
  label,
}: PingoMarkStateProps) {
  const recording = state === 'recording';

  return (
    <span
      className={cn(
        'relative inline-flex items-center justify-center',
        !bare && 'rounded-xl',
        !bare && (recording ? 'bg-brand-gradient shadow-brand' : 'bg-sunken'),
        className,
      )}
      style={{ width: size, height: size }}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg
        width={size * 0.62}
        height={size * 0.62}
        viewBox={markGeometry.viewBox}
        fill="none"
        aria-hidden
      >
        <g
          stroke="currentColor"
          strokeWidth={markGeometry.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={recording ? 'text-white' : 'text-ink'}
        >
          <path d={markGeometry.stem} />
          <path d={markGeometry.bowl} />
        </g>

        {/* --- idle: a static mark ------------------------------------------ */}
        {state === 'idle' && (
          <circle
            cx={markGeometry.dot.cx}
            cy={markGeometry.dot.cy}
            r={markGeometry.dot.r}
            className="fill-dot"
          />
        )}

        {/* --- online: the same dot, breathing ----------------------------- */}
        {state === 'online' && (
          <circle
            cx={markGeometry.dot.cx}
            cy={markGeometry.dot.cy}
            r={markGeometry.dot.r}
            className="fill-dot animate-dot-pulse"
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          />
        )}

        {/* --- typing: the dot multiplies and lifts in sequence ------------ */}
        {state === 'typing' &&
          SEQUENCE_DELAYS.map((delay, index) => (
            <circle
              key={delay}
              cx={26 + index * 6}
              cy={markGeometry.dot.cy}
              r={2.5}
              className="fill-dot animate-dot-typing"
              style={{
                transformBox: 'fill-box',
                transformOrigin: 'center',
                animationDelay: delay,
              }}
            />
          ))}

        {/* --- recording: a haloed dot on the inverted tile ---------------- */}
        {recording && (
          <>
            <circle
              cx={markGeometry.dot.cx}
              cy={markGeometry.dot.cy}
              r={markGeometry.dot.r * 2}
              className="fill-white/35 animate-dot-pulse"
              style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
            />
            <circle
              cx={markGeometry.dot.cx}
              cy={markGeometry.dot.cy}
              r={markGeometry.dot.r}
              className="fill-white"
            />
          </>
        )}

        {/* --- loading: the dot travels the bowl instead of a spinner ------ */}
        {state === 'loading' && (
          <g
            className="animate-dot-orbit"
            style={{
              transformBox: 'view-box',
              transformOrigin: `${BOWL_CENTER.x}px ${BOWL_CENTER.y}px`,
            }}
          >
            <circle
              cx={BOWL_CENTER.x + ORBIT_RADIUS}
              cy={BOWL_CENTER.y}
              r={3}
              className="fill-dot"
            />
          </g>
        )}

        {/* --- notification: the dot is replaced by the badge below -------- */}
        {state === 'notification' && (
          <circle
            cx={markGeometry.dot.cx}
            cy={markGeometry.dot.cy}
            r={markGeometry.dot.r}
            className="fill-dot"
          />
        )}
      </svg>

      {state === 'notification' && count > 0 && (
        <span
          className={cn(
            'absolute -top-1.5 -right-1.5 flex items-center justify-center',
            'rounded-full bg-dot text-white',
            'text-caption font-medium tabular-nums',
            // A single digit stays a perfect circle; larger counts grow sideways.
            'min-w-5 h-5 px-1.5',
          )}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </span>
  );
}
