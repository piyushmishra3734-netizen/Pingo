/**
 * Long single-page feel session for in-app message toasts.
 *
 * Opens the toast lab once, lets realistic multi-user traffic run, and writes
 * screenshots at natural moments. Uses system Chrome via puppeteer-core if
 * present; otherwise falls back to headless scene captures.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../../../_toast-feel');
const base = process.env.TOAST_LAB_URL ?? 'https://127.0.0.1:5173/dev/toast-lab';
const chrome =
  process.env.CHROME_PATH ??
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const SCENES = ['single', 'merge', 'stack', 'long', 'photo', 'emoji'];

async function captureScene(scene) {
  const file = path.join(outDir, `scene-${scene}.png`);
  const url = `${base}?scene=${scene}`;
  await run(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--window-size=390,844',
    '--ignore-certificate-errors',
    `--screenshot=${file}`,
    // Give React a beat to mount the scene.
    '--virtual-time-budget=4000',
    url,
  ]);
  console.log('scene', scene, '→', file);
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${bin} exit ${code}`))));
  });
}

async function liveSessionWithPuppeteer() {
  let puppeteer;
  try {
    puppeteer = await import('puppeteer-core');
  } catch {
    return false;
  }

  const browser = await puppeteer.default.launch({
    executablePath: chrome,
    headless: true,
    ignoreHTTPSErrors: true,
    args: ['--ignore-certificate-errors', '--window-size=390,844'],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
  });

  const page = await browser.newPage();
  await page.goto(base, { waitUntil: 'networkidle0', timeout: 60000 });

  // Sit with the live script for ~3.5 minutes of compressed day traffic.
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

  let elapsed = 0;
  for (const [at, label] of moments) {
    const wait = Math.max(0, at - elapsed);
    await new Promise((r) => setTimeout(r, wait * 1000));
    elapsed = at;
    const file = path.join(outDir, `live-${String(at).padStart(3, '0')}-${label}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`live +${at}s ${label} → ${file}`);
  }

  // Feel notes dump from the page log.
  const log = await page.evaluate(() => {
    const items = [...document.querySelectorAll('ol li')].map((el) => el.textContent);
    return items;
  });
  await writeFile(path.join(outDir, 'session-log.json'), JSON.stringify(log, null, 2));

  await browser.close();
  return true;
}

await mkdir(outDir, { recursive: true });

// Always capture deterministic scenes.
for (const scene of SCENES) {
  try {
    await captureScene(scene);
  } catch (error) {
    console.error('scene failed', scene, error);
  }
}

// Prefer a real timed session if puppeteer-core is around.
const lived = await liveSessionWithPuppeteer();
if (!lived) {
  console.log('puppeteer-core not installed; scenes only. Install with: npm i -D puppeteer-core');
}

console.log('done →', outDir);
