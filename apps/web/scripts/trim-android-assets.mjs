import { readFile, rm } from 'node:fs/promises';

/**
 * Removes from the Android bundle what the app should not carry.
 *
 * `cap sync` copies the whole of `dist` into the APK, which is right for the
 * app shell and wrong for two things in it.
 *
 * The vision models are forty megabytes. Bundling them puts the APK past the
 * 25MiB a static host will serve, which costs the download link — and the app
 * fetches them from PINGO's own origin instead, so nothing is lost but the
 * ability to use a face filter with no signal.
 *
 * The APK itself lives in `public/` so the website can offer it. Copying it
 * into the Android assets would put a copy of the app inside the app, which
 * grows every time it is built.
 */
const assets = new URL('../android/app/src/main/assets/public/', import.meta.url);

for (const path of ['PINGO.apk']) {
  await rm(new URL(path, assets), { recursive: true, force: true });
}

/*
 * The previous builds' chunks `keep-old-assets.mjs` carries, so an open web tab
 * keeps loading after a deploy. An APK only ever runs its own build: they were
 * ~100MB of the APK for nothing.
 */
let carried = [];
try {
  carried = JSON.parse(await readFile(new URL('assets-kept.json', assets), 'utf8')).carried ?? [];
} catch {
  // No ledger: nothing was carried.
}
for (const { file } of carried) {
  await rm(new URL(`assets/${file}`, assets), { force: true });
}

console.log(`trimmed PINGO.apk and ${carried.length} carried old chunks from the Android bundle`);
