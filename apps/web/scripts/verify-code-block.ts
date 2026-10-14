import assert from 'node:assert/strict';
import { highlight } from '../src/features/chat/CodeBlock.js';

// Colouring never changes the code: the pieces join back to the original text.
const text = (nodes: unknown[]) => nodes.map((n) => (typeof n === 'string' ? n : (n as { props: { children: string } }).props.children)).join('');
for (const code of [
  'const x = 42; // answer',
  'def f(a):\n    return "hi #1"  # done',
  'SELECT * FROM t WHERE id = 7;',
  'let s = `a ${b}`; /* c */ x++',
  '#include <stdio.h>\nint main() { return 0; }',
]) {
  assert.equal(text(highlight(code)), code, code);
}
const nodes = highlight('return "x" // y');
assert.equal(nodes.filter((n) => typeof n !== 'string').length, 3, 'keyword, string and comment are coloured');
console.log('ALL OK');
