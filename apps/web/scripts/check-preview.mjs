import { execSync } from 'node:child_process';
import fs from 'node:fs';

const base = process.argv[2] || 'https://ac661f14.pingochat.pages.dev';
execSync(`curl.exe -s "${base}/" -o _p.html`, { stdio: 'ignore' });
const h = fs.readFileSync('_p.html', 'utf8');
console.log('title', (h.match(/<title>[^<]+/) || [])[0]);
const m = h.match(/src="(\/assets\/index-[^"]+\.js)"/);
console.log('bundle', m?.[1]);
if (!m) process.exit(1);
execSync(`curl.exe -s "${base}${m[1]}" -o _p.js`, { stdio: 'ignore' });
const b = fs.readFileSync('_p.js', 'utf8');
console.log({
  em: (b.match(/\u2014/g) || []).length,
  en: (b.match(/\u2013/g) || []).length,
  size: b.length,
});
// also check production
execSync('curl.exe -s "https://pingochat.pages.dev/" -o _prod.html', { stdio: 'ignore' });
const ph = fs.readFileSync('_prod.html', 'utf8');
const pm = ph.match(/src="(\/assets\/index-[^"]+\.js)"/);
console.log('prod_bundle', pm?.[1]);
if (pm) {
  execSync(`curl.exe -s "https://pingochat.pages.dev${pm[1]}" -o _prod.js`, { stdio: 'ignore' });
  const pb = fs.readFileSync('_prod.js', 'utf8');
  console.log('prod', {
    em: (pb.match(/\u2014/g) || []).length,
    en: (pb.match(/\u2013/g) || []).length,
  });
}
