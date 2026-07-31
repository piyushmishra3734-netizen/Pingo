/**
 * Presentation-only string helpers.
 *
 * These live in `@pingo/ui` rather than `@pingo/core` on purpose: they take
 * strings and return strings, with no knowledge of users, messages or any other
 * domain concept. Keeping them here is what lets the component library have zero
 * dependency on the domain layer - components accept `name` and `id`, not a
 * `User`, so they stay reusable if the model changes.
 */

/**
 * Up to two initials from a display name.
 *
 * Takes the first and *last* name parts rather than the first two, so
 * "Anaya Priya Sharma" reads as AS - which is how people write their own
 * initials. Falls back to a single character for mononyms and for scripts where
 * splitting on spaces yields one token.
 */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';

  const first = parts[0]?.[0] ?? '?';
  if (parts.length === 1) return first.toUpperCase();

  const last = parts[parts.length - 1]?.[0] ?? '';
  return (first + last).toUpperCase();
}

/**
 * Pick a stable variant index from a seed string.
 *
 * Used to assign each user a monogram gradient. Deterministic, so the same person
 * is the same colour on every device and across reloads - a hash rather than a
 * stored preference, which means it costs nothing to compute and nothing to sync.
 */
export function variantFromSeed(seed: string, variants: number): number {
  // Classic 31-multiplier string hash. `| 0` keeps it in int32 range.
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % variants;
}
