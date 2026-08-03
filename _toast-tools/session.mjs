/**
 * Sit with the toast lab for a multi-minute multi-user traffic session.
 * Captures screenshots at natural moments and dumps the event log.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../_toast-feel');
const base = process.env.TOAST_LAB_URL ?? 'https://127.0.0.1:5173/dev/toast-lab';
const chrome =
  process.env.CHROME_PATH ??
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const SCENES = ['single', 'merge', 'stack', 'long', 'photo', 'emoji'];

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
  });
}

await mkdir(outDir, { recursive: true });

// Deterministic scenes
for (const scene of SCENES) {
  const file = path.join(outDir, `scene-${scene}.png`);
  try {
    await run(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--window-size=390,844',
      '--ignore-certificate-errors',
      `--screenshot=${file}`,
      '--virtual-time-budget=5000',
      `${base}?scene=${scene}`,
    ]);
    console.log('scene', scene, '→', file);
  } catch (error) {
    console.error('scene failed', scene, error);
  }
}

// Live multi-minute session on one page
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  ignoreHTTPSErrors: true,
  args: ['--ignore-certificate-errors', '--window-size=390,844'],
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
});

const page = await browser.newPage();
page.setDefaultTimeout(60000);
await page.goto(base, { waitUntil: 'networkidle0', timeout: 60000 });

// Feel questions we re-ask at every capture.
const questions = [
  'arrive natural?',
  'too slow/fast?',
  'too large/heavy?',
  'too bright/shadow/blur?',
  'too much motion?',
  'too close to top?',
  'part of PINGO?',
  'ok 300x/day?',
];

const moments = [
  [2, 'first-arrive'],
  [6, 'merge-same-chat'],
  [12, 'second-person'],
  [20, 'photo'],
  [30, 'group-burst'],
  [40, 'three-way-stack'],
  [55, 'long-message'],
  [75, 'rapid-double-tap'],
  [95, 'quiet-stretch'],
  [120, 'evening-trickle'],
  [150, 'second-wave'],
  [180, 'dense-again'],
  [210, 'late-cycle'],
];

const notes = [];
let elapsed = 0;
for (const [at, label] of moments) {
  const wait = Math.max(0, at - elapsed);
  await new Promise((r) => setTimeout(r, wait * 1000));
  elapsed = at;
  const file = path.join(outDir, `live-${String(at).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });

  const state = await page.evaluate(() => {
    const stack = document.querySelector('[data-toast-lab-stack]');
    const cards = stack ? [...stack.children] : [];
    return {
      count: cards.length,
      texts: cards.map((c) => c.innerText.replace(/\s+/g, ' ').trim()),
      log: [...document.querySelectorAll('ol li')].slice(0, 8).map((el) => el.textContent),
    };
  });

  notes.push({ at, label, file, state, ask: questions });
  console.log(`+${at}s ${label} cards=${state.count}`, state.texts.join(' | '));
}

await writeFile(path.join(outDir, 'session-notes.json'), JSON.stringify(notes, null, 2));
await browser.close();
console.log('done →', outDir);
