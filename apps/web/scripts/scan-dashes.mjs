import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DASHES = [
  ['em', '\u2014'],
  ['en', '\u2013'],
  ['hbar', '\u2015'],
  ['fig', '\u2012'],
  ['minus', '\u2212'],
  ['small_em', '\uFE58'],
  ['small_hyphen', '\uFE63'],
  ['fullwidth_hyphen', '\uFF0D'],
];

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist', 'build', 'android', 'vision'].includes(e.name)) continue;
      walk(p, acc);
    } else if (/\.(tsx?|jsx?|html|css|json|md)$/.test(e.name)) {
      acc.push(p);
    }
  }
  return acc;
}

function scanText(label, text) {
  const out = {};
  for (const [name, ch] of DASHES) {
    const n = text.split(ch).length - 1;
    if (n) out[name] = n;
  }
  if (Object.keys(out).length) console.log(label, out);
  return out;
}

function samples(text, ch, limit = 12) {
  const list = [];
  let i = 0;
  while ((i = text.indexOf(ch, i)) !== -1 && list.length < limit) {
    list.push(JSON.stringify(text.slice(Math.max(0, i - 45), Math.min(text.length, i + 45))));
    i += ch.length;
  }
  return list;
}

// Local source (frontend surface)
const files = [
  ...walk('apps/web/src'),
  'apps/web/index.html',
  'apps/web/vite.config.ts',
  ...walk('packages/core/src'),
  ...walk('packages/ui/src'),
  ...walk('packages/tokens/src'),
];

let localHits = 0;
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  if (f.includes(`${path.sep}scripts${path.sep}`)) continue;
  const t = fs.readFileSync(f, 'utf8');
  for (const [, ch] of DASHES) {
    const n = t.split(ch).length - 1;
    if (n) {
      localHits += n;
      console.log('LOCAL', n, f);
      for (const s of samples(t, ch, 3)) console.log('  ', s);
    }
  }
}
console.log('local_hits', localHits);

// Live
execSync('curl.exe -s https://pingochat.pages.dev/ -o live_index.html');
const html = fs.readFileSync('live_index.html', 'utf8');
console.log('live_title', (html.match(/<title>[^<]+/) || [])[0]);
scanText('live_html', html);
const m = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
console.log('live_bundle', m?.[1]);
if (m) {
  execSync(`curl.exe -s "https://pingochat.pages.dev${m[1]}" -o live_bundle.js`);
  const b = fs.readFileSync('live_bundle.js', 'utf8');
  scanText('live_bundle', b);
  for (const [, ch] of DASHES) {
    const ss = samples(b, ch, 15);
    if (ss.length) {
      console.log('samples for', JSON.stringify(ch));
      for (const s of ss) console.log(' ', s);
    }
  }
}
