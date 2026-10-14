import { Check, Copy } from 'lucide-react';
import { useState, type ReactNode } from 'react';

/** A fenced block in a PINGO AI reply: its language, light colouring and a copy button. */
export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  const copy = (event: { stopPropagation(): void }) => {
    event.stopPropagation();
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <span className="my-1.5 block overflow-hidden rounded-lg bg-ink/[0.07]">
      <span className="flex items-center justify-between px-2.5 pt-1.5 text-[11px] text-text-secondary">
        <span className="font-mono">{lang || 'code'}</span>
        <button
          type="button"
          onClick={copy}
          // The bubble opens its menu on a long press; copying is not one.
          onPointerDown={(event) => event.stopPropagation()}
          aria-label={copied ? 'Copied' : 'Copy code'}
          className="focus-ring inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-ink/10"
        >
          {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </span>
      <span className="block overflow-x-auto px-2.5 pt-1 pb-2 font-mono text-[12.5px] leading-relaxed whitespace-pre">
        {highlight(code)}
      </span>
    </span>
  );
}

const KEYWORDS =
  'const|let|var|function|return|if|else|elif|for|while|import|from|export|class|def|async|await|new|try|catch|except|throw|raise|true|false|null|undefined|None|True|False|in|of|public|private|static|void|int|fn|mut|struct|interface|type|enum|select|where|insert|update|delete|join|and|or|not';
/*
 * ponytail: one tokenizer for every language - comments, strings, numbers and
 * common keywords. A real grammar (and its weight) only if this misleads.
 */
const TOKEN = new RegExp(
  [
    String.raw`\/\/[^\n]*`,
    String.raw`#(?![\w{\[])[^\n]*`,
    String.raw`\/\*[\s\S]*?\*\/`,
    String.raw`"(?:\\.|[^"\\\n])*"`,
    String.raw`'(?:\\.|[^'\\\n])*'`,
    String.raw`\x60(?:\\.|[^\x60\\])*\x60`,
    String.raw`\b\d+(?:\.\d+)?\b`,
    String.raw`\b(?:${KEYWORDS})\b`,
  ].join('|'),
  'gi',
);

/** Code as coloured spans (React nodes, never HTML). */
export function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  let k = 0;
  for (const m of code.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    if (start > at) out.push(code.slice(at, start));
    const t = m[0];
    const cls = /^(\/\/|#|\/\*)/.test(t)
      ? 'italic text-text-tertiary'
      : /^["'\x60]/.test(t)
        ? 'text-[#0a7d4f]'
        : /^\d/.test(t)
          ? 'text-[#b4530a]'
          : 'font-semibold text-[#7c3aed]';
    out.push(
      <span key={k++} className={cls}>
        {t}
      </span>,
    );
    at = start + t.length;
  }
  if (at < code.length) out.push(code.slice(at));
  return out;
}
