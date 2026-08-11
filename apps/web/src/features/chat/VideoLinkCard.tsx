import { enrichVideoPreview, type VideoPreview } from '@pingo/core';
import { LinkIcon, PlayIcon, cn } from '@pingo/ui';
import { useEffect, useState } from 'react';

/**
 * A video link, drawn as the video it points at.
 *
 * ## Nothing loads until somebody asks
 *
 * The card is built entirely from the URL, so it is complete on first paint -
 * there is no spinner for it, because there is nothing to wait for. The player
 * is only mounted when the play button is pressed.
 *
 * That is not only a performance decision. Mounting a YouTube or Instagram
 * frame tells Google or Meta that this person is looking at this video, and
 * doing it on render would tell them that about every link in a thread somebody
 * merely scrolled past. Click-to-play means the only videos those companies
 * learn about are the ones actually watched, which is the same bargain the
 * reader would make if asked.
 *
 * ## Where the frame's address comes from
 *
 * `embedUrl` is built by a provider out of an id that has been matched against
 * a fixed character class, onto a host that is a constant in our own source. No
 * part of what a sender typed reaches this `src`. That is the reason a hostile
 * link cannot become a hostile frame, and it is worth keeping in mind before
 * anyone is tempted to pass a URL through from the message.
 */

export interface VideoLinkCardProps {
  preview: VideoPreview;
  /** Extra bottom margin when the message's own text follows. */
  spaced?: boolean;
}

const PLATFORM: Record<VideoPreview['platform'], { label: string; tint: string }> = {
  youtube: { label: 'YouTube', tint: 'bg-[#ff0033]' },
  // Instagram's mark is a gradient, and a flat pink reads as the wrong app.
  instagram: {
    label: 'Instagram',
    tint: 'bg-[linear-gradient(45deg,#f9ce34,#ee2a7b_45%,#6228d7)]',
  },
  snapchat: { label: 'Snapchat', tint: 'bg-[#fffc00]' },
};

/** Stops the bubble's own tap, which would open the reaction bar. */
const swallow = {
  onClick: (event: React.MouseEvent) => event.stopPropagation(),
  onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
};

export function VideoLinkCard({ preview, spaced }: VideoLinkCardProps) {
  const [playing, setPlaying] = useState(false);
  const [details, setDetails] = useState(preview);
  /*
   * A thumbnail that 404s.
   *
   * `hqdefault` exists for every YouTube video, so this is the unusual case -
   * a deleted video, or a network that served an error page. Tracked because
   * the alternative is a broken-image glyph inside an otherwise finished card,
   * which looks like the feature is broken rather than like the video is gone.
   */
  const [thumbFailed, setThumbFailed] = useState(false);

  const platform = PLATFORM[preview.platform];
  const thumbnail = thumbFailed ? undefined : details.thumbnailUrl;

  useEffect(() => {
    let live = true;
    // Resolves to the preview either way, so there is no failure branch: a
    // platform that publishes nothing simply leaves the card as it was.
    void enrichVideoPreview(preview).then((full) => {
      if (live) setDetails(full);
    });
    return () => {
      live = false;
    };
  }, [preview]);

  const frameAspect = preview.platform === 'instagram' ? 'aspect-[4/5]' : 'aspect-video';

  return (
    <div
      className={cn(
        'w-full overflow-hidden rounded-lg border border-line bg-sunken',
        spaced && 'mb-2',
      )}
      {...swallow}
    >
      <div className={cn('relative w-full bg-black', frameAspect)}>
        {playing && preview.embedUrl ? (
          <iframe
            src={preview.embedUrl}
            title={details.title ?? `${platform.label} video`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            // The embed does not need to know which conversation this was in.
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute inset-0 size-full border-0"
          />
        ) : (
          <Cover
            preview={preview}
            thumbnail={thumbnail}
            label={platform.label}
            onThumbnailError={() => setThumbFailed(true)}
            onPlay={() => setPlaying(true)}
          />
        )}
      </div>

      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span
          aria-hidden
          className={cn('size-2 shrink-0 rounded-full', platform.tint)}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-caption font-medium text-ink">
            {details.title ?? `${platform.label} video`}
          </span>
          {details.author && (
            <span className="block truncate pt-0.5 text-caption text-text-secondary">
              {details.author}
            </span>
          )}
        </span>
        <a
          href={details.canonicalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-ring shrink-0 rounded-full px-2 py-0.5 text-caption font-medium text-brand"
        >
          Open
        </a>
      </div>
    </div>
  );
}

/**
 * What sits there before anybody presses play.
 *
 * Two jobs in one element, and which one it does depends on whether the
 * platform lets us play at all. With an embed it is a button; without one it is
 * a link straight out to the platform - so a Snapchat card is not a play button
 * that apologises, it is a card that opens Snapchat.
 */
function Cover({
  preview,
  thumbnail,
  label,
  onThumbnailError,
  onPlay,
}: {
  preview: VideoPreview;
  thumbnail: string | undefined;
  label: string;
  onThumbnailError: () => void;
  onPlay: () => void;
}) {
  const inner = (
    <>
      {thumbnail ? (
        <img
          src={thumbnail}
          alt=""
          loading="lazy"
          onError={onThumbnailError}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        /*
         * No picture to show, and none to be had - see the Instagram provider.
         * A neutral field with the platform named on it is honest about that;
         * a grey box with a broken-image glyph would look like a failure.
         */
        <span className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_50%_35%,rgb(255_255_255/0.14),transparent_70%)]">
          <span className="flex items-center gap-1.5 text-caption font-medium text-white/70">
            <LinkIcon size={14} />
            {label}
          </span>
        </span>
      )}

      {/* A scrim under the glyph, so it stays visible on a pale thumbnail. */}
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgb(0_0_0/0.34),transparent_65%)]" />

      <span
        className={cn(
          'absolute top-1/2 left-1/2 grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center',
          'rounded-full bg-black/45 text-white backdrop-blur-sm',
          'transition-transform duration-instant ease-standard group-active:scale-95',
        )}
      >
        <PlayIcon size={24} />
      </span>
    </>
  );

  if (!preview.embedUrl) {
    return (
      <a
        href={preview.canonicalUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open on ${label}`}
        className="group focus-ring absolute inset-0 block"
      >
        {inner}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label={`Play ${label} video`}
      className="group focus-ring absolute inset-0 block w-full"
    >
      {inner}
    </button>
  );
}
