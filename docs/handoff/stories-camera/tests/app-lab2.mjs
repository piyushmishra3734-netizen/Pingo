// The app's story editor, every tool, with real input - in /dev/story-lab.
import { createRequire } from 'node:module';
const require = createRequire(process.env.PW_MODULES || import.meta.url);
const { chromium } = require('playwright-core');
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
const w = (ms) => page.waitForTimeout(ms);
const results = []; let fails = 0;
async function check(name, fn) {
  let ok = false; try { ok = await fn(); } catch (e) { console.log('   ', e.message.split('\n')[0]); }
  results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name);
  if (!ok && fails++ < 3) await page.screenshot({ path: `./out/af${fails}.png` });
}
const ed = '[aria-label="Story editor"]';
const btn = (t) => page.locator(`${ed} button`, { hasText: t }).first();
const count = (type) => page.evaluate((t) => document.querySelectorAll(`[data-stk] ${t}`).length, type);
const stickerTray = async (label) => { await btn('Stickers').click().catch(async () => { await page.locator(`${ed} [aria-label="More tools"]`).click(); await btn('Stickers').click(); }); await w(500); await page.locator(`${ed} button`, { hasText: label }).first().click(); await w(500); };
async function drag(x0, y0, x1, y1) { await page.mouse.move(x0, y0); await page.mouse.down(); for (let i = 1; i <= 14; i++) { await page.mouse.move(x0 + (x1 - x0) * i / 14, y0 + (y1 - y0) * i / 14); await w(16); } await page.mouse.up(); }

await page.goto('https://127.0.0.1:5190/dev/story-lab', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-lab="edit"]', { timeout: 60000 });
await page.click('[data-lab="edit"]'); await page.waitForSelector(ed); await w(1500);

