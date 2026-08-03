const sha = 'a7e563b';
const checks = await fetch(
  `https://api.github.com/repos/piyushmishra3734-netizen/Pingo/commits/${sha}/check-runs`,
  { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'pingo-verify' } },
).then((r) => r.json());

console.log(
  'checks',
  (checks.check_runs || []).map((r) => ({
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    title: r.output?.title,
  })),
);

const html = await fetch('https://pingochat.pages.dev/', { cache: 'no-store' }).then((r) =>
  r.text(),
);
const jsPath = html.match(/assets\/index-[^"]+\.js/)?.[0];
console.log('live js', jsPath);
if (!jsPath) process.exit(1);

const js = await fetch(`https://pingochat.pages.dev/${jsPath}`, { cache: 'no-store' }).then((r) =>
  r.text(),
);
console.log({
  hasSwipeCopy: js.includes('Swipe up to dismiss'),
  hasTouchNone: js.includes('touch-none'),
  hasGap500: js.includes('500'),
  hasSlide110: js.includes('-110%'),
  len: js.length,
});
