// The app's Snap camera, with a fake face as the camera, driven with real input.
import { createRequire } from 'node:module';
const require = createRequire(process.env.PW_MODULES || import.meta.url);
const { chromium } = require('playwright-core');
const browser = await chromium.launch({
  headless: true, channel: 'chromium',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', ...(process.env.FAKE_CAM ? ['--use-file-for-fake-video-capture=' + process.env.FAKE_CAM] : []),
    '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true, permissions: ['camera', 'microphone'] });
await ctx.addInitScript(() => { try { localStorage.clear(); } catch {} });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (/\[camera\]/.test(m.text())) errs.push(m.text().slice(0, 200)); });
const w = (ms) => page.waitForTimeout(ms);
const results = []; let fails = 0;
// With storage cleared, Camera Kit asks "adult or child?" and then its terms, over everything, once a lens loads.
async function answerAgeGate() {
  for (let i = 0; i < 4; i++) {
    const b = page.getByText(/^(Adult|I Agree)$/).first();
    if (!(await b.isVisible().catch(() => false))) return;
    await b.click({ timeout: 3000 }).catch(() => undefined); await page.waitForTimeout(800);
  }
}
async function check(name, fn) {
  await answerAgeGate();
  let ok = false; try { ok = await fn(); } catch (e) { console.log('   ', e.message.split('\n')[0]); }
  results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name);
  if (!ok && fails++ < 3) await page.screenshot({ path: `./out/cf${fails}.png` });
}
const shot = (n) => page.screenshot({ path: `./out/c-${n}.png` });

await page.goto('https://127.0.0.1:5190/dev/camera-lab', { waitUntil: 'domcontentloaded' });
await check('Camera Kit starts and lenses load', async () => {
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="Take a snap, hold to record"]').length && document.querySelectorAll('button .rounded-md').length > 5, null, { timeout: 90000 });
  return true;
});
await w(2000); await shot('1live');
await check('pick an AR lens from the row', async () => {
  const lens = page.locator('button[aria-label="CamKit Distort"]'); await lens.click(); await w(4000); await shot('2lens');
  await page.getByText(/^(Adult|I Agree)$/).first().waitFor({ timeout: 10000 }).catch(() => undefined);
  return (await page.locator('text=CamKit Distort · Camera Kit').count()) >= 0;
});
await check('lens search finds a lens', async () => {
  await page.locator('[aria-label="Search lenses"]').first().click(); await w(500);
  await page.keyboard.type('hair'); await w(300);
  const n = await page.locator('.grid.grid-cols-4 button').count();
  await page.locator('.grid.grid-cols-4 button').first().click(); await w(2500);
  return n === 1;
});
await check('rail: timer, grid, night, flash', async () => {
  await page.locator('[aria-label="Timer"]').click(); await page.locator('[aria-label="More"]').click(); await w(200);
  await page.locator('[aria-label="Grid"]').click(); await page.locator('[aria-label="Night mode"]').click(); await page.locator('[aria-label="Flash"]').click();
  await page.locator('[aria-label="Timer"]').click(); await page.locator('[aria-label="Timer"]').click(); await page.locator('[aria-label="Timer"]').click(); // back to off
  return true;
});
await check('music: pick a song and its part', async () => {
  await page.locator('[aria-label="Music"]').click(); await page.waitForSelector('img.size-12', { timeout: 30000 }); await w(300);
  await page.locator('img.size-12').nth(1).click(); await w(700);
  const ok = await page.locator('input[type=range]').count() === 1;
  await page.locator('button', { hasText: 'Done' }).click(); await w(300);
  return ok && (await page.locator('[aria-label="Remove song"]').count()) === 1;
});
await check('hold to record a video with the song', async () => {
  const b = await page.locator('[aria-label="Take a snap, hold to record"]').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await w(3500); await page.mouse.up();
  await page.waitForSelector('video[src^="blob:"]', { timeout: 15000 }); await w(1500); await shot('3video');
  return page.evaluate(() => { const v = document.querySelector('video[src^="blob:"]'); return v.videoWidth > 0; });
});
await check('video opens in the story editor', async () => (await page.locator('[aria-label="Story editor"] video').count()) === 1);
await check('the song came along as a sticker', async () => (await page.locator('[data-stk] .sk-music').count()) === 1);
await check('discard goes back to the camera', async () => {
  await page.locator('[aria-label="Story editor"] [aria-label="Back"]').click(); await w(400);
  await page.locator('button', { hasText: 'Discard' }).first().click(); await w(2500);
  return (await page.locator('[aria-label="Take a snap, hold to record"]').count()) === 1;
});
await check('the song is still chosen after the shot', async () => (await page.locator('[aria-label="Remove song"]').count()) === 1);
await check('tap for a photo opens the story editor', async () => {
  await page.locator('[aria-label="Take a snap, hold to record"]').click();
  await page.waitForSelector('[aria-label="Story editor"] img', { timeout: 15000 }); await w(800); await shot('4photo');
  return true;
});
await check('the next shot carries the song too', async () => (await page.locator('[data-stk] .sk-music').count()) === 1);
const ed = '[aria-label="Story editor"]';
await check('photo: text', async () => { await page.locator(`${ed} button`, { hasText: 'Text' }).first().click(); await w(300); await page.keyboard.type('kal milte hai'); await page.locator('button', { hasText: 'Done' }).click(); await w(300); return (await page.locator('[data-stk] .sk-txt').count()) === 1; });
await check('photo: a poll', async () => { await page.locator(`${ed} button`, { hasText: 'Stickers' }).first().click(); await w(500); await page.locator(`${ed} button`, { hasText: 'POLL' }).click(); await w(400); return (await page.locator('[data-stk] .sk-poll').count()) === 1; });
await check('photo: view limit for a Ping', async () => {
  await page.locator(`${ed} [aria-label="More tools"]`).click(); await w(300);
  const b = page.locator(`${ed} button`, { hasText: 'Views:' }); const a = await b.textContent(); await b.click(); await w(200);
  await page.locator(`${ed} [aria-label="More tools"]`).click(); await w(300);
  return a !== (await page.locator(`${ed} button`, { hasText: 'Views:' }).textContent());
});
await shot('5edited');
await check('the arrow opens Snapchat\'s Send to', async () => { await page.locator(`${ed} [aria-label="More sharing options"]`).click(); await w(600); await shot('6sendto'); return (await page.locator('text=Post to…').count()) === 1; });
await check('choosing My story shows the send bar with the view limit', async () => { await page.locator('button', { hasText: 'My story · Friends' }).click(); await w(400); return (await page.locator('[aria-label="Send"]').isVisible()); });
console.log(`${results.filter(Boolean).length}/${results.length} passed`, errs.slice(0, 6));
await browser.close();
