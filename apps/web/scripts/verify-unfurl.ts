/**
 * The link-preview endpoint's guard, and the fact that it is deployed twice.
 *
 * `/api/unfurl` fetches a URL a stranger chose. The host check is what stops it
 * being an open proxy into anything the runtime can reach, so it is asserted
 * rather than reviewed - a regression here is not a broken card, it is an SSRF.
 *
 * The second half of this is bookkeeping: the function exists in two
 * directories because it was never established which one Cloudflare Pages
 * builds from, and two copies that drift are worse than one that is wrong.
 *
 * Run with `pnpm verify:unfurl`.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { decodeEntities, isPrivateHost } from '../../../functions/api/unfurl.js';

// Loopback, by name and by number, in both address families.
assert.equal(isPrivateHost('localhost'), true);
assert.equal(isPrivateHost('api.localhost'), true);
assert.equal(isPrivateHost('127.0.0.1'), true);
assert.equal(isPrivateHost('127.1.2.3'), true);
assert.equal(isPrivateHost('::1'), true);
assert.equal(isPrivateHost('[::1]'), true);

// The three private IPv4 blocks, at both ends of each.
assert.equal(isPrivateHost('10.0.0.1'), true);
assert.equal(isPrivateHost('172.16.0.1'), true);
assert.equal(isPrivateHost('172.31.255.254'), true);
assert.equal(isPrivateHost('192.168.1.1'), true);

// 172.15 and 172.32 are public and must not be swept up with 172.16-31.
assert.equal(isPrivateHost('172.15.0.1'), false);
assert.equal(isPrivateHost('172.32.0.1'), false);

// The cloud metadata address, which is the one that actually gets attacked.
assert.equal(isPrivateHost('169.254.169.254'), true);

// Carrier-grade NAT, link-local and unique-local IPv6.
assert.equal(isPrivateHost('100.64.0.1'), true);
assert.equal(isPrivateHost('fd00::1'), true);
assert.equal(isPrivateHost('fe80::1'), true);

// Internal-sounding suffixes, whatever they resolve to.
assert.equal(isPrivateHost('printer.local'), true);
assert.equal(isPrivateHost('db.internal'), true);

// Ordinary public hosts still pass, including ones that merely start with the
// same letters as an IPv6 private prefix.
assert.equal(isPrivateHost('example.com'), false);
assert.equal(isPrivateHost('news.ycombinator.com'), false);
assert.equal(isPrivateHost('93.184.216.34'), false);

// Entities, which is what GitHub's own description actually arrives as.
assert.equal(decodeEntities('the world&#39;s tools'), "the world's tools");
assert.equal(decodeEntities('Tom &amp; Jerry'), 'Tom & Jerry');
assert.equal(decodeEntities('&quot;quoted&quot;'), '"quoted"');
assert.equal(decodeEntities('caf&#xe9;'), 'café');
assert.equal(decodeEntities('a&nbsp;b'), 'a b');
// An escaped ampersand stays escaped text rather than becoming a second entity.
assert.equal(decodeEntities('&amp;#39;'), '&#39;');
// Nothing to decode is left exactly alone.
assert.equal(decodeEntities('plain title'), 'plain title');

// Paths off the repo root rather than off `import.meta.url`: the runner bundles
// this script into a temp directory, so its own location says nothing.
const [root, web] = await Promise.all([
  readFile(resolve(process.cwd(), 'functions/api/unfurl.ts'), 'utf8'),
  readFile(resolve(process.cwd(), 'apps/web/functions/api/unfurl.ts'), 'utf8'),
]);
assert.equal(root, web, 'the two copies of the unfurl function have drifted');

console.log('unfurl guard: ok');
