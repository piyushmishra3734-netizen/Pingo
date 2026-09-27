// The app's story viewer, Instagram's gestures, with real input.
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
  if (!ok && fails++ < 3) await page.screenshot({ path: `./out/vf${fails}.png` });
}
const who = () => page.evaluate(() => document.querySelector('[role=dialog][aria-label$="story"]')?.getAttribute('aria-label'));
async function drag(x0, y0, x1, y1) { await page.mouse.move(x0, y0); await page.mouse.down(); for (let i = 1; i <= 14; i++) { await page.mouse.move(x0 + (x1 - x0) * i / 14, y0 + (y1 - y0) * i / 14); await w(16); } await page.mouse.up(); }

await page.goto('https://127.0.0.1:5190/dev/story-lab', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-lab="edit"]', { timeout: 60000 });
await page.click('[data-lab="edit-stickers"]'); await page.waitForSelector('[aria-label="Story editor"]'); await w(900);
await page.locator('[aria-label="Story editor"] button', { hasText: 'Your story' }).click();
await page.waitForFunction(() => !document.querySelector('[aria-label="Story editor"]'), null, { timeout: 60000 });
await page.click('[data-lab="watch"]'); await w(1200);
await page.screenshot({ path: './out/v-1open.png' });

await check('opens on the first person', async () => (await who()) === "Story Lab's story");
await check('holding hides the bars and the reply bar', async () => {
  await page.mouse.move(120, 200); await page.mouse.down(); await w(500);
  const hidden = await page.evaluate(() => [...document.querySelectorAll('[role=dialog] .transition-opacity')].filter((e) => getComputedStyle(e).opacity === '0').length);
  await page.screenshot({ path: './out/v-2held.png' });
  await page.mouse.up(); await w(300);
  return hidden >= 2;
});
await check('swipe left turns to the next person', async () => {
  await drag(330, 250, 40, 255); await w(900);
  await page.screenshot({ path: './out/v-3turned.png' });
  return (await who()) === "Baani's story";
});
await check('swipe right turns back', async () => { await drag(40, 250, 340, 255); await w(900); return (await who()) === "Story Lab's story"; });
await check('a short swipe springs back', async () => { await drag(300, 250, 230, 252); await w(500); return (await who()) === "Story Lab's story"; });
await drag(330, 250, 40, 255); await w(900);
await check('reply box brings up quick reactions', async () => {
  await page.locator('input[aria-label^="Reply to"]').click(); await w(400);
  await page.screenshot({ path: './out/v-4quick.png' });
  return (await page.locator('text=Quick reactions').count()) === 1;
});
await check('a reaction flies and the grid goes', async () => {
  await page.locator('button[aria-label="React with 🔥"]').click(); await w(300);
  const flying = await page.evaluate(() => [...document.body.children].filter((n) => n.textContent === '🔥').length);
  await w(400);
  return flying > 0 && (await page.locator('text=Quick reactions').count()) === 0;
});
await check('like lifts hearts', async () => {
  await page.locator('button[aria-label="Like this story"]').click(); await w(150);
  return page.evaluate(() => [...document.body.children].filter((n) => n.textContent === '♥').length > 0);
});
await check('swipe down closes', async () => { await drag(195, 300, 195, 700); await w(900); return (await page.locator('[role=dialog][aria-label$="story"]').count()) === 0; });
console.log(`${results.filter(Boolean).length}/${results.length} passed`, errs.filter((e) => !/signed in/i.test(e)).slice(0, 5));
await browser.close();
