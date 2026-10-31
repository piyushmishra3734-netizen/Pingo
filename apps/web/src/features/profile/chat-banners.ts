/**
 * Chat banners: the picture behind your row in other people's chat lists, the
 * way Discord's nameplates sit behind a name.
 *
 * Anybody may pick one of these collections; uploading your own is PINGO
 * premium (`profiles_chat_banner_rules` holds that line). They are files in
 * `public/banners/<collection>/<id>.webp`, served by the website itself - no
 * storage, no egress bill - and saved as the full public address so every
 * device, an old APK included, can load them.
 *
 * To add a collection: put 1536x512 WebP files in its folder (the row shows a
 * band across the middle, faded in from the right) and list them here. Ids are
 * lowercase letters, digits and dashes - the database checks the address.
 */

import { publicAppUrl } from '../../lib/public-origin.js';

export interface ChatBanner {
  id: string;
  label: string;
  src: string;
}

export interface ChatBannerCollection {
  id: string;
  title: string;
  banners: ChatBanner[];
}

const collection = (id: string, title: string, names: string[]): ChatBannerCollection => ({
  id,
  title,
  banners: names.map((name) => ({
    id: name,
    label: name.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()),
    src: publicAppUrl(`/banners/${id}/${name}.webp`),
  })),
});

export const CHAT_BANNER_COLLECTIONS: ChatBannerCollection[] = [
  collection('signature', 'PINGO Signature', ['sunset-bubbles']),
  collection('gradients', 'Gradients', ['dusk', 'ocean', 'mint', 'peach', 'lavender', 'night', 'forest', 'sunset']),
];

/** The same file, wherever the site that saved it was served from. */
export function sameBanner(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const path = (url: string) => {
    try {
      return new URL(url).pathname;
    } catch {
      return url.split('?')[0];
    }
  };
  return path(a) === path(b);
}
