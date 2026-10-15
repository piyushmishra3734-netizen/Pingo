import { TvMinimalPlay } from 'lucide-react';

/** Pingo TV: on its way. The tab already opens its own page; what goes in it comes later. */
export function PingoTvScreen() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-page">
      <header className="shrink-0 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-2">
        <h1 className="text-center text-[17px] font-semibold text-ink">Pingo TV</h1>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 pb-32 text-center">
        <span className="grid size-16 place-items-center rounded-full bg-brand/12 text-brand">
          <TvMinimalPlay size={30} aria-hidden />
        </span>
        <p className="text-[17px] font-semibold text-ink">Coming soon</p>
        <p className="max-w-[260px] text-[14px] text-text-secondary">Shows, clips and live from the people you follow, right here.</p>
      </div>
    </div>
  );
}
