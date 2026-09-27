// A profile post → Share → Add to story, and the flight into your ring - in /dev/story-lab.
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
  if (!ok && fails++ < 3) await page.screenshot({ path: `./out/pf${fails}.png` });
}
const ed = '[aria-label="Story editor"]';

await page.goto('https://127.0.0.1:5190/dev/story-lab', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-lab="post"]', { timeout: 60000 });
await page.click('[data-lab="post"]'); await w(1200);

await check('Share opens the sheet with its five actions', async () => {
  await page.click('[aria-label="Share"]'); await w(600);
  const acts = await page.locator('[aria-label="Share"][role="dialog"] [data-a]').allTextContents();
  return acts.join('|') === 'Add to story|Close friends|Copy link|Share to…|Download';
});
await page.screenshot({ path: './out/p-1share.png' });
let editorCard;
await check('Add to story opens the editor with the post as a card', async () => {
  await page.click('[data-a="story"]'); await page.waitForSelector(ed); await w(2500);
  editorCard = await page.locator(`${ed} .sk-postcard`).boundingBox();
  return (await page.locator(`${ed} .sk-postcard header`).textContent()) === 'baani' && editorCard.width > 200;
});
await check('it sits on the photo\'s own colours', async () => page.evaluate((sel) =>
  [...document.querySelectorAll(`${sel} div`)].some((d) => /linear-gradient\(160deg, rgb/.test(d.style.background) && !d.style.background.includes('rgb(58, 58, 64)')), ed));
await page.screenshot({ path: './out/p-2editor.png' });
await check('tapping the card switches its look', async () => {
  await page.locator(`${ed} .sk-postcard`).click(); await w(200);
  const s1 = await page.locator(`${ed} .sk-postcard.s1`).count(); await page.locator(`${ed} .sk-postcard`).click(); await w(200);
  return s1 === 1 && (await page.locator(`${ed} .sk-postcard.s0`).count()) === 1;
});
await check('Your story: it flies into your ring, the ring spins, then the toast', async () => {
  await page.evaluate(() => { window.__seen = { fly: false, spin: false }; new MutationObserver(() => {
    if ([...document.body.children].some((e) => e.style?.zIndex === '1200')) window.__seen.fly = true;
    if (document.querySelector('[data-story-ring="me"] .animate-spin')) window.__seen.spin = true;
  }).observe(document.body, { childList: true, subtree: true }); });
  await page.locator(`${ed} button`, { hasText: 'Your story' }).click();
  await page.locator('[role=status]', { hasText: 'Shared to your story' }).waitFor({ timeout: 10000 });
  const seen = await page.evaluate(() => window.__seen);
  return seen.fly && seen.spin && (await page.locator(ed).count()) === 0;
});
await check('stickers are the same size in the viewer as in the editor', async () => {
  await page.click('[data-lab="watch"]'); await w(2500);
  const v = await page.locator('.sk-postcard').first().boundingBox();
  return Math.abs(v.width - editorCard.width) < 2 && Math.abs(v.height - editorCard.height) < 2;
});
await check('the card says "Tap to see post", and a tap offers View post', async () => {
  const label = await page.locator('.sk-postcard').first().evaluate((el) => getComputedStyle(el, '::after').content);
  await page.locator('.sk-postcard').first().click(); await w(400);
  return label.includes('Tap to see post') && (await page.locator('button', { hasText: 'View post' }).count()) === 1;
});
await page.screenshot({ path: './out/p-3viewer.png' });
console.log(`${results.filter(Boolean).length}/${results.length} passed`, errs.filter((e) => !/signed in/i.test(e)).slice(0, 5));
await browser.close();
