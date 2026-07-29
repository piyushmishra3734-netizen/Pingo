/**
 * Cold-launch benchmark for PINGO.
 *
 * Drives the installed Chrome over CDP with an isolated user-data directory, so
 * runs do not inherit state from day-to-day browsing and the HTTP cache can
 * actually be emptied — neither of which is possible from inside a page.
 *
 * The profile is dedicated but *persistent*, which is deliberate. A genuinely
 * fresh profile every run would be signed out every run, and a signed-out app
 * has no conversation list to time. So "clean" here means isolated from other
 * browsing, and the cache conditions are controlled explicitly per run instead.
 *
 * Sign in once, in the window it opens the first time. After that it is
 * unattended.
 *
 *   node apps/web/scripts/benchmark.mjs --runs 20 --condition empty
 *
 * Conditions:
 *   empty  HTTP cache disabled, CacheStorage cleared, service worker removed
 *   warm   everything left as the previous run left it
 *
 * Dependencies live outside the repo (puppeteer-core, installed under
 * E:\ClaudeData\scratch\bench) because this is a measurement tool, not a
 * shipping dependency, and C: has no room to spare.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire('E:/ClaudeData/scratch/bench/');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE = 'E:\\ClaudeData\\scratch\\bench-profile';
const ORIGIN = 'https://pingochat.pages.dev';
const OUT = 'E:\\ClaudeData\\scratch\\bench\\results';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const RUNS = Number(arg('runs', 20));
const CONDITION = arg('condition', 'empty');
const HEADLESS = !process.argv.includes('--headful');

/** Waits for a predicate in the page, returning ms from navigation start. */
const LIST_SELECTOR = 'a[href^="/chats/"]';

async function measureRun(browser, { condition }) {
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();

  await cdp.send('Network.enable');
  await cdp.send('Performance.enable');

  // Bytes on the wire, counted by the browser rather than inferred.
  let requests = 0;
  let encodedBytes = 0;
  cdp.on('Network.requestWillBeSent', () => { requests += 1; });
  cdp.on('Network.loadingFinished', (e) => { encodedBytes += e.encodedDataLength ?? 0; });

  if (condition === 'persisted') {
    /*
     * Same cold launch as `empty`, with persistent storage granted first.
     * Worth separating because a browser that may evict the origin is a
     * different product from one that may not, and the difference should show
     * up in the numbers rather than being assumed either way.
     */
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.goto(`${ORIGIN}/chats`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      if (navigator.storage?.persist) await navigator.storage.persist();
      for (const k of await caches.keys()) await caches.delete(k);
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    });
  } else if (condition === 'empty') {
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.goto(`${ORIGIN}/chats`, { waitUntil: 'domcontentloaded' });
    // Storage that survives a cache flag has to be cleared explicitly. The
    // local database is kept: wiping it would measure a first-ever launch,
    // which is not the case this benchmark is about.
    await page.evaluate(async () => {
      for (const k of await caches.keys()) await caches.delete(k);
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    });
  } else {
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  }

  requests = 0;
  encodedBytes = 0;

  const start = Date.now();
  await page.goto(`${ORIGIN}/chats`, { waitUntil: 'load', timeout: 60000 });

  // Conversation list visible.
  let listVisibleMs = null;
  try {
    await page.waitForSelector(LIST_SELECTOR, { timeout: 30000 });
    listVisibleMs = await page.evaluate(() => performance.now());
  } catch { /* recorded as null; a run that never painted is data */ }

  /*
   * Interactive, approximated honestly.
   *
   * Not Lighthouse TTI. This is: the list exists, and the main thread has then
   * been quiet of long tasks for 500ms. It is a lower bound on when a tap would
   * feel immediate, and it is measured the same way every run, which is what
   * matters for comparing against a later phase.
   */
  const interactiveMs = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let last = performance.now();
        const obs = new PerformanceObserver((l) => {
          for (const e of l.getEntries()) last = e.startTime + e.duration;
        });
        try { obs.observe({ entryTypes: ['longtask'] }); } catch { resolve(performance.now()); return; }
        const tick = () => {
          if (performance.now() - last > 500) { obs.disconnect(); resolve(last); }
          else setTimeout(tick, 100);
        };
        setTimeout(tick, 500);
      }),
  );

  /*
   * Background sync: when the app stops talking to the server.
   *
   * Measured as the last Supabase response, once a full second has passed with
   * no new one — quiet rather than a fixed count, because the number of
   * requests is exactly what Phase 1 is meant to change and a count-based
   * definition would stop meaning the same thing afterwards.
   */
  const backgroundSyncMs = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const lastEnd = () => {
          const e = performance.getEntriesByType('resource').filter((r) => /supabase\.co\/rest/.test(r.name));
          return e.length ? Math.max(...e.map((r) => r.responseEnd)) : null;
        };
        let seen = lastEnd();
        const started = performance.now();
        const tick = () => {
          const now = lastEnd();
          if (now !== seen) { seen = now; }
          if (seen != null && performance.now() - seen > 1000) { resolve(seen); return; }
          if (performance.now() - started > 25000) { resolve(seen); return; }
          setTimeout(tick, 150);
        };
        tick();
      }),
  );

  const paints = await page.evaluate(() =>
    Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, p.startTime])),
  );

  // Conversation open: click the first row, wait for a message bubble.
  let openMs = null;
  try {
    /*
     * Clicked through the router rather than with a real mouse.
     *
     * The install banner is an overlay sitting across the bottom of the list,
     * and a synthetic mouse click at the row's coordinates hits the banner
     * instead. Calling .click() on the anchor drives the same navigation the
     * user's tap would, without measuring the overlay.
     *
     * "Open" means the thread's own composer exists and at least one message
     * bubble has rendered -- an empty thread frame is not an opened chat, and
     * timing to the frame would flatter every number here.
     */
    const t0 = await page.evaluate(() => {
      document.querySelector('a[href^="/chats/"]').click();
      return performance.now();
    });
    await page.waitForFunction(
      () =>
        /\/chats\/[0-9a-f-]{36}/.test(location.pathname) &&
        document.querySelector('textarea') &&
        document.querySelectorAll('[class*=bubble]').length > 0,
      { timeout: 20000, polling: 'raf' },
    );
    openMs = (await page.evaluate(() => performance.now())) - t0;
  } catch { /* null; a run that never opened is recorded as such */ }

  const metrics = await cdp.send('Performance.getMetrics');
  const metric = (n) => metrics.metrics.find((m) => m.name === n)?.value ?? null;

  const storage = await page.evaluate(async () => {
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? null, quota: e.quota ?? null, persisted: await navigator.storage.persisted() };
  });

  const row = {
    condition,
    firstPaintMs: paints['first-paint'] ?? null,
    firstContentfulPaintMs: paints['first-contentful-paint'] ?? null,
    listVisibleMs,
    interactiveMs,
    backgroundSyncMs,
    conversationOpenMs: openMs,
    jsHeapMB: metric('JSHeapUsedSize') ? metric('JSHeapUsedSize') / 1048576 : null,
    indexedDbMB: storage.usage != null ? storage.usage / 1048576 : null,
    storagePersisted: storage.persisted,
    requests,
    transferredKB: encodedBytes / 1024,
    wallMs: Date.now() - start,
  };

  await page.close();
  return row;
}

