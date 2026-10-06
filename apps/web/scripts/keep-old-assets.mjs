/**
 * Ships the previous build's files inside this one, for three days.
 *
 * A Pages deploy replaces every hashed file. An app already open on a phone is
 * still running the old build, and the next screen it opens asks for an old
 * chunk that no longer exists - so it either failed ("That screen did not
 * open"), flashed white and reloaded, or was sent through a full page load
 * with the splash on every navigation after a deploy. PINGO deploys several
 * times a day, so people met that constantly.
 *
 * Keeping the old files fixes the cause: the running build keeps working, and
 * the new one arrives on the next real launch. The list of what the live build
 * uses is read from the live site itself - its entry script names every chunk
 * it can load, and those name theirs - and anything already being carried is
 * listed in /assets-kept.json with the time it was first carried.
 *
 * It never fails the build. No network, a bad response, a timeout: the deploy
 * goes out exactly as it would have without this.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'https://pingochat.pages.dev';
const KEEP_MS = 3 * 24 * 60 * 60 * 1000;
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const ASSETS = join(DIST, 'assets');
const LEDGER = join(DIST, 'assets-kept.json');
const now = Date.now();

async function get(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
}

const refs = (text) => [...new Set(text.match(/assets\/[A-Za-z0-9_.-]+\.(?:js|css|woff2|wasm)/g) ?? [])].map((r) => r.slice(7));

async function main() {
  if (!existsSync(ASSETS)) return;
  const current = new Set(readdirSync(ASSETS));

  /** file -> when it was first carried */
  const carried = new Map();
  try {
    const ledger = await (await get(`${ORIGIN}/assets-kept.json?b=${now}`)).json();
    for (const entry of ledger.carried ?? []) {
      if (now - entry.since < KEEP_MS) carried.set(entry.file, entry.since);
    }
  } catch {
    // First run, or the ledger is not there yet: only the live build is carried.
  }

  // Everything the live build can load, by crawling from its entry.
  try {
    const html = await (await get(`${ORIGIN}/?b=${now}`)).text();
    const queue = refs(html);
    const seen = new Set(queue);
    while (queue.length) {
      const batch = queue.splice(0, 12);
      await Promise.all(batch.map(async (file) => {
        if (!file.endsWith('.js')) return;
        try {
          const text = await (await get(`${ORIGIN}/assets/${file}`)).text();
          for (const ref of refs(text)) if (!seen.has(ref)) { seen.add(ref); queue.push(ref); }
        } catch { /* one unreadable chunk does not stop the rest */ }
      }));
    }
    for (const file of seen) if (!carried.has(file)) carried.set(file, now);
  } catch (cause) {
    console.warn(`[keep-old-assets] live build not read: ${cause.message}`);
  }

  let copied = 0;
  const kept = [];
  const files = [...carried].filter(([file]) => !current.has(file));
  while (files.length) {
    const batch = files.splice(0, 12);
    await Promise.all(batch.map(async ([file, since]) => {
      try {
        const res = await get(`${ORIGIN}/assets/${file}`);
        // A missing file comes back as the SPA's index.html with a 200.
        if ((res.headers.get('content-type') ?? '').includes('text/html')) return;
        writeFileSync(join(ASSETS, file), Buffer.from(await res.arrayBuffer()));
        kept.push({ file, since });
        copied += 1;
      } catch { /* gone already: nothing to keep */ }
    }));
  }

  writeFileSync(LEDGER, JSON.stringify({ at: now, carried: kept }));
  console.log(`[keep-old-assets] carried ${copied} files from earlier builds`);
}

await main().catch((cause) => console.warn(`[keep-old-assets] skipped: ${cause.message}`));
