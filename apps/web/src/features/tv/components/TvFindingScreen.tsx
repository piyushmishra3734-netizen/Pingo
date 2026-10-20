import { Info } from 'lucide-react';
import { cn } from '@pingo/ui';

/**
 * What the viewer sees while a provider is being found: the artwork, blurred,
 * with a ring spinner and a plain explanation. Pure display, it knows nothing
 * about how sources are probed.
 */
export function TvFindingScreen({ compact = false }: { compact?: boolean }) {
  return (
    <div className="absolute inset-0 z-10 overflow-hidden bg-black" role="status" aria-live="polite">
      <img
        src="/tv/loading-bg.webp"
        alt=""
        aria-hidden
        draggable={false}
        className="absolute inset-0 h-full w-full scale-110 object-cover blur-[6px]"
      />
      <div className="absolute inset-0 bg-black/30" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30" />

      <div className="relative grid h-full place-items-center px-5">
        <div className="flex max-w-md flex-col items-center text-center">
          <div
            className={cn(
              'animate-spin rounded-full border-white/15 border-t-white motion-reduce:animate-none',
              compact ? 'size-7 border-[3px]' : 'size-14 border-4',
            )}
          />
          <h4
            className={cn(
              'font-bold tracking-tight text-white',
              compact ? 'mt-2 text-[12px] leading-tight' : 'mt-5 text-xl sm:text-2xl',
            )}
          >
            We&apos;re finding the best provider for you
          </h4>
          {!compact && (
            <>
              <p className="mt-2 text-sm text-white/70">Please wait, this will take a few seconds...</p>
              <p className="mt-5 flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs text-white/80 ring-1 ring-white/15 backdrop-blur-md">
                <Info className="size-3.5 shrink-0" />
                It depends on your device and network speed.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
