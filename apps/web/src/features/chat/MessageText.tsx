import { linkify } from '@pingo/core';
import { cn } from '@pingo/ui';
import type { ReactNode } from 'react';

/**
 * Message text with its links made clickable.
 *
 * ## Built as nodes, never as HTML
 *
 * The obvious implementation replaces URLs with `<a>` tags in a string and
 * hands the result to `dangerouslySetInnerHTML`. That turns every message into
 * markup the sender controls, so one person typing `<img onerror=…>` runs their
 * script in everybody else's chat. Segments come back as data and React makes
 * the elements, so a message can never be anything but text and anchors.
 *
 * ## Why the link colour depends on the bubble
 *
 * Outgoing bubbles are a saturated gradient; the brand colour on top of it is
 * unreadable. So links there are white and rely on the underline to say they
 * are links, which is the older and more reliable signal anyway.
 */

export interface MessageTextProps {
  body: string;
  /**
   * Read the body as light Markdown: PINGO AI's replies only, which use it as
   * ChatGPT does - **bold**, lists, `code` and code blocks. A person's message
   * is never parsed, so what somebody types is what everybody sees.
   */
  markdown?: boolean;
  /** Outgoing bubbles have a gradient behind them and need different colours. */
  mine: boolean;
  className?: string;
}

export function MessageText({ body, mine, className, markdown }: MessageTextProps) {
  if (markdown) return <MarkdownText body={body} mine={mine} {...(className ? { className } : {})} />;
  return <Linked text={body} mine={mine} {...(className ? { className } : {})} />;
}

function Linked({ text, mine, className }: { text: string; mine: boolean; className?: string }) {
  const segments = linkify(text);

  return (
    <span className={className}>
      {segments.map((segment, index) =>
        segment.kind === 'text' ? (
          <span key={index}>{segment.value}</span>
        ) : (
          <a
            key={index}
            href={segment.href}
            target="_blank"
            /*
             * `noopener` stops the opened page reaching back through
             * `window.opener`; `noreferrer` keeps this app's URL - which
             * contains a conversation id - out of the destination's logs.
             */
            rel="noopener noreferrer"
            // The bubble opens the context menu on long press and the row
            // navigates; neither should fire because a link was tapped.
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            className={cn(
              'underline underline-offset-2 break-all',
              'transition-opacity duration-instant hover:opacity-80',
              mine ? 'text-white' : 'text-brand',
            )}
          >
            {segment.value}
          </a>
        ),
      )}
    </span>
  );
}

/* ---------- light Markdown, built as nodes (never HTML) ---------- */

/** `code`, **bold**, *italic*, then links inside what is left. */
function Inline({ text, mine }: { text: string; mine: boolean }) {
  const parts: ReactNode[] = [];
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*\*)/g;
  let at = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > at) parts.push(<Linked key={k++} text={text.slice(at, m.index)} mine={mine} />);
    const tok = m[0];
    if (tok.startsWith('`')) parts.push(<code key={k++} className="rounded bg-ink/[0.07] px-1 py-px font-mono text-[0.9em]">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('**')) parts.push(<strong key={k++} className="font-semibold"><Inline text={tok.slice(2, -2)} mine={mine} /></strong>);
    else parts.push(<em key={k++}><Inline text={tok.slice(1, -1)} mine={mine} /></em>);
    at = m.index + tok.length;
  }
  if (at < text.length) parts.push(<Linked key={k++} text={text.slice(at)} mine={mine} />);
  return <>{parts}</>;
}

/**
 * Blocks: fenced code, headings (as a bold line: a bubble has no room for
 * sizes), bullet and numbered lists, and paragraphs. Spans styled as blocks,
 * because this sits inside the bubble's paragraph.
 */
function MarkdownText({ body, mine, className }: { body: string; mine: boolean; className?: string }) {
  const out: ReactNode[] = [];
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  let k = 0;
  let para: string[] = [];
  const flushPara = () => {
    if (!para.length) return;
    const text = para.join('\n');
    out.push(
      <span key={k++} className="block [&+&]:mt-2">
        <Inline text={text} mine={mine} />
      </span>,
    );
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = /^\s*```/.exec(line);
    if (fence) {
      flushPara();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) code.push(lines[i++]!);
      i++;
      out.push(
        <span key={k++} className="my-1.5 block overflow-x-auto rounded-lg bg-ink/[0.07] px-2.5 py-2 font-mono text-[12.5px] leading-relaxed whitespace-pre">
          {code.join('\n')}
        </span>,
      );
      continue;
    }
    const heading = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      out.push(
        <span key={k++} className="mt-2 block font-semibold first:mt-0">
          <Inline text={heading[1]!} mine={mine} />
        </span>,
      );
    } else if (bullet || numbered) {
      flushPara();
      out.push(
        <span key={k++} className="mt-1 flex gap-2 first:mt-0">
          <span className="shrink-0 tabular-nums opacity-70">{numbered ? `${numbered[1]}.` : '•'}</span>
          <span className="min-w-0 flex-1">
            <Inline text={(numbered ? numbered[2] : bullet![1])!} mine={mine} />
          </span>
        </span>,
      );
    } else if (!line.trim()) {
      flushPara();
      out.push(<span key={k++} className="block h-2" aria-hidden />);
    } else {
      para.push(line);
    }
    i++;
  }
  flushPara();
  return <span className={cn('block whitespace-pre-wrap', className)}>{out}</span>;
}
