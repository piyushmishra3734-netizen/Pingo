/**
 * Ready-made covers, in collections: the banner at the top of a profile and of
 * a one-to-one chat's info.
 *
 * Anybody may pick one of these; uploading your own is PINGO premium
 * (`profiles_cover_rules` holds that line). They are files in
 * `public/covers/<collection>/<id>.webp`, served by the website itself - no
 * storage, no egress bill - and saved as the full public address so every
 * device, an old APK included, can load them.
 *
 * To add a collection: put 1536x512 WebP files (landscape; the band shows a
 * strip of it and can be dragged up and down) in its folder, and list them
 * here. Ids are lowercase letters, digits and dashes - the database checks the
 * shape of the address.
 */

import { publicAppUrl } from '../../lib/public-origin.js';

export interface CoverPreset {
  id: string;
  label: string;
  src: string;
}

export interface CoverCollection {
  id: string;
  title: string;
  covers: CoverPreset[];
}

const collection = (id: string, title: string, names: string[]): CoverCollection => ({
  id,
  title,
  covers: names.map((name) => ({
    id: name,
    label: name.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()),
    src: publicAppUrl(`/covers/${id}/${name}.webp`),
  })),
});

export const COVER_COLLECTIONS: CoverCollection[] = [
  collection('gradients', 'Gradients', ['dusk', 'ocean', 'mint', 'peach', 'lavender', 'night', 'forest', 'sunset']),
];

/** Whether a saved cover is one of these, wherever the site was served from. */
export function isPresetCover(url: string | null | undefined): boolean {
  return !!url && /\/covers\/[a-z0-9-]+\/[a-z0-9-]+\.webp$/.test(url.split('?')[0] ?? '');
}
