/**
 * Mints a signed-in session for a throwaway account and injects it into a
 * browser profile.
 *
 * This exists so automated testing can drive two different users at once. The
 * alternative that was asked for first — a guest login inside the app — would
 * have been a permanent auth bypass shipped to production, so this does the
 * same job entirely outside the product: nothing here is imported by the app,
 * and no code path in PINGO knows it exists.
 *
 * It uses the ordinary sign-up door with the anon key rather than a service
 * role. That is deliberate beyond not having the key: a test account created
 * the same way a real one is exercises the same code, so a fixture cannot
 * quietly diverge from the thing it is meant to stand in for.
 *
 * Credentials live outside the repository, on E:, because they are real
 * credentials for real (if disposable) accounts.
 *
 *   node apps/web/scripts/test-session.mjs --user alpha
 *   node apps/web/scripts/test-session.mjs --user beta --profile E:/ClaudeData/scratch/profile-beta
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const require = createRequire('E:/Pingo chat/apps/web/');
const { createClient } = require('@supabase/supabase-js');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const LABEL = arg('user', 'alpha');
const PROFILE = arg('profile', 'E:/ClaudeData/scratch/bench-profile');
const STORE = 'E:/ClaudeData/scratch/bench/test-accounts.json';
const ORIGIN = 'https://pingochat.pages.dev';

// The app's own env, so the script cannot drift onto a different project.
const env = Object.fromEntries(
  readFileSync('apps/web/.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

mkdirSync('E:/ClaudeData/scratch/bench', { recursive: true });
const saved = existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : {};

/*
 * Reused if this label has been minted before, so repeated runs keep the same
 * identity. A test user whose id changes every run cannot appear in anyone
 * else's conversation twice, which is exactly what two-user testing needs.
 */
let account = saved[LABEL];
if (!account) {
  account = {
    email: `pingo.test.${LABEL}.${randomBytes(3).toString('hex')}@example.com`,
    // Generated, never typed by anyone, never reused outside this file.
    password: randomBytes(18).toString('base64url'),
  };

  const { data, error } = await supabase.auth.signUp({
    email: account.email,
    password: account.password,
    options: { data: { name: `Test ${LABEL}`, username: `test_${LABEL}` } },
  });

  if (error) {
    console.error(`sign-up failed: ${error.message}`);
    process.exit(1);
  }
  if (!data.session) {
    console.error('sign-up returned no session — is "Confirm email" switched on?');
    process.exit(1);
  }

  account.userId = data.user?.id;
  saved[LABEL] = account;
  writeFileSync(STORE, JSON.stringify(saved, null, 2));
  console.log(`created test account "${LABEL}" (${account.userId})`);
} else {
  console.log(`reusing test account "${LABEL}" (${account.userId})`);
}

const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({
  email: account.email,
  password: account.password,
});

if (signInError || !signIn.session) {
  console.error(`sign-in failed: ${signInError?.message ?? 'no session'}`);
  process.exit(1);
}

// -- inject ----------------------------------------------------------------

const puppeteerRequire = createRequire('E:/ClaudeData/scratch/bench/');
const puppeteer = puppeteerRequire('puppeteer-core');

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  userDataDir: PROFILE,
  headless: 'new',
  args: ['--no-first-run', '--no-default-browser-check'],
});

const page = await browser.newPage();
await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });

/*
 * Written straight into the slot supabase-js reads. The client is configured
 * with `storageKey: 'pingo.auth.session'`, and on the next load it picks the
 * session up exactly as though the user had signed in on this device.
 */
await page.evaluate(
  ([session, onboardedKey]) => {
    localStorage.setItem('pingo.auth.session', JSON.stringify(session));
    // Skip the welcome flow; this account exists to be already past it.
    localStorage.setItem(onboardedKey, '1');
  },
  [signIn.session, 'pingo:onboarded'],
);

await page.goto(`${ORIGIN}/chats`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 6000));

const state = await page.evaluate(() => {
  const raw = localStorage.getItem('pingo.auth.session');
  let email;
  try { email = JSON.parse(raw ?? 'null')?.user?.email; } catch { /* ignore */ }
  return { path: location.pathname, signedInAs: email, rows: document.querySelectorAll('a[href^="/chats/"]').length };
});

await browser.close();

console.log(JSON.stringify({ profile: PROFILE, ...state }, null, 1));
console.log(state.signedInAs ? '\nsession injected — profile is signed in' : '\nINJECTION FAILED');
process.exitCode = state.signedInAs ? 0 : 1;
