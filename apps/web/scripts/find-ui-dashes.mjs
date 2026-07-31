import fs from 'node:fs';
import path from 'node:path';

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist', 'scripts', 'android', 'vision'].includes(e.name)) continue;
      walk(p, acc);
    } else if (/\.(tsx|ts|jsx|js|html|css)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const files = [
  ...walk('apps/web/src'),
  'apps/web/index.html',
  ...walk('packages/core/src'),
  ...walk('packages/ui/src'),
];

const longDash = /[\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/;
const samples = [];

for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const t = fs.readFileSync(f, 'utf8');
  if (longDash.test(t)) {
    console.log('LONG_DASH_CHAR', f);
  }
  // User-visible string literals that still use " - " as clause punctuation
  // (common AI-style em-dash replacement the user may still call "em dash")
  const re = /(['"`])(?:(?!\1)[\s\S])*? - (?:(?!\1)[\s\S])*?\1/g;
  let m;
  while ((m = re.exec(t))) {
    const s = m[0];
    // Prefer short UI-looking strings
    if (s.length > 200) continue;
    // Skip import paths and classNames-heavy strings
    if (s.includes('className') || s.includes('from ') || s.includes('http')) continue;
    if (!/[A-Za-z]{3,}/.test(s)) continue;
    samples.push({ f, s: s.slice(0, 160) });
  }
}

console.log('ui_hyphen_clause_samples', samples.length);
for (const s of samples.slice(0, 40)) console.log(s.f, '=>', s.s);
