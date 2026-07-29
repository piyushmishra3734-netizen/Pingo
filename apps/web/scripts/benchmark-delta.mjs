/**
 * Does opening a quiet conversation still cost a page of history?
 *
 * The timing benchmark cannot answer this. Conversation-open time moves with
 * the network, the disk and whatever else the machine is doing, so a faster
 * number is evidence but not proof — it could just as easily be a good minute
 * on the wire. What milestone 3 actually claims is narrower and checkable:
 * opening a conversation in which nothing has happened should ask one small
 * indexed question and fetch no messages at all.
 *
 * So this counts REST traffic attributable to the open itself, rather than
 * timing it. The first open of a conversation is allowed to be expensive — it
 * is what seeds the cursor. The second open, with nothing changed in between,
 * is the one the milestone is about.
 *
 *   node apps/web/scripts/benchmark-delta.mjs
 *
 * Reads nothing, writes nothing, and changes no application state beyond what
 * ordinary use would.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire('E:/ClaudeData/scratch/bench/');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE = 'E:\\ClaudeData\\scratch\\bench-profile';
const ORIGIN = 'https://pingochat.pages.dev';
const OUT = 'E:\\ClaudeData\\scratch\\bench\\results';

const isRest = (url) => /supabase\.co\/rest\/v1\//.test(url);

/**
 * Opens the first conversation and reports only the traffic that open caused.
 *
 * Counters are reset once the list is on screen, so launch and sync traffic is
 * excluded and what remains is attributable to the tap.
 */
async function openAndCount(page, cdp) {
  const calls = [];
  let bytes = 0;
  const byId = new Map();
  const status = new Map();
  const perUrl = new Map();

  const onSend = (e) => { if (isRest(e.request.url)) byId.set(e.requestId, e.request.url); };
  /*
   * Per-query, not just a total.
   *
   * An empty delta is a couple of bytes and a delta carrying rows is not, so
   * the size of that one response distinguishes "nothing had changed" from
   * "something came back and could not be used" -- which are different bugs.
   */
  const onDone = (e) => {
    if (!byId.has(e.requestId)) return;
    bytes += e.encodedDataLength ?? 0;
    perUrl.set(byId.get(e.requestId), e.encodedDataLength ?? 0);
  };
  /*
   * Status matters as much as count. `#deltaMessages` returns undefined on any
   * error and the caller then falls back to a full fetch silently, so a delta
   * that 400s looks identical to one that was never attempted -- except in the
   * request log, where it shows up as both queries firing for one open.
   */
  const onResp = (e) => { if (byId.has(e.requestId)) status.set(byId.get(e.requestId), e.response.status); };
  cdp.on('Network.requestWillBeSent', onSend);
  cdp.on('Network.loadingFinished', onDone);
  cdp.on('Network.responseReceived', onResp);

  await page.waitForSelector('a[href^="/chats/"]', { timeout: 30000 });

  // Everything before this point is launch, not open.
  byId.clear();
  bytes = 0;

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
  const openMs = (await page.evaluate(() => performance.now())) - t0;

  // Late responses still belong to the open; give them a moment to land.
  await new Promise((r) => setTimeout(r, 1500));
  for (const url of byId.values()) calls.push(url);

  cdp.off('Network.requestWillBeSent', onSend);
  cdp.off('Network.loadingFinished', onDone);
  cdp.off('Network.responseReceived', onResp);

  const messageCalls = calls.filter((u) => /\/messages\?/.test(u));
  const tag = (u) => `[${status.get(u) ?? '?'} ${perUrl.has(u) ? `${perUrl.get(u)}B` : '-'}] ${decodeURIComponent(u)}`;
  /*
   * Three shapes, and only one of them is the thing being removed.
   *
   * A page fetch is specifically `order=created_at.desc` with a limit -- fifty
   * messages the client already has. Small keyed lookups by id are not that and
   * counting them as such would overstate the problem.
   */
  const deltaCalls = messageCalls.filter((u) => /updated_at=gt\./.test(u));
  const pageCalls = messageCalls.filter((u) => /order=created_at\.desc/.test(u));
  const otherCalls = messageCalls.filter(
    (u) => !/updated_at=gt\./.test(u) && !/order=created_at\.desc/.test(u),
  );
  return {
    openMs,
    restCalls: calls.length,
    messageCalls: messageCalls.length,
    bytes,
    refetchedPage: pageCalls.length > 0,
    // The shape of the question is the point, so it is recorded verbatim.
    deltaQueries: deltaCalls.map(tag),
    pageQueries: pageCalls.map(tag),
    otherQueries: otherCalls.map(tag),
  };
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  userDataDir: PROFILE,
  headless: 'new',
  args: ['--no-first-run', '--no-default-browser-check', '--disable-features=Translate'],
});

/*
 * Repeated rather than done once.
 *
 * A single warm open turned out not to settle it: consecutive runs disagreed
 * about whether the page was refetched. So the question is not "does the fast
 * path work" but "how often does it hold", which needs a count.
 */
const OPENS = Number(process.argv.includes('--opens') ? process.argv[process.argv.indexOf('--opens') + 1] : 6);
const results = [];
for (let i = 0; i < OPENS; i += 1) {
  const label = i === 0 ? 'open 1 (may seed the cursor)' : `open ${i + 1} (nothing changed)`;
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  await page.goto(`${ORIGIN}/chats`, { waitUntil: 'load', timeout: 60000 });

  const r = await openAndCount(page, cdp);
  results.push({ label, ...r });

  console.log(`\n--- ${label} ---`);
  console.log(`open ${r.openMs.toFixed(1)} ms · ${r.messageCalls} /messages call(s) · ${(r.bytes / 1024).toFixed(1)} KB · page refetched: ${r.refetchedPage ? 'YES' : 'no'}`);
  for (const q of r.deltaQueries) console.log(`  delta ${q.slice(0, 130)}`);
  for (const q of r.pageQueries) console.log(`  PAGE  ${q.slice(0, 130)}`);
  for (const q of r.otherQueries) console.log(`  other ${q.slice(0, 130)}`);

  await page.close();
}

const warm = results.slice(1);
console.log(`\n=== warm opens: ${warm.filter((r) => r.refetchedPage).length}/${warm.length} still refetched the page ===`);
console.log(`=== warm opens with a delta query: ${warm.filter((r) => r.deltaQueries.length > 0).length}/${warm.length} ===`);

await browser.close();

mkdirSync(OUT, { recursive: true });
const file = `${OUT}\\delta-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(file, JSON.stringify({ results }, null, 2));
console.log(`\nwritten: ${file}`);
