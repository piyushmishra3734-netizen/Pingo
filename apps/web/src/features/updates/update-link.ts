/**
 * Where the Android app is downloaded from.
 *
 * A direct link to the file, from the Worker that serves it from R2: tapping it
 * in the phone's browser downloads PINGO.apk and Android offers to install it
 * over the one already there. The "Update now" buttons point here rather than at
 * the download page, so an update is one tap and an Install, not a page of
 * steps to read first. The page stays one link below for anybody the file does
 * not open for.
 *
 * It will become download.pingo.chat once pingo.chat is a zone in the
 * Cloudflare account; only this constant changes.
 */
export const APK_URL = 'https://pingo-download.dubesminecraft.workers.dev/android';
