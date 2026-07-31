import fs from 'node:fs';
import path from 'node:path';

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist', 'scripts', 'vision', 'lib'].includes(e.name)) continue;
      walk(p, acc);
    } else if (/\.(tsx|ts)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

// Focus on UI surface: screens, features (not crypto/backup internals heavily)
const files = [
  ...walk('apps/web/src/screens'),
  ...walk('apps/web/src/features'),
  ...walk('apps/web/src/components'),
  ...walk('apps/web/src/app'),
  'apps/web/src/lib/seo.ts',
  'apps/web/index.html',
  'apps/web/vite.config.ts',
  ...walk('packages/core/src').filter((f) => !f.includes(`${path.sep}react${path.sep}`)),
];

const re = /(['"`])((?:\\.|(?!\1)[\s\S])*? - (?:\\.|(?!\1)[\s\S])*?)\1/g;

for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const t = fs.readFileSync(f, 'utf8');
  let m;
  const seen = new Set();
  while ((m = re.exec(t))) {
    const full = m[0];
    const inner = m[2];
    // Skip code-like
    if (/className|translate|px-|bg-|text-|border-|from |import |http|\$\{|===|!==|<=|>=/.test(full))
      continue;
    if (inner.length > 180) continue;
    // Must look like prose (letters on both sides of " - ")
    if (!/[A-Za-z]{2,} - [A-Za-z]/.test(inner) && !/[.!?'] - [A-Za-z]/.test(inner)) continue;
    // Skip math-ish
    if (/\d - \d/.test(inner)) continue;
    const key = full.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`${f}\n  ${full.slice(0, 160)}\n`);
  }
}
