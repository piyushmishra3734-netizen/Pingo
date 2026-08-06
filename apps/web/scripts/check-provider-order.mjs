/**
 * Architecture guard: no provider may depend on a provider mounted below it.
 *
 * ## Why this exists
 *
 * `SettingsProvider` wraps `AuthProvider` in `App` - it has to, because the
 * theme is written to the document before anything else renders. Somebody (me)
 * added `useAuth()` inside it. That hook throws when no `AuthProvider` is above
 * it, the throw happens during render at the very root, React unmounts the
 * whole tree, and the page goes white.
 *
 * Nothing caught it. TypeScript cannot: the hook's type is identical whether or
 * not a provider is above it. The production build succeeded. The bundle
 * contained every string a smoke test would grep for. It reached production and
 * the app rendered nothing at all, with an empty console.
 *
 * A dependency between two providers is a fact about *where they are mounted*,
 * not about types, so it needs a check that reads the tree.
 *
 * ## What it checks
 *
 * For every provider and every mounted component in `App.tsx`: if it calls a
 * hook belonging to some other provider, that provider must appear earlier in
 * the file - which, in a single nested tree, means further out.
 *
 * The nesting is read by the order opening tags appear. That is exact for a
 * tree written as one nested expression, which `App.tsx` is; it would need
 * rewriting the day the composition root becomes several files, and it will say
 * so rather than pass silently, because a provider it cannot find is an error.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// `fileURLToPath`, not `.pathname`: the latter leaves %20 in a path with a
// space in it, which every project on this machine has.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const APP = join(ROOT, 'src', 'App.tsx');

/** Which provider each hook needs above it. */
const HOOK_OWNER = {
  'useAuth': 'AuthProvider',
  'useChat': 'ChatProvider',
  'useProfile': 'ProfileProvider',
  'usePreferences': 'SettingsProvider',
  'useAppearance': 'SettingsProvider',
  'useStories': 'StoryProvider',
  'useStickers': 'StickerProvider',
  'useNotifications': 'NotificationProvider',
  'useCall': 'CallProvider',
  'useConfirm': 'ConfirmProvider',
  'useSettings': 'SettingsProvider',
};

/**
 * Hooks a file defines rather than consumes.
 *
 * `AuthProvider`'s own module exports `useAuth`, and a provider is always
 * allowed to use its own context - the definition sits beside it. Counting
 * those would report every provider as depending on itself.
 */
function definesHook(source, hook) {
  return new RegExp(`export function ${hook}\\b`).test(source);
}

/**
 * Comments out, so prose about a hook is not mistaken for a call to it.
 *
 * Caught on its first run: the note explaining why `SettingsProvider` must not
 * call `useAuth()` was itself reported as a call to `useAuth()`. A guard that
 * fires on its own documentation is a guard people switch off.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const app = readFileSync(APP, 'utf8');

/** Where each provider's opening tag sits. Earlier means further out. */
const mountIndex = new Map();
for (const owner of new Set(Object.values(HOOK_OWNER))) {
  const at = app.indexOf(`<${owner}`);
  if (at !== -1) mountIndex.set(owner, at);
}

const failures = [];

/*
 * Every component `App` mounts, and every provider, checked against the tree.
 *
 * Files are matched to their tag by exported component name, so a component
 * that is never mounted is simply not checked - it cannot violate an order it
 * is not part of.
 */
for (const file of walk(join(ROOT, 'src'))) {
  const raw = readFileSync(file, 'utf8');
  const source = stripComments(raw);
  const exported = [...source.matchAll(/export function ([A-Z][A-Za-z0-9]*)/g)].map((m) => m[1]);

  for (const component of exported) {
    const mountedAt = app.indexOf(`<${component}`);
    if (mountedAt === -1) continue;

    for (const [hook, owner] of Object.entries(HOOK_OWNER)) {
      if (owner === component) continue;
      if (!new RegExp(`\\b${hook}\\s*\\(`).test(source)) continue;
      if (definesHook(source, hook)) continue;

      const ownerAt = mountIndex.get(owner);

      if (ownerAt === undefined) {
        failures.push(
          `${component} calls ${hook}(), but <${owner}> is not mounted in App.tsx at all.`,
        );
        continue;
      }

      if (ownerAt > mountedAt) {
        failures.push(
          `${component} calls ${hook}(), which needs <${owner}> above it - ` +
            `but <${owner}> is mounted *inside* <${component}>. ` +
            `This throws during render and blanks the app.`,
        );
      }
    }
  }
}

/*
 * Cycles.
 *
 * The order check above compares two providers at a time, and two-at-a-time is
 * blind to a loop: A needs B, B needs C, C needs A. Every individual pair can
 * look satisfiable while the whole is impossible - there is no nesting order
 * that puts all three above each other, so the tree cannot be written at all.
 *
 * It cannot happen today, because the order check would reject whichever edge
 * closed the loop. It becomes possible the moment somebody splits the
 * composition root, or wires a provider through a context it does not mount
 * directly. Finding that as "no valid order exists" beats finding it as a
 * white screen.
 */
const edges = new Map();
for (const file of walk(join(ROOT, 'src'))) {
  const source = stripComments(readFileSync(file, 'utf8'));
  for (const component of [...source.matchAll(/export function ([A-Z][A-Za-z0-9]*)/g)].map((m) => m[1])) {
    if (!mountIndex.has(component)) continue;
    const needs = new Set(edges.get(component) ?? []);
    for (const [hook, owner] of Object.entries(HOOK_OWNER)) {
      if (owner === component || definesHook(source, hook)) continue;
      if (new RegExp(`\\b${hook}\\s*\\(`).test(source)) needs.add(owner);
    }
    edges.set(component, [...needs]);
  }
}

/** Depth-first, tracking the path so a found cycle can be named in full. */
const state = new Map();
const cycles = [];

function visit(node, path) {
  if (state.get(node) === 'done') return;
  if (state.get(node) === 'open') {
    cycles.push([...path.slice(path.indexOf(node)), node].join(' -> '));
    return;
  }
  state.set(node, 'open');
  for (const next of edges.get(node) ?? []) visit(next, [...path, node]);
  state.set(node, 'done');
}

for (const node of edges.keys()) visit(node, []);

for (const cycle of cycles) {
  failures.push(`Circular provider dependency: ${cycle}. No nesting order can satisfy this.`);
}

if (failures.length > 0) {
  console.error('\nProvider order violations:\n');
  for (const failure of failures) console.error('  x ' + failure);
  console.error(
    '\nA hook whose provider is mounted below the component calling it throws\n' +
      'during render. TypeScript and the build will both pass; the page will be\n' +
      'blank with nothing in the console.\n',
  );
  process.exit(1);
}

console.log(`Provider order OK - ${mountIndex.size} providers, ${[...edges.values()].flat().length} dependencies, no cycles.`);
