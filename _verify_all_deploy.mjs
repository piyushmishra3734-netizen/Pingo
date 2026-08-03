const EXPECTED = process.argv[2] || '956cd7a';

async function gh(path) {
  const res = await fetch(`https://api.github.com/repos/piyushmishra3734-netizen/Pingo${path}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'pingo-deploy-verify' },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} ${path}`);
  return res.json();
}

const commit = await gh(`/commits/${EXPECTED}`);
console.log('1 GitHub', {
  sha: commit.sha?.slice(0, 7),
  message: commit.commit?.message?.split('\n')[0],
});

const checks = await gh(`/commits/${EXPECTED}/check-runs`);
const cf = (checks.check_runs || []).filter((r) => /cloudflare/i.test(r.name));
console.log(
  '2 Cloudflare',
  cf.map((r) => ({ status: r.status, conclusion: r.conclusion, title: r.output?.title })),
);

const html = await fetch('https://pingochat.pages.dev/', { cache: 'no-store' }).then((r) =>
  r.text(),
);
const jsPath = html.match(/assets\/index-[^"]+\.js/)?.[0];
console.log('3 Production js', jsPath);
if (!jsPath) process.exit(1);

const js = await fetch(`https://pingochat.pages.dev/${jsPath}`, { cache: 'no-store' }).then((r) =>
  r.text(),
);

// Minified markers for circular PNG avatar export
const markers = {
  hasPngType: js.includes('image/png'),
  hasAvatarPngName: /avatar-\$\{[^}]+\}\\.png|avatar-.*\.png|image\/png/.test(js),
  hasArcClip:
    js.includes('arc(') ||
    js.includes('.arc') ||
    /closePath\(\)/.test(js),
  hasClip: js.includes('clip(') || js.includes('.clip'),
  len: js.length,
  jsPath,
};
console.log('Live markers', markers);

const cfOk = cf.some((r) => r.conclusion === 'success');
// Bundle must include png output for avatars after this commit
const liveOk = markers.hasPngType && markers.hasClip;
console.log(cfOk && liveOk ? 'ALL_GREEN' : 'WAITING');
process.exit(cfOk && liveOk ? 0 : 2);
