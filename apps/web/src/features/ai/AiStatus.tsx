import { cn } from '@pingo/ui';
import { BookOpen, Bookmark, Brain, Check, ImageUp, Palette, PenLine, RotateCcw, ScanText, Sparkles, type LucideIcon } from 'lucide-react';
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

const ICONS: Record<AiStage, LucideIcon> = {
  remembering: Bookmark,
  reading: BookOpen,
  thinking: Brain,
  reconsidering: RotateCcw,
  reading_reply: ScanText,
  polishing: Sparkles,
  drawing: Palette,
  uploading: ImageUp,
  writing: PenLine,
};

/** The short words for a step already done, in the trail. */
const DONE: Record<AiStage, string> = {
  remembering: 'Saved',
  reading: 'Read',
  thinking: 'Thought',
  reconsidering: 'Rechecked',
  reading_reply: 'Checked',
  polishing: 'Tidied',
  drawing: 'Drew',
  uploading: 'Sent',
  writing: 'Wrote',
};

export function AiStatus({ stage }: { stage: AiStage }) {
  // The steps of this one turn, in order. A new turn starts from nothing, because the card unmounts between turns.
  const [trail, setTrail] = useState<AiStage[]>([stage]);
  useEffect(() => {
    setTrail((t) => (t[t.length - 1] === stage ? t : [...t.filter((s) => s !== stage), stage]));
  }, [stage]);

  const started = useRef(Date.now());
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setSecs(Math.floor((Date.now() - started.current) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);

  const Icon = ICONS[stage];
  const done = trail.slice(0, -1).slice(-2);

  return (
    <div
      role="status"
      className="ai-status lq-glass-water lq-read flex items-center gap-2.5 rounded-[20px] py-1.5 pr-3.5 pl-1.5"
    >
      <span className="relative grid size-8 shrink-0 place-items-center">
        <span aria-hidden className="ai-status-ring absolute inset-0 rounded-full" />
        <img src="/pingo-avatar.png" alt="" className="relative size-7 rounded-full object-cover" draggable={false} />
        <span className="absolute -right-1 -bottom-1 grid size-[18px] place-items-center rounded-full bg-brand text-on-brand shadow-[0_0_0_2px_var(--color-surface)]">
          <Icon key={stage} size={11} strokeWidth={2.6} className="ai-status-icon" aria-hidden />
        </span>
      </span>

      <span className="flex min-w-0 flex-col leading-tight">
        <span className="flex items-center gap-1.5">
          <span
            key={stage}
            className={cn(
              'ai-status-label truncate text-[13.5px] font-medium',
              'bg-clip-text text-transparent',
              'bg-[linear-gradient(100deg,var(--color-ink)_30%,var(--color-brand)_50%,var(--color-ink)_70%)]',
              'bg-[length:220%_100%] animate-ai-sweep',
              'motion-reduce:animate-none motion-reduce:bg-none motion-reduce:text-ink',
            )}
          >
            {AI_STAGES[stage]}
          </span>
          {secs >= 2 && <span className="text-[11.5px] tabular-nums text-text-tertiary">{secs}s</span>}
        </span>
        {done.length > 0 && (
          <span className="mt-0.5 flex items-center gap-2 text-[11px] text-text-tertiary">
            {done.map((s) => (
              <span key={s} className="ai-status-done inline-flex items-center gap-0.5">
                <Check size={10} strokeWidth={3} className="text-brand" aria-hidden />
                {DONE[s]}
              </span>
            ))}
          </span>
        )}
      </span>
      <span className="sr-only">PINGO AI: {AI_STAGES[stage]}.</span>

      <style>{`
.ai-status { animation: ai-status-in .32s var(--ease-standard, ease-out) both; }
@keyframes ai-status-in { from { opacity: 0; transform: translateY(6px) scale(.97); } }
.ai-status-ring { background: conic-gradient(from 0deg, var(--color-brand), transparent 40%, var(--color-brand) 70%, transparent); animation: ai-status-spin 1.6s linear infinite; mask: radial-gradient(circle, transparent 13.5px, #000 14px); -webkit-mask: radial-gradient(circle, transparent 13.5px, #000 14px); }
@keyframes ai-status-spin { to { transform: rotate(1turn); } }
.ai-status-icon, .ai-status-label { animation: ai-status-swap .28s var(--ease-standard, ease-out) both; }
.ai-status-label { animation: ai-status-swap .28s var(--ease-standard, ease-out) both, ai-sweep 2.2s linear infinite; }
@keyframes ai-status-swap { from { opacity: 0; transform: translateY(4px); } }
.ai-status-done { animation: ai-status-swap .3s var(--ease-standard, ease-out) both; }
@media (prefers-reduced-motion: reduce) { .ai-status, .ai-status-ring, .ai-status-icon, .ai-status-label, .ai-status-done { animation: none !important; } }
`}</style>
    </div>
  );
}
