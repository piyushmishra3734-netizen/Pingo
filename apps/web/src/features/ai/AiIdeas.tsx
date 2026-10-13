import { FileText, Globe, ImageIcon, Lightbulb } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * What PINGO AI can do, shown in an empty chat the way Muse shows its ideas.
 * Each one starts the matching command in the composer.
 */
const IDEAS: { command: string; title: string; body: string; icon: ReactNode; tint: string }[] = [
  {
    command: '/search ',
    title: 'Search the web',
    body: 'News, scores, prices or the weather, checked live with sources.',
    icon: <Globe size={18} aria-hidden />,
    tint: 'bg-[color-mix(in_srgb,#3b6cf6_15%,transparent)] text-[#3b6cf6]',
  },
  {
    command: '/image ',
    title: 'Create an image',
    body: "Posters, stickers, wallpapers. Or send a photo and I'll edit it.",
    icon: <ImageIcon size={18} aria-hidden />,
    tint: 'bg-[color-mix(in_srgb,#d6336c_15%,transparent)] text-[#d6336c]',
  },
  {
    command: '/summarize ',
    title: 'Read photos and PDFs',
    body: 'A bill, a form, notes or a screenshot. Ask me anything about it.',
    icon: <FileText size={18} aria-hidden />,
    tint: 'bg-[color-mix(in_srgb,#c27803_15%,transparent)] text-[#c27803]',
  },
  {
    command: '/remember ',
    title: 'Remember what matters',
    body: "Tell me once, like your exam date, and I'll keep it in mind.",
    icon: <Lightbulb size={18} aria-hidden />,
    tint: 'bg-[color-mix(in_srgb,#17845f_15%,transparent)] text-[#17845f]',
  },
];

export function AiIdeas({ name, onPick }: { name?: string | undefined; onPick: (text: string) => void }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 pb-2">
      <div className="text-center">
        <h2 className="text-[26px] font-bold tracking-[-0.02em] text-ink">{name ? `Hey ${name}` : 'Hey there'}</h2>
        <p className="mt-1 text-[15px] font-medium text-text-secondary">What should we do today?</p>
      </div>
      <div className="rounded-[26px] bg-surface py-1.5 shadow-sm ring-1 ring-line">
        <p className="px-[18px] pb-0.5 pt-2.5 text-[13px] font-bold uppercase tracking-[0.04em] text-text-secondary">Ideas</p>
        <ul>
          {IDEAS.map((idea, i) => (
            <li key={idea.command}>
              {i > 0 && <div aria-hidden className="ml-[65px] h-px bg-line" />}
              <button
                type="button"
                onClick={() => onPick(idea.command)}
                className="flex w-full items-start gap-[13px] px-[18px] py-3 text-left active:bg-hover"
              >
                <span className={`grid size-[34px] shrink-0 place-items-center rounded-[11px] ${idea.tint}`}>{idea.icon}</span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-bold text-ink">{idea.title}</span>
                  <span className="text-[13.5px] leading-snug text-text-secondary">{idea.body}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
