/**
 * FCP -> conversation-list gap, per run.
 *
 * The absolute timings move with whatever the network is doing, which makes
 * comparing two runs taken hours apart meaningless. This gap does not: it is
 * the time between the page having painted something and the list being on
 * screen, which is exactly the work milestone 1 changed and nothing else.
 */
import { readdirSync, readFileSync } from 'node:fs';

const DIR = 'E:/ClaudeData/scratch/bench/results';
const q = (v, p) => {
  const s = v.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[Math.max(0, Math.min(s.length - 1, Math.ceil(p * s.length) - 1))] : null;
};

const files = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
console.log('file'.padEnd(46), 'n'.padStart(3), 'median'.padStart(8), 'p95'.padStart(8), 'worst'.padStart(8));
for (const f of files) {
  const data = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'));
  if (!data.rows || data.rows.length < 5) continue;
  const gaps = data.rows
    .filter((r) => Number.isFinite(r.listVisibleMs) && Number.isFinite(r.firstContentfulPaintMs))
    .map((r) => r.listVisibleMs - r.firstContentfulPaintMs);
  console.log(
    f.padEnd(46),
    String(gaps.length).padStart(3),
    (q(gaps, 0.5) ?? NaN).toFixed(1).padStart(8),
    (q(gaps, 0.95) ?? NaN).toFixed(1).padStart(8),
    (q(gaps, 1) ?? NaN).toFixed(1).padStart(8),
  );
}
