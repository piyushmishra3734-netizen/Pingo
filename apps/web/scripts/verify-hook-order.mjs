/**
 * Hooks that sit after an early return, which is a blank screen waiting to happen.
 *
 * React counts hooks by call order. A `useRef` placed below `if (!thing) return
 * <Loading/>` runs on the render where `thing` exists and not on the render
 * before it, so the count changes, and React refuses to continue with
 * "Rendered more hooks than during the previous render" - error #310, which
 * reaches the user as a screen that does not open.
 *
 * It shipped exactly once, on the profile page, and it was invisible in
 * development: your own profile is already loaded by the time you open it, so
 * both renders had the same hooks. Only somebody *else's* profile is briefly
 * undefined, and only then does the count differ. A bug that cannot be
 * reproduced on your own account is one that reaches everybody else's.
 *
 * `react-hooks/rules-of-hooks` is the real answer and this repository has no
 * ESLint at all. Adding one is a bigger decision than a bug fix, so this checks
 * the single rule that has actually cost something, using the TypeScript parser
 * that is already a dependency.
 *
 * `.mjs` rather than `.ts`, because `run-ts.mjs` bundles with esbuild and the
 * TypeScript compiler reaches for `require('fs')` at load time - which a bundle
 * cannot answer. Node runs this one directly.
 *
 * ponytail: top-level statements only, and only within one function body. A
 * hook inside a nested block after a return would be missed. That is the rarer
 * shape and this is the one that broke; widen it when something else does.
 *
 * Run with `pnpm verify:hook-order`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import ts from 'typescript';

const ROOT = resolve(process.cwd(), 'apps/web/src');

function sources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (name.endsWith('.tsx') || name.endsWith('.ts')) out.push(path);
  }
  return out;
}

/** A call to something named `useSomething`, ignoring nested function bodies. */
function callsHookDirectly(node) {
  let found;
  const walk = (child) => {
    if (found) return;
    // A hook inside a callback runs later, not during this render.
    if (
      ts.isFunctionDeclaration(child) ||
      ts.isFunctionExpression(child) ||
      ts.isArrowFunction(child)
    ) {
      return;
    }
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) {
      const name = child.expression.text;
      if (/^use[A-Z]/.test(name)) found = name;
    }
    ts.forEachChild(child, walk);
  };
  ts.forEachChild(node, walk);
  return found;
}

/** A top-level `if (...) return ...` - the thing hooks must not follow. */
function isEarlyReturn(statement) {
  if (!ts.isIfStatement(statement)) return false;
  const then = statement.thenStatement;
  if (ts.isReturnStatement(then)) return true;
  return ts.isBlock(then) && then.statements.some(ts.isReturnStatement);
}

const problems = [];

for (const file of sources(ROOT)) {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const inspect = (body) => {
    let returned = false;
    for (const statement of body.statements) {
      if (returned) {
        const hook = callsHookDirectly(statement);
        if (hook) {
          const { line } = source.getLineAndCharacterOfPosition(statement.getStart(source));
          problems.push({ file: relative(process.cwd(), file), line: line + 1, hook });
        }
      }
      if (isEarlyReturn(statement)) returned = true;
    }
  };

  const visit = (node) => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      node.body &&
      ts.isBlock(node.body)
    ) {
      inspect(node.body);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (problems.length > 0) {
  console.error('Hooks called after an early return - React #310 waiting to happen:\n');
  for (const { file, line, hook } of problems) {
    console.error(`  ${file}:${line}  ${hook}()`);
  }
  console.error(
    '\nMove the hook above every conditional return. React counts hooks by call\n' +
      'order, so one that only runs on some renders changes the count and the\n' +
      'screen goes blank.',
  );
  process.exit(1);
}

console.log('✓ no hook is called after an early return');
