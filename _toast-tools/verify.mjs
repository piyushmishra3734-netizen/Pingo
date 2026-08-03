/**
 * Re-capture scenes + a short live window after the quieting pass.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../_toast-feel/after');
const base = 'https://127.0.0.1:5173/dev/toast-lab';
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

await mkdir(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  ignoreHTTPSErrors: true,
  args: ['--ignore-certificate-errors', '--window-size=390,844'],
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
});

for (const scene of ['single', 'merge', 'stack', 'long', 'photo', 'emoji']) {
  const page = await browser.newPage();
  await page.goto(`${base}?scene=${scene}`, { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(outDir, `scene-${scene}.png`) });
  console.log('scene', scene);
  await page.close();
}

const live = await browser.newPage();
await live.goto(base, { waitUntil: 'networkidle0', timeout: 60000 });
for (const [at, label] of [
  [3, 'first'],
  [8, 'merge'],
  [25, 'photo'],
  [35, 'group'],
  [50, 'stack-or-single'],
  [100, 'mid'],
]) {
  await new Promise((r) => setTimeout(r, (at === 3 ? 3 : at - (at === 8 ? 3 : at === 25 ? 8 : at === 35 ? 25 : at === 50 ? 35 : 50)) * 1000));
  // simpler: absolute waits from start
}
await live.close();

// Clean absolute timeline
const page = await browser.newPage();
await page.goto(base, { waitUntil: 'networkidle0', timeout: 60000 });
const marks = [
  [3, 'first'],
  [8, 'merge'],
  [25, 'photo'],
  [35, 'group'],
  [55, 'longish'],
  [100, 'midday'],
];
let t = 0;
for (const [at, label] of marks) {
  await new Promise((r) => setTimeout(r, (at - t) * 1000));
  t = at;
  await page.screenshot({ path: path.join(outDir, `live-${String(at).padStart(3, '0')}-${label}.png`) });
  const count = await page.evaluate(
    () => document.querySelector('[data-toast-lab-stack]')?.children.length ?? 0,
  );
  console.log(`+${at}s ${label} cards=${count}`);
}

await browser.close();
console.log('done', outDir);
