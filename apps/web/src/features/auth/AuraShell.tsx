import { cn } from '@pingo/ui';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { AppLogo } from '../../components/AppLogo.js';

import './aura.css';
import './funnel-motion.css';

/**
 * The card Welcome and Log in are drawn on. See `aura.css` for the look and
 * `public/auth/README.md` for where the pictures come from.
 *
 * The words on the painted side are decoration (the art says what PINGO is
 * for), so they are hidden from screen readers; everything that matters is on
 * the paper side.
 */
export function AuraShell({
  children,
  size = 'full',
  overlay,
}: {
  children: ReactNode;
  /**
   * How much paint on a phone. `full` for Welcome, `compact` where there are
   * a few buttons, `strip` for forms, where the keyboard needs the room. From
   * 820px wide the paint is always the right half of the card.
   */
  size?: 'full' | 'compact' | 'strip';
  /** Rendered over the whole page, outside the card (alerts). */
  overlay?: ReactNode;
}) {
  return (
    <div className="aura-ground">
      {overlay}
      <div className="aura-card">
        <div className={cn('aura-art', size !== 'full' && `aura-art--${size}`)} aria-hidden>
          <img src="/auth/paint.webp" alt="" className="aura-art-img" decoding="async" fetchPriority="high" draggable={false} />
          <div className="aura-brand">
            <AppLogo size={22} alt="" />
            PINGO
          </div>
          <span className="aura-chip aura-chip--a">
            <i />
            01 · your people
          </span>
          <span className="aura-chip aura-chip--b">
            <i />
            02 · calls &amp; stories
          </span>
          <span className="aura-foot">— no ads · no spam —</span>
          <TornEdge direction="h" />
          <TornEdge direction="v" />
        </div>
        <div className="aura-body">{children}</div>
      </div>
    </div>
  );
}

/** Two friends drawn in light, sharing one phone. */
export function AuraFriends({ delayMs = 60 }: { delayMs?: number }) {
  return (
    <div className="aura-friends funnel-enter" style={{ animationDelay: `${delayMs}ms` }} aria-hidden>
      <img src="/auth/friends.webp" alt="" width={720} height={720} decoding="async" draggable={false} />
    </div>
  );
}

/** The main way in: a label with a hand-drawn line under it. */
export function AuraCta({
  icon,
  label,
  badge,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode; label: ReactNode; badge?: string }) {
  return (
    <button type="button" className={cn('aura-cta funnel-enter focus-ring', className)} {...rest}>
      <span className="aura-cta-label">
        {icon}
        {label}
      </span>
      <svg className="aura-wave" viewBox="0 0 300 12" preserveAspectRatio="none" aria-hidden>
        <path d={WAVE} fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {badge ? <span className="aura-cta-badge aura-mono">{badge}</span> : null}
    </button>
  );
}

/** Every other way in: outlined and quiet. */
export function AuraAlt({
  icon,
  label,
  badge,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode; label: ReactNode; badge?: string }) {
  return (
    <button type="button" className={cn('aura-alt funnel-enter focus-ring', className)} {...rest}>
      <span className="shrink-0" aria-hidden>
        {icon}
      </span>
      {label}
      {badge ? <span className="aura-cta-badge aura-mono">{badge}</span> : null}
    </button>
  );
}

/* ---------- the drawn bits, made once ---------- */

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A pen line that wobbles: a slow wave with a little hand tremor on top. */
const WAVE = (() => {
  const r = seeded(7);
  const pts: string[] = [];
  for (let x = 2; x <= 298; x += 3) {
    const y = 6 + 1.5 * Math.sin(x * 0.115) + 0.9 * Math.sin(x * 0.031 + 1) + (r() - 0.5) * 0.45;
    pts.push(`${x === 2 ? 'M' : 'L'}${x},${y.toFixed(2)}`);
  }
  return pts.join(' ');
})();

/** Torn paper: a ragged line, big tears and small fibres. */
function tornLine(seed: number, steps: number) {
  const r = seeded(seed);
  const out: number[] = [];
  let drift = 0;
  for (let i = 0; i <= steps; i++) {
    drift += (r() - 0.5) * 2.2;
    drift *= 0.82;
    out.push(9 + drift * 2.2 + (r() - 0.5) * 3.2 + (r() < 0.06 ? r() * 5 : 0));
  }
  return out;
}
const TORN_STEPS = 160;
const TORN_MAIN = tornLine(11, TORN_STEPS);
const TORN_FIBRE = tornLine(29, TORN_STEPS);

function tornPath(line: number[], lift: number, direction: 'h' | 'v') {
  const step = 1000 / TORN_STEPS;
  if (direction === 'h') {
    // paper below the line: from the bottom up to the ragged edge
    const pts = line.map((y, i) => `L${(i * step).toFixed(1)},${Math.max(0, y - lift).toFixed(2)}`);
    return `M0,24 ${pts.join(' ')} L1000,24 Z`;
  }
  // paper to the left of the line
  const pts = line.map((x, i) => `L${Math.min(24, 24 - (x - lift)).toFixed(2)},${(i * step).toFixed(1)}`);
  return `M0,0 ${pts.join(' ')} L0,1000 Z`;
}

function TornEdge({ direction }: { direction: 'h' | 'v' }) {
  const h = direction === 'h';
  return (
    <svg
      className={cn('aura-torn', h ? 'aura-torn--h' : 'aura-torn--v')}
      viewBox={h ? '0 0 1000 24' : '0 0 24 1000'}
      preserveAspectRatio="none"
      aria-hidden
    >
      {/* the fibres, a little further into the paint and see-through */}
      <path d={tornPath(TORN_FIBRE, 3, direction)} style={{ fill: 'var(--aura-fibre)' }} />
      <path d={tornPath(TORN_MAIN, 0, direction)} fill="currentColor" />
    </svg>
  );
}
