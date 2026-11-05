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
 * download.pingochat.xyz, the app's own domain, rather than the shared
 * *.workers.dev name it is served from underneath: Chrome and Google Safe
 * Browsing are warier of an APK on a shared domain than of one on the app's own.
 * The workers.dev address still works (builds already installed use it), so
 * nothing that points there breaks.
 */
export const APK_URL = 'https://download.pingochat.xyz/android';