await check('question sticker', async () => { await stickerTray('QUESTIONS'); return (await count('.sk-question')) === 1; });
await check('poll sticker', async () => { await stickerTray('POLL'); return (await count('.sk-poll')) === 1; });
await check('quiz sticker', async () => { await stickerTray('QUIZ'); return (await count('.sk-quiz')) === 1; });
await check('emoji slider', async () => { await stickerTray('EMOJI SLIDER'); return (await count('.sk-slider')) === 1; });
await check('time sticker', async () => { await stickerTray('TIME'); return (await count('.sk-clock')) === 1; });
await check('location (typed)', async () => { await stickerTray('LOCATION'); await page.keyboard.type('Rajwada, Indore'); await page.keyboard.press('Enter'); await w(400); return (await count('.sk-loc')) === 1; });
await check('link (typed)', async () => { await stickerTray('LINK'); await page.keyboard.type('pingochat.xyz'); await page.keyboard.press('Enter'); await w(400); return (await count('.sk-link')) === 1; });
await check('hashtag (typed)', async () => { await stickerTray('HASHTAG'); await page.keyboard.type('weekend'); await page.keyboard.press('Enter'); await w(400); return (await count('.sk-tag')) === 1; });
await check('countdown', async () => { await stickerTray('COUNTDOWN'); await page.keyboard.type('trip'); await page.locator(`${ed} button`, { hasText: 'Done' }).last().click(); await w(400); return (await count('.sk-countdown')) === 1; });
await check('emoji from the pack', async () => { await btn('Stickers').click(); await page.waitForSelector(`${ed} img[loading="lazy"]`, { timeout: 15000 }); await page.locator(`${ed} img[loading="lazy"]`).first().click(); await w(400); return (await count('.sk-emoji')) === 1; });
await check('tap location changes its style', async () => {
  const a = await page.locator('[data-stk] .sk-loc').getAttribute('class'); await page.locator('[data-stk] .sk-loc').click(); await w(200);
  return (await page.locator('[data-stk] .sk-loc').getAttribute('class')) !== a;
});
await check('drag moves a sticker', async () => {
  const el = page.locator('[data-stk]:has(.sk-tag)'); const b = await el.boundingBox(); const before = await el.getAttribute('style');
  await drag(b.x + b.width / 2, b.y + b.height / 2, b.x + b.width / 2 + 30, b.y + b.height / 2 - 80); await w(200);
  return (await el.getAttribute('style')) !== before;
});
await check('drop on the bin deletes', async () => {
  const el = page.locator('[data-stk]:has(.sk-link)'); const b = await el.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  for (let i = 1; i <= 20; i++) { await page.mouse.move(195 + (b.x + b.width / 2 - 195) * (1 - i / 20), (b.y + b.height / 2) + (844 - 76 - 50 - b.y - b.height / 2) * i / 20); await w(16); }
  await w(100); await page.mouse.up(); await w(300);
  return (await count('.sk-link')) === 0;
});
await check('effects filter', async () => { await btn('Effect').click(); await w(400); await page.locator(`${ed} button`, { hasText: 'Jaipur' }).click(); await w(200); await page.mouse.click(195, 60); await w(300); return page.evaluate(() => document.querySelector('[aria-label="Story editor"] img.object-cover')?.style.filter.includes('sepia')); });
await check('draw a stroke, undo', async () => {
  await page.locator(`${ed} [aria-label="More tools"]`).click(); await w(200); await btn('Draw').click(); await w(300);
  await drag(80, 300, 300, 360); await drag(80, 420, 300, 480);
  await page.locator(`${ed} [aria-label="Undo"]`).click(); await page.locator(`${ed} button`, { hasText: 'Done' }).click(); await w(200);
  return page.evaluate(() => { const c = document.querySelector('[aria-label="Story editor"] canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4000) if (d[i]) n++; return n > 0; });
});
await check('music: list, pick, part picker', async () => {
  await btn('Audio').click(); await page.waitForSelector(`${ed} img.size-12`, { timeout: 25000 }); await w(300);
  await page.locator(`${ed} img.size-12`).nth(1).click(); await w(700);
  const ok = await page.locator(`${ed} input[type=range]`).count() === 1;
  await page.locator(`${ed} button`, { hasText: 'Done' }).click(); await w(300);
  return ok && (await count('.sk-music')) === 1;
});
await check('caption', async () => { await page.locator(`${ed} input[placeholder="Add a caption…"]`).fill('weekend vibes'); return true; });
await check('Send to opens', async () => { await page.locator(`${ed} [aria-label="More sharing options"]`).click(); await w(400); const ok = await page.locator('text=Post to…').count() === 1; await page.locator('[aria-label="Back"]').last().click(); await w(300); return ok; });
await check('close friends shares it', async () => {
  // watch for the flight into your ring and the ring spinning, as it happens
  await page.evaluate(() => { window.__seen = { fly: false, spin: false }; new MutationObserver(() => {
    if ([...document.body.children].some((e) => e.style?.zIndex === '1200')) window.__seen.fly = true;
    if (document.querySelector('[data-story-ring="me"] .animate-spin')) window.__seen.spin = true;
  }).observe(document.body, { childList: true, subtree: true }); });
  await btn('Close Friends').click(); await page.waitForFunction(() => !document.querySelector('[aria-label="Story editor"]'), null, { timeout: 60000 }); await page.waitForFunction(() => document.querySelector('[data-lab="watch"]').textContent.includes('(1)'), null, { timeout: 10000 }); return true; });
await check('it flew into your ring, which spun while it went up', async () => {
  const seen = await page.evaluate(() => window.__seen);
  return seen.fly && seen.spin && (await page.locator('[role=status]', { hasText: 'Shared with close friends' }).count()) === 1;
});
// five stories, one interactive sticker each, the way people actually post them
for (const label of ['POLL', 'QUIZ', 'EMOJI SLIDER', 'QUESTIONS', 'COUNTDOWN']) {
  await page.click('[data-lab="edit"]'); await page.waitForSelector(ed); await w(900);
  await stickerTray(label);
  if (label === 'COUNTDOWN') { await page.keyboard.type('trip'); await page.locator(`${ed} button`, { hasText: 'Done' }).last().click(); await w(300); }
  await btn('Your story').click(); await page.waitForFunction(() => !document.querySelector('[aria-label="Story editor"]'), null, { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('[data-story-ring="me"] .animate-spin'), null, { timeout: 10000 });
}
await page.click('[data-lab="watch"]'); await w(1200); await page.keyboard.down('Space');
const next = async () => { await page.keyboard.up('Space'); await page.keyboard.press('ArrowRight'); await w(900); await page.keyboard.down('Space'); };
// the first shared story (with 11 stickers) comes first; step past it
await next();
await check('viewer: vote in the poll', async () => { await page.locator('.sk-poll .sk-opt').first().click(); await w(500); return (await page.locator('.sk-poll.sk-voted').count()) === 1 && (await page.locator('.sk-poll .sk-pct').first().textContent()) === '100%'; });
await next();
await check('viewer: quiz answer', async () => { await page.locator('.sk-quiz .sk-o').nth(1).click(); await w(400); return (await page.locator('.sk-quiz .sk-wrong').count()) === 1 && (await page.locator('.sk-quiz .sk-right').count()) === 1; });
await next();
await check('viewer: slider', async () => { const k = await page.locator('.sk-knob').boundingBox(); await drag(k.x + k.width / 2, k.y + k.height / 2, k.x + 140, k.y + k.height / 2); await w(300); return (await page.locator('.sk-slider.sk-answered').count()) === 1; });
await next();
await check('viewer: question opens answer box', async () => { await page.locator('.sk-question').click(); await w(400); const ok = await page.locator('input[placeholder="Type something…"]').count() === 1; await page.keyboard.type('where to?'); await page.keyboard.press('Enter'); await w(300); return ok && (await page.locator('input[placeholder="Type something…"]').count()) === 0; });
await next();
await check('viewer: countdown remind', async () => { await page.locator('.sk-remind').click(); await w(300); return (await page.locator('.sk-remind.sk-on').count()) === 1; });
await page.screenshot({ path: './out/a-6viewer.png' }); await page.keyboard.up('Space');
console.log(`${results.filter(Boolean).length}/${results.length} passed`, errs.filter((e) => !/signed in/i.test(e)).slice(0, 5));
await browser.close();
