import { cn } from '@pingo/ui';

/**
 * Official platform marks for the download page.
 *
 * Self-hosted under `/brands` so the page does not depend on a third-party
 * icon CDN. Geometry matches the public Simple Icons paths for Android, Apple
 * and Windows; web is a brand-tinted globe so it does not imply one browser.
 *
 * Apple is painted with a CSS mask so it follows `text-ink` in light and dark
 * without shipping two assets.
 */

export type PlatformLogoId = 'android' | 'ios' | 'macos' | 'windows' | 'web';

interface PlatformLogoProps {
  platform: PlatformLogoId;
  /** Outer tile size in px. */
  size?: number;
  className?: string;
}

const LABELS: Record<PlatformLogoId, string> = {
  android: 'Android',
  ios: 'Apple',
  macos: 'Apple',
  windows: 'Windows',
  web: 'Web',
};

const SRC: Record<PlatformLogoId, string> = {
  android: '/brands/android.svg',
  ios: '/brands/apple.svg',
  macos: '/brands/apple.svg',
  windows: '/brands/windows.svg',
  web: '/brands/web.svg',
};

function isApple(platform: PlatformLogoId): boolean {
  return platform === 'ios' || platform === 'macos';
}

export function PlatformLogo({ platform, size = 40, className }: PlatformLogoProps) {
  const logoSize = Math.round(size * 0.52);
  const src = SRC[platform];

  return (
    <span
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-xl',
        'ring-1',
        platform === 'android' && 'bg-[#3DDC84]/12 ring-[#3DDC84]/22',
        platform === 'windows' && 'bg-[#0078D4]/12 ring-[#0078D4]/22',
        isApple(platform) && 'bg-ink/[0.045] ring-ink/10',
        platform === 'web' && 'bg-brand/10 ring-brand/18',
        className,
      )}
      style={{ width: size, height: size }}
      role="img"
      aria-label={LABELS[platform]}
    >
      {isApple(platform) ? (
        <span
          aria-hidden
          className="bg-ink"
          style={{
            width: logoSize,
            height: logoSize,
            WebkitMaskImage: `url(${src})`,
            maskImage: `url(${src})`,
            WebkitMaskSize: 'contain',
            maskSize: 'contain',
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
            WebkitMaskPosition: 'center',
            maskPosition: 'center',
          }}
        />
      ) : (
        <img
          src={src}
          alt=""
          width={logoSize}
          height={logoSize}
          draggable={false}
          className="object-contain"
          aria-hidden
        />
      )}
    </span>
  );
}
