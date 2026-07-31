/**
 * Stickers.
 *
 * ## A pack is data, not code
 *
 * The requirement is that new packs can be added **without modifying the app**,
 * so a pack is a JSON manifest fetched at runtime. Adding one means publishing a
 * manifest and registering its URL - no build, no deploy, no import.
 *
 * The packs that ship with PINGO use the identical shape and are loaded through
 * the identical path, which is the only way to be sure the dynamic path
 * actually works: if built-in packs took a shortcut, the shortcut is what would
 * be tested.
 *
 * ## Licence is a required field
 *
 * Same rule as the camera filters. A pack without `licence` and `attribution`
 * fails to load rather than rendering, because a sticker set whose terms nobody
 * recorded is one that cannot be shipped.
 */

/** The categories the picker groups by. Packs map their stickers onto these. */
export type StickerCategory =
  | 'smileys'
  | 'love'
  | 'reactions'
  | 'animals'
  | 'food'
  | 'gaming'
  | 'meme'
  | 'gestures'
  | 'objects';

export const STICKER_CATEGORIES: { id: StickerCategory; label: string }[] = [
  { id: 'smileys', label: 'Smileys' },
  { id: 'love', label: 'Love' },
  { id: 'reactions', label: 'Reactions' },
  { id: 'gestures', label: 'Gestures' },
  { id: 'animals', label: 'Animals' },
  { id: 'food', label: 'Food' },
  { id: 'gaming', label: 'Gaming' },
  { id: 'meme', label: 'Meme' },
  { id: 'objects', label: 'Objects' },
];

export interface Sticker {
  id: string;
  /** Shown on hover and read aloud. */
  name: string;
  category: StickerCategory;
  /** Absolute URL. Static image or Lottie JSON, per `format`. */
  url: string;
  format: 'png' | 'svg' | 'webp' | 'lottie';
  /** Words the picker searches. Lowercase. */
  keywords: string[];
  /** The emoji this sticker depicts, when there is one. Enables emoji↔sticker search. */
  emoji?: string;
}

export interface StickerPackAttribution {
  source: string;
  url: string;
  /**
   * SPDX where possible.
   *
   * `CC-BY-4.0` is allowed - attribution only, no share-alike - but
   * `CC-BY-SA-4.0` is deliberately absent: share-alike would propagate to
   * PINGO, which is the opposite of the permissive requirement.
   */
  licence: 'MIT' | 'Apache-2.0' | 'BSD-3-Clause' | 'CC-BY-4.0' | 'CC0-1.0' | 'OFL-1.1';
  /** Shown in the picker's about sheet. Required by CC-BY. */
  credit: string;
}

export interface StickerPack {
  id: string;
  name: string;
  /** The sticker shown on the pack's tab. */
  coverUrl: string;
  attribution: StickerPackAttribution;
  stickers: Sticker[];
}

/** A pack before its stickers are fetched - enough to render its tab. */
export interface StickerPackSource {
  id: string;
  name: string;
  coverUrl: string;
  /** Where the full manifest lives. Any origin. */
  manifestUrl: string;
  /** Ships with the app rather than being fetched. Still the same shape. */
  builtIn?: boolean;
}

/** A manifest is only usable if it declares what it is and who made it. */
export function isValidPack(value: unknown): value is StickerPack {
  if (typeof value !== 'object' || value === null) return false;
  const pack = value as Partial<StickerPack>;

  return (
    typeof pack.id === 'string' &&
    typeof pack.name === 'string' &&
    typeof pack.coverUrl === 'string' &&
    Array.isArray(pack.stickers) &&
    typeof pack.attribution === 'object' &&
    pack.attribution !== null &&
    typeof pack.attribution.licence === 'string' &&
    typeof pack.attribution.credit === 'string'
  );
}

/**
 * Ranked search across every loaded pack.
 *
 * Name matches beat keywords, and an exact emoji match beats both - typing 🔥
 * should find the fire sticker before anything merely tagged "hot".
 */
export function searchStickers(packs: StickerPack[], query: string): Sticker[] {
  const term = query.trim().toLowerCase();
  if (term.length === 0) return [];

  const scored: { sticker: Sticker; score: number }[] = [];

  for (const pack of packs) {
    for (const sticker of pack.stickers) {
      let score = 0;
      if (sticker.emoji === term) score = 120;
      else if (sticker.name.toLowerCase() === term) score = 100;
      else if (sticker.name.toLowerCase().startsWith(term)) score = 80;
      else if (sticker.name.toLowerCase().includes(term)) score = 60;
      else if (sticker.keywords.some((word) => word.startsWith(term))) score = 40;
      else if (sticker.keywords.some((word) => word.includes(term))) score = 20;

      if (score > 0) scored.push({ sticker, score });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || a.sticker.name.localeCompare(b.sticker.name))
    .map((item) => item.sticker);
}
