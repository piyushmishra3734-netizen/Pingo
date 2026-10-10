import { cn } from '@pingo/ui';
import { Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * What PINGO AI is doing, while it does it: its face, the step it is on with
 * its own icon, the steps already behind it as small ticks, and how long it
 * has been. One card above the composer, in the place the typing dots sit for
 * a person, so it never pushes the thread around.
 */

export const AI_STAGES = {
  remembering: 'Saving that for later',
  reading: 'Catching up on the chat',
  thinking: 'Thinking',
  reconsidering: 'Thinking it through again',
  reading_reply: 'Reading it back',
  polishing: 'Tidying it up',
  drawing: 'Drawing your picture',
  uploading: 'Sending it over',
  writing: 'Writing',
} as const;

export type AiStage = keyof typeof AI_STAGES;

export function AiStatus({ stage }: { stage: AiStage }) {
  /*
   * One bubble, Gemini's way: when the step changes, the old words roll up
   * and out and the new ones roll up into their place.
   */
  const [prev, setPrev] = useState<AiStage>();
  const last = useRef(stage);
  useEffect(() => {
    if (last.current === stage) return undefined;
    setPrev(last.current);
    last.current = stage;
    const t = window.setTimeout(() => setPrev(undefined), 450);
    return () => window.clearTimeout(t);
  }, [stage]);

  const started = useRef(Date.now());
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setSecs(Math.floor((Date.now() - started.current) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);


  /*
   * Drawn where the reply will be, as the reply's own bubble: the same shape
   * and place, so when the words start they take over this bubble instead of
   * a card leaving and a bubble arriving.
   */
  return (
    <div role="status" className="ai-status flex max-w-[78%] flex-col gap-1">
      {/*
        Gemini's way: a light in the person's own accent running round the
        bubble's edge, with a soft glow under it, and the spark inside turning.
      */}
      <span className="ai-glow relative w-fit rounded-[21px] rounded-bl-[7px] p-[1.5px]">
      <span className="relative flex items-center gap-2 rounded-[20px] rounded-bl-[6px] bg-surface px-3.5 py-2.5">
        <span className="relative grid size-[18px] shrink-0 place-items-center">
          <Sparkles size={17} strokeWidth={2} className="ai-spark absolute text-brand" aria-hidden />
        </span>
        <span className="ai-roll relative grid overflow-hidden">
          {prev && (
            <span key={`o-${prev}`} aria-hidden className="ai-roll-out col-start-1 row-start-1 whitespace-nowrap text-[14.5px] text-text-secondary">
              {AI_STAGES[prev]}
            </span>
          )}
          <span
            key={`l-${stage}`}
            className={cn(
              'col-start-1 row-start-1 whitespace-nowrap text-[14.5px]',
              prev ? 'ai-roll-in' : 'ai-status-label',
              'bg-clip-text text-transparent',
              'bg-[linear-gradient(100deg,var(--color-text-secondary)_30%,var(--color-ink)_50%,var(--color-text-secondary)_70%)]',
              'bg-[length:220%_100%]',
              'motion-reduce:bg-none motion-reduce:text-text-secondary',
            )}
          >
            {AI_STAGES[stage]}
          </span>
        </span>
        {secs >= 2 && <span className="text-[12px] tabular-nums text-text-tertiary">{secs}s</span>}
      </span>
      </span>
      <span className="sr-only">PINGO AI: {AI_STAGES[stage]}.</span>

      <style>{`
.ai-status { animation: ai-status-in .32s var(--ease-standard, ease-out) both; }
@keyframes ai-status-in { from { opacity: 0; transform: translateY(6px) scale(.97); } }
.ai-status-ring { background: conic-gradient(from 0deg, var(--color-brand), transparent 40%, var(--color-brand) 70%, transparent); animation: ai-status-spin 1.6s linear infinite; mask: radial-gradient(circle, transparent 13.5px, #000 14px); -webkit-mask: radial-gradient(circle, transparent 13.5px, #000 14px); }
@keyframes ai-status-spin { to { transform: rotate(1turn); } }
@property --ai-a { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
.ai-glow { --ai-light: conic-gradient(from var(--ai-a), transparent 0deg, color-mix(in srgb, var(--color-brand) 35%, transparent) 60deg, var(--color-brand) 110deg, color-mix(in srgb, var(--color-brand) 45%, white) 130deg, var(--color-brand) 150deg, transparent 220deg, transparent 360deg); background: var(--ai-light), color-mix(in srgb, var(--color-brand) 14%, var(--color-line)); animation: ai-orbit 2.4s linear infinite; }
.ai-glow::before { content: ''; position: absolute; inset: -3px; border-radius: inherit; background: var(--ai-light); filter: blur(10px); opacity: .55; z-index: -1; animation: inherit; }
@keyframes ai-orbit { to { --ai-a: 360deg; } }
.ai-spark { animation: ai-spark 2.4s var(--ease-standard, ease-in-out) infinite; }
@keyframes ai-spark { 0% { transform: rotate(0) scale(.85); } 50% { transform: rotate(180deg) scale(1.08); } 100% { transform: rotate(360deg) scale(.85); } }
.ai-status-icon, .ai-status-label { animation: ai-status-swap .28s var(--ease-standard, ease-out) both; }
.ai-status-label { animation: ai-status-swap .28s var(--ease-standard, ease-out) both, ai-sweep 2.2s linear infinite; }
@keyframes ai-status-swap { from { opacity: 0; transform: translateY(4px); } }
.ai-roll { transition: width .3s var(--ease-standard, ease-out); }
.ai-roll-out { animation: ai-roll-out .42s var(--ease-standard, ease-out) both; }
.ai-roll-in { animation: ai-roll-in .42s var(--ease-standard, ease-out) both, ai-sweep 2.2s linear .42s infinite; }
@keyframes ai-roll-out { to { transform: translateY(-110%); opacity: 0; filter: blur(2px); } }
@keyframes ai-roll-in { from { transform: translateY(110%); opacity: 0; filter: blur(2px); } }
@media (prefers-reduced-motion: reduce) { .ai-status, .ai-status-ring, .ai-glow, .ai-glow::before, .ai-spark, .ai-status-icon, .ai-status-label, .ai-roll-out, .ai-roll-in { animation: none !important; } }
`}</style>
    </div>
  );
}
