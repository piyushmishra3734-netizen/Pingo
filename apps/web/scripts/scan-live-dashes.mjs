import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function curl(url, out) {
  execSync(`curl.exe -s "${url}" -o "${out}"`, { stdio: 'ignore' });
}

curl('https://pingochat.pages.dev/', 'live_index.html');
const html = fs.readFileSync('live_index.html', 'utf8');
const assets = [...html.matchAll(/\/assets\/[A-Za-z0-9_.-]+\.(js|css)/g)].map((m) => m[0]);
const all = [...new Set([...assets, '/registerSW.js', '/sw.js', '/manifest.webmanifest', '/workbox-539cc8be.js'])];

// discover workbox name from index if present
const wb = html.match(/workbox-[a-f0-9]+\.js/);
if (wb) all.push(`/${wb[0]}`);

console.log('title', (html.match(/<title>[^<]+/) || [])[0]);
console.log('assets', all);

for (const a of all) {
  try {
    curl(`https://pingochat.pages.dev${a}`, '_asset.tmp');
    const t = fs.readFileSync('_asset.tmp', 'utf8');
    const em = (t.match(/\u2014/g) || []).length;
    const en = (t.match(/\u2013/g) || []).length;
    if (!em && !en) {
      console.log(a, 'clean', t.length);
      continue;
    }
    console.log(a, { em, en, size: t.length });
    let i = 0;
    let c = 0;
    while ((i = t.indexOf('\u2014', i)) !== -1 && c < 10) {
      console.log('  EM', JSON.stringify(t.slice(Math.max(0, i - 70), Math.min(t.length, i + 70))));
      i += 1;
      c += 1;
    }
  } catch (e) {
    console.log(a, 'ERR', e.message);
  }
}

// Find em dashes under pnpm supabase packages
function walk(dir, acc = [], depth = 0) {
  if (depth > 8) return acc;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc, depth + 1);
    else if (/\.(js|mjs|cjs|ts)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const pnpm = 'node_modules/.pnpm';
if (fs.existsSync(pnpm)) {
  const dirs = fs
    .readdirSync(pnpm)
    .filter((n) => n.startsWith('@supabase+') || n.startsWith('supabase@'))
    .map((n) => path.join(pnpm, n));
  let hits = 0;
  for (const d of dirs) {
    for (const f of walk(d)) {
      const t = fs.readFileSync(f, 'utf8');
      const n = (t.match(/\u2014/g) || []).length;
      if (n) {
        hits += n;
        console.log('DEP', n, f);
        let i = t.indexOf('\u2014');
        if (i >= 0) console.log(' ', JSON.stringify(t.slice(Math.max(0, i - 50), i + 50)));
      }
    }
  }
  console.log('dep_em_hits', hits);
}