const quantile = (values, q) => {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const i = Math.min(v.length - 1, Math.ceil(q * v.length) - 1);
  return v[Math.max(0, i)];
};

const summarise = (rows, key) => ({
  median: quantile(rows.map((r) => r[key]), 0.5),
  p95: quantile(rows.map((r) => r[key]), 0.95),
  worst: quantile(rows.map((r) => r[key]), 1),
  n: rows.filter((r) => typeof r[key] === 'number').length,
});

const browser = await puppeteer.launch({
  executablePath: CHROME,
  userDataDir: PROFILE,
  headless: HEADLESS ? 'new' : false,
  args: ['--no-first-run', '--no-default-browser-check', '--disable-features=Translate'],
});

// Sign-in check. Nothing can be measured signed out, and this cannot sign in.
const probe = await browser.newPage();
await probe.goto(`${ORIGIN}/chats`, { waitUntil: 'load' });
const signedIn = await probe.evaluate(() => Boolean(localStorage.getItem('pingo.auth.session')));
await probe.close();

/*
 * Signing in is the one step this script cannot do for you, and should not.
 * `--login` opens a real window on the benchmark profile and waits until a
 * session appears, then leaves it there for every later run to reuse.
 */
if (process.argv.includes('--login')) {
  const page = await browser.newPage();
  await page.goto(`${ORIGIN}/`, { waitUntil: 'load' });
  console.log('\nA browser window is open on the benchmark profile.');
  console.log('Sign in there. This will notice and exit on its own.\n');

  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const ok = await page
      .evaluate(() => Boolean(localStorage.getItem('pingo.auth.session')))
      .catch(() => false);
    if (ok) {
      console.log('Signed in. Profile saved — re-run without --login to benchmark.');
      await browser.close();
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log('Timed out after 10 minutes without a session.');
  await browser.close();
  process.exit(2);
}

if (!signedIn) {
  console.log('\nNot signed in on the benchmark profile.');
  console.log('Run:  node apps/web/scripts/benchmark.mjs --login --headful\n');
  await browser.close();
  process.exit(2);
}

console.log(`condition=${CONDITION} runs=${RUNS}\n`);
const rows = [];
for (let i = 0; i < RUNS; i += 1) {
  const row = await measureRun(browser, { condition: CONDITION });
  rows.push(row);
  console.log(
    `${String(i + 1).padStart(2)}  FCP ${String(Math.round(row.firstContentfulPaintMs ?? -1)).padStart(5)}ms  ` +
      `list ${String(Math.round(row.listVisibleMs ?? -1)).padStart(5)}ms  ` +
      `open ${String(Math.round(row.conversationOpenMs ?? -1)).padStart(5)}ms  ` +
      `req ${String(row.requests).padStart(3)}  ${row.transferredKB.toFixed(0).padStart(6)}KB  ` +
      `heap ${(row.jsHeapMB ?? 0).toFixed(1)}MB  idb ${(row.indexedDbMB ?? 0).toFixed(1)}MB`,
  );
}

await browser.close();

const keys = [
  'firstPaintMs', 'firstContentfulPaintMs', 'listVisibleMs', 'interactiveMs',
  'backgroundSyncMs', 'conversationOpenMs', 'jsHeapMB', 'indexedDbMB', 'requests', 'transferredKB',
];
const summary = Object.fromEntries(keys.map((k) => [k, summarise(rows, k)]));

mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const file = `${OUT}\\${CONDITION}-${stamp}.json`;
writeFileSync(file, JSON.stringify({ condition: CONDITION, runs: RUNS, rows, summary }, null, 2));

console.log('\n--- summary (median / p95 / worst) ---');
for (const k of keys) {
  const s = summary[k];
  const f = (x) => (x == null ? 'n/a' : x.toFixed(1));
  console.log(`${k.padEnd(24)} ${f(s.median).padStart(9)} ${f(s.p95).padStart(9)} ${f(s.worst).padStart(9)}   (n=${s.n})`);
}
console.log(`\nwritten: ${file}`);
