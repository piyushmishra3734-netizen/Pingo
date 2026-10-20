import { cn } from '@pingo/ui';

/**
 * The PINGO Music mark, wherever the product names itself or stands in for a
 * song's cover: the song card's corner, a picture-less song, "listening on
 * PINGO Music". One place, so it changes everywhere together.
 */
export function MusicMark({ size = 16, className }: { size?: number; className?: string }) {
  return <img src="/music/logo.png" alt="" aria-hidden draggable={false} width={size} height={size} className={cn('shrink-0 select-none object-contain', className)} style={{ width: size, height: size }} />;
}
