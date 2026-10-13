/**
 * What PINGO AI can do, in an empty chat, as Muse shows its Ideas: one white
 * card, a picture and two lines per idea, hairlines between them. Each one
 * starts the matching command in the composer.
 */
const IDEAS: { command: string; emoji: string; title: string; body: string }[] = [
  {
    command: '/search ',
    emoji: '🔎',
    title: 'I can look things up for you',
    body: "News, match scores, prices or tomorrow's weather, checked live, with the sites I used.",
  },
  {
    command: '/image ',
    emoji: '🎨',
    title: 'I can make pictures',
    body: "Posters, stickers and wallpapers from a line of text. Send me a photo and I'll edit it too.",
  },
  {
    command: '/summarize ',
    emoji: '📄',
    title: 'I can read your files',
    body: 'Send a bill, a form, notes or a screenshot and ask me anything about it.',
  },
  {
    command: '/remember ',
    emoji: '🧠',
    title: 'I can remember what matters',
    body: "Tell me once, like your exam date or a friend's birthday, and I'll keep it in mind.",
  },
];

export function AiIdeas({ name, onPick }: { name?: string | undefined; onPick: (text: string) => void }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 pb-2">
      <div className="text-center">
        <h2 className="text-[28px] font-bold tracking-[-0.02em] text-[var(--room-ink)]">{name ? `Hey ${name}` : 'Hey there'}</h2>
        <p className="mt-1 text-[16px] text-[var(--room-sub)]">What should we do today?</p>
      </div>
      <div className="rounded-[30px] bg-[var(--room-panel)] px-5 pb-2 pt-5 text-[#15171c] shadow-[0_10px_30px_-12px_rgb(0_0_0/0.25)]">
        <h3 className="mb-1 text-[22px] font-medium tracking-[-0.01em]">Ideas</h3>
        <ul>
          {IDEAS.map((idea, i) => (
            <li key={idea.command} className={i > 0 ? 'ml-[46px] border-t border-black/[0.08]' : 'ml-[46px]'}>
              <button
                type="button"
                onClick={() => onPick(idea.command)}
                className="-ml-[46px] flex w-[calc(100%+46px)] items-start gap-4 py-4 text-left active:opacity-70"
              >
                <span aria-hidden className="w-[30px] shrink-0 pt-0.5 text-center text-[26px] leading-none">
                  {idea.emoji}
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-[16.5px] font-semibold leading-snug">{idea.title}</span>
                  <span className="text-[14.5px] leading-snug text-[#7a7d86]">{idea.body}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
