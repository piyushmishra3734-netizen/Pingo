import { writeFileSync, readFileSync } from 'node:fs';

const html = await fetch('https://pingochat.pages.dev/').then((r) => r.text());
const jsPath = html.match(/assets\/index-[^"]+\.js/)?.[0];
const cssPath = html.match(/assets\/index-[^"]+\.css/)?.[0];
console.log('js', jsPath);
console.log('css', cssPath);
if (!jsPath || !cssPath) process.exit(1);

const js = await fetch(`https://pingochat.pages.dev/${jsPath}`).then((r) => r.text());
const css = await fetch(`https://pingochat.pages.dev/${cssPath}`).then((r) => r.text());

const checks = {
  jsHasToast: /toast-in|Message from|quietHours|max-w-\[26rem\]/.test(js),
  jsHasSlide: /translateY\(-110%\)|-110%/.test(js) || /toast-in/.test(css),
  cssHasToastIn: /toast-in/.test(css) || /@keyframes\s+toast-in/.test(css),
  cssHasSlide: /translateY\(-110%\)/.test(css),
  jsLen: js.length,
  cssLen: css.length,
};
console.log(JSON.stringify(checks, null, 2));
writeFileSync('_verify_prod_result.json', JSON.stringify({ jsPath, cssPath, checks }, null, 2));
