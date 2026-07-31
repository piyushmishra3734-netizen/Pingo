/**
 * Strip AI-style long dashes from frontend UI copy.
 * 1) Unicode em/en dashes → plain hyphen (any leftover)
 * 2) Spaced " - " clause punctuation in UI strings → comma / period
 */
import fs from 'node:fs';
import path from 'node:path';

function walk(dir, acc = [], skip = new Set()) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc, skip);
    else if (/\.(tsx|ts|html|css|js)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const UI_FILES = [
  ...walk('apps/web/src/screens'),
  ...walk('apps/web/src/features', [], new Set(['camera', 'calls', 'backup', 'stickers'])),
  // include auth/install/settings copy inside features even if nested
  ...walk('apps/web/src/features/auth'),
  ...walk('apps/web/src/features/install'),
  ...walk('apps/web/src/features/settings'),
  ...walk('apps/web/src/features/profile'),
  ...walk('apps/web/src/features/stories'),
  ...walk('apps/web/src/features/chat'),
  ...walk('apps/web/src/features/conversations'),
  ...walk('apps/web/src/features/notifications'),
  ...walk('apps/web/src/features/emoji'),
  ...walk('apps/web/src/components'),
  ...walk('apps/web/src/app'),
  'apps/web/src/lib/seo.ts',
  'apps/web/index.html',
  'apps/web/vite.config.ts',
  'packages/core/src/seed.ts',
  'packages/core/src/settings.ts',
  'packages/core/src/password-policy.ts',
  'packages/core/src/format.ts',
  'packages/ui/src/primitives/Feedback.tsx',
  'packages/ui/src/primitives/Button.tsx',
  'packages/ui/src/primitives/PasswordMeter.tsx',
];

// Always clean ALL frontend src of unicode long dashes
const ALL_FRONT = [
  ...walk('apps/web/src', [], new Set(['scripts'])),
  'apps/web/index.html',
  'apps/web/vite.config.ts',
  ...walk('packages/core/src'),
  ...walk('packages/ui/src'),
  ...walk('packages/tokens/src'),
];

function stripUnicodeDashes(text) {
  return text
    .replace(/\u2014/g, '-')
    .replace(/\u2013/g, '-')
    .replace(/\u2015/g, '-')
    .replace(/\u2012/g, '-')
    .replace(/\u2212/g, '-'); // minus sign → hyphen (comments/UI)
}

function rewriteProseInner(inner) {
  let o = inner;
  // Brand titles
  o = o.replace(/ - PINGO\b/g, ' | PINGO');
  // Sentence after full stop was " - "
  o = o.replace(/([.!?]) - ([A-Z])/g, '$1 $2');
  // Mid-sentence apposition: word - word → word, word
  // Avoid ranges like "1 - 2" and code
  o = o.replace(/([A-Za-z0-9)'"]) - ([A-Za-z])/g, '$1, $2');
  // Clean " , " double
  o = o.replace(/,\s*,/g, ',');
  // Leading/trailing spaced hyphen leftovers
  o = o.replace(/^\s*-\s+/, '');
  o = o.replace(/\s+-\s*$/, '');
  return o;
}

function rewriteQuotedStrings(text) {
  // single and double quotes
  return text.replace(/(['"])((?:\\.|(?!\1)[\s\S])*?)\1/g, (full, q, inner) => {
    if (!inner.includes(' - ')) return full;
    if (/className|https?:|translate|px-|bg-|text-|from |\$\{|===|!==|\d - \d|\\\\/.test(full))
      return full;
    // Require letters around dash (prose)
    if (!/[A-Za-z.!?'] - [A-Za-z]/.test(inner) && !/[A-Za-z] - [A-Za-z]/.test(inner)) return full;
    const next = rewriteProseInner(inner);
    if (next === inner) return full;
    return q + next + q;
  });
}

let unicodeFiles = 0;
for (const f of new Set(ALL_FRONT)) {
  if (!fs.existsSync(f)) continue;
  const raw = fs.readFileSync(f, 'utf8');
  const next = stripUnicodeDashes(raw);
  if (next !== raw) {
    fs.writeFileSync(f, next);
    unicodeFiles += 1;
  }
}

let proseFiles = 0;
for (const f of new Set(UI_FILES)) {
  if (!fs.existsSync(f)) continue;
  const raw = fs.readFileSync(f, 'utf8');
  let next = stripUnicodeDashes(raw);
  next = rewriteQuotedStrings(next);
  // Specific broken sr-only labels
  next = next.replace(/' -  met'/g, "'met'");
  next = next.replace(/' -  not yet met'/g, "'not yet met'");
  next = next.replace(/" -  met"/g, '"met"');
  next = next.replace(/" -  not yet met"/g, '"not yet met"');
  if (next !== raw) {
    fs.writeFileSync(f, next);
    proseFiles += 1;
    console.log('prose', f);
  }
}

console.log({ unicodeFiles, proseFiles });
