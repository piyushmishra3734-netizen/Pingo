/**
 * Runs a TypeScript entry point under Node, bundled with esbuild.
 *
 * Why this exists rather than `--experimental-strip-types`: the codebase
 * imports with `.js` specifiers that resolve to `.ts` files, which is correct
 * for a bundler and which Node's stripper does not resolve. Bundling first
 * means a test can import the *real* module instead of a copy of it.
 *
 * That distinction is the whole point. A test that reimplements the thing it
 * is testing passes on the day the real one breaks.
 *
 *   node apps/web/scripts/run-ts.mjs <entry.ts>
 */
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const entry = process.argv[2];
if (!entry) {
  console.error('usage: run-ts.mjs <entry.ts>');
  process.exit(2);
}

const dir = await mkdtemp(join(tmpdir(), 'pingo-run-'));
const out = join(dir, 'bundle.mjs');

try {
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    // `.js` in source means `.ts` on disk throughout this repo.
    resolveExtensions: ['.ts', '.tsx', '.mjs', '.js', '.json'],
    logLevel: 'warning',
  });

  await import(pathToFileURL(out).href);
} finally {
  await rm(dir, { recursive: true, force: true });
}
