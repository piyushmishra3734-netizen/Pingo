import { enrichVideoPreview, fileNameFrom, type VideoPreview } from '@pingo/core';
import { LinkIcon, PlayIcon, cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

import { canResolveMedia, resolveMedia } from '../../lib/video/resolve-media.js';
import { saveVideo, saveVideoBlob } from '../native/save-video.js';
import { keepVideo, storedVideo } from './video-vault.js';

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
  /**
   * The message this link arrived in.
   *
   * The key a kept copy is filed under, so Save persists into the same vault a
   * sent video file uses rather than inventing a second one - and so a video
   * kept once is found again on the next open, with the network off, without
   * asking any resolver anything.
   */
  messageId: string;
  /** Extra bottom margin when the message's own text follows. */
  spaced?: boolean;
}

/*
 * `label` names the platform, `untitled` is what the footer says when nothing
 * published a title.
 *
 * Two fields rather than `${label} video`, which read as "Video video" on a
 * plain file - the one platform whose name is already the word. Composing a
 * sentence out of a noun works right up until the noun is the sentence.
 */
const PLATFORM: Record<
  VideoPreview['platform'],
  { label: string; untitled: string; tint: string }
> = {
  youtube: { label: 'YouTube', untitled: 'YouTube video', tint: 'bg-[#ff0033]' },
  // Instagram's mark is a gradient, and a flat pink reads as the wrong app.
  instagram: {
    label: 'Instagram',
    untitled: 'Instagram video',
    tint: 'bg-[linear-gradient(45deg,#f9ce34,#ee2a7b_45%,#6228d7)]',
  },
  snapchat: { label: 'Snapchat', untitled: 'Snapchat video', tint: 'bg-[#fffc00]' },
  // No platform behind it, so it borrows PINGO's own colour rather than
  // pretending to be from somewhere.
  direct: { label: 'Video', untitled: 'Video', tint: 'bg-brand' },
};

/** Seconds as `m:ss`, or `h:mm:ss` once there is an hour to show. */
function clock(total: number): string {
  const whole = Math.floor(total);
  const s = String(whole % 60).padStart(2, '0');
  const m = Math.floor(whole / 60) % 60;
  const h = Math.floor(whole / 3600);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * Four corners pointing out. Drawn here rather than added to the icon set,
 * because it is the only place in the product that needs one.
 */
function ExpandIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={17}
      height={17}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

/** Stops the bubble's own tap, which would open the reaction bar. */
const swallow = {
  onClick: (event: React.MouseEvent) => event.stopPropagation(),
  onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
};

export function VideoLinkCard({ preview, messageId, spaced }: VideoLinkCardProps) {
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
  /*
   * The file would not play.
   *
   * The extension was a guess - see the `direct` provider - so this is the
   * cheap direction being wrong: a `.mp4` that is a redirect page, a codec the
   * browser will not take, a host that is gone. Falling back to the ordinary
   * card means the message still offers the link, which is exactly what it
   * would have done had the guess never been made.
   */
  const [broken, setBroken] = useState(false);

  /*
   * The media behind a platform link, once a resolver has found it.
   *
   * Separate from `preview.fileUrl`, which the `direct` provider fills from the
   * URL alone. Both end up in the same place - `file` below - so everything
   * downstream stops caring where a playable video came from, which is what
   * lets a YouTube link and an `.mp4` link render as the same thing.
   */
  const [resolved, setResolved] = useState<string>();
  const [resolving, setResolving] = useState(false);

  /*
   * The copy this device already keeps, if Save was pressed before.
   *
   * Looked for on mount and preferred over everything else: a kept video needs
   * no resolver, no platform, and no network. It is also the only path that
   * still works on a plane, which is the whole point of having kept it.
   */
  const [kept, setKept] = useState<string>();

  useEffect(() => {
    let live = true;
    let object: string | undefined;

    void storedVideo(messageId).then((blob) => {
      if (!live || !blob) return;
      object = URL.createObjectURL(blob);
      setKept(object);
    });

    return () => {
      live = false;
      // Revoked on unmount, or a long thread leaks a blob per video scrolled.
      if (object) URL.revokeObjectURL(object);
    };
  }, [messageId]);

  const file = kept ?? preview.fileUrl ?? resolved;

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

  /*
   * A portrait video should not sit in a landscape box.
   *
   * 16:9 is the right guess before anything is known, and the wrong shape for
   * the thing people most want to send - a phone-shot clip or a reel, which
   * ends up as a stamp between two black bars.
   *
   * The correction lands when playback starts rather than on first paint,
   * because `preload="none"` is the whole privacy position here: the file's
   * dimensions are inside the file, and fetching them for a link nobody has
   * opened would tell an arbitrary host that this person is reading this
   * thread. A moment of the wrong box is worth more than that request.
   *
   * Clamped rather than trusted: a very tall video would otherwise take over
   * the whole thread, and one pixel high would collapse the card.
   */
  const [ratio, setRatio] = useState<number>();
  /** Read off the file once it loads. No platform publishes this up front. */
  const [seconds, setSeconds] = useState<number>();
  const videoRef = useRef<HTMLVideoElement>(null);

  const frameAspect =
    ratio === undefined
      ? preview.platform === 'instagram'
        ? 'aspect-[4/5]'
        : 'aspect-video'
      : undefined;

  return (
    <div
      className={cn(
        /*
         * `bg-surface`, not `bg-sunken`.
         *
         * Sunken is translucent once a wallpaper is behind the thread, so the
         * bubble's own colour came straight through the footer - on a sent
         * message that meant a pink strip with a pink "Open" on it, which was
         * legible only if you already knew it was there. Surface is the app's
         * opaque panel, and it is the one the wallpaper-dark rule re-inks, so
         * the card reads the same on either side of the thread and in either
         * theme.
         */
        'w-full overflow-hidden rounded-lg border border-line bg-surface',
        spaced && 'mb-2',
      )}
      {...swallow}
    >
      <div
        className={cn('relative w-full bg-black', frameAspect)}
        {...(ratio === undefined ? {} : { style: { aspectRatio: String(ratio) } })}
      >
        {file && !broken ? (
          /*
            Ours to play, so we play it.

            `preload="none"` is the same bargain the other platforms get from
            click-to-play: until somebody presses play, the host that serves
            this file learns nothing about who is reading the thread. The
            browser's own controls come with a scrubber, fullscreen and
            picture-in-picture already matching what the phone does elsewhere -
            the same reasoning `FileBubble` uses for an attached video.
          */
          <video
            ref={videoRef}
            src={file}
            controls
            // Resolved on tap means the person is already waiting for this one,
            // so it loads now rather than after a second press.
            autoPlay={resolved !== undefined}
            preload="none"
            playsInline
            onLoadedMetadata={(event) => {
              const media = event.currentTarget;
              if (!media.videoWidth || !media.videoHeight) return;
              // 9:16 at the tall end, 16:9 at the wide - past either the card
              // stops being a card and starts being the screen.
              const shape = media.videoWidth / media.videoHeight;
              setRatio(Math.min(Math.max(shape, 9 / 16), 16 / 9));
              if (Number.isFinite(media.duration)) setSeconds(media.duration);
            }}
            onError={() => setBroken(true)}
            className="absolute inset-0 size-full object-contain"
          />
        ) : playing && preview.embedUrl ? (
          <iframe
            src={preview.embedUrl}
            title={details.title ?? platform.untitled}
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
            busy={resolving}
            onPlay={() => {
              /*
               * Ask for the real video first, fall back to the frame.
               *
               * With no resolver configured this is one synchronous check and
               * the embed opens exactly as before - which is the behaviour
               * every install has until somebody points it at an endpoint.
               */
              if (!canResolveMedia()) {
                setPlaying(true);
                return;
              }

              setResolving(true);
              void resolveMedia(preview.canonicalUrl)
                .then((found) => {
                  // Nothing found is not a failure worth showing: the embed is
                  // a working video, and it is what would have played anyway.
                  if (found) setResolved(found);
                  else setPlaying(true);
                })
                .finally(() => setResolving(false));
            }}
          />
        )}

        {file && !broken && (
          /*
            A fullscreen control of our own, over the player.

            The browser's own controls already carry one, and on a phone it is
            a 20px target in a strip that hides itself. This is the same call
            the player makes, at a size somebody can actually hit, and it asks
            the *container* rather than the video element so the card's own
            background fills the screen instead of leaving bars around a
            portrait clip.

            `webkitEnterFullscreen` is the iOS path: Safari on iPhone refuses
            `requestFullscreen` on anything and only ever fullscreens a video
            element directly. Both are attempted, neither is required.
          */
          <button
            type="button"
            aria-label="Fullscreen"
            onClick={() => {
              const media = videoRef.current;
              const box = media?.parentElement;
              type Legacy = HTMLVideoElement & { webkitEnterFullscreen?: () => void };
              if (box?.requestFullscreen) void box.requestFullscreen().catch(() => undefined);
              else (media as Legacy | null)?.webkitEnterFullscreen?.();
            }}
            className={cn(
              'absolute top-2 right-2 grid size-9 place-items-center rounded-full',
              'bg-black/45 text-white backdrop-blur-sm',
              'focus-ring transition-transform duration-instant ease-standard active:scale-95',
            )}
          >
            <ExpandIcon />
          </button>
        )}

        {/* Duration, once the file has told us. Bottom right, as on a reel. */}
        {file && !broken && seconds !== undefined && (
          <span className="pointer-events-none absolute right-2 bottom-2 rounded-md bg-black/55 px-1.5 py-0.5 text-caption font-medium text-white tabular-nums">
            {clock(seconds)}
          </span>
        )}

      </div>


      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span
          aria-hidden
          className={cn('size-2 shrink-0 rounded-full', platform.tint)}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-caption font-medium text-ink">
            {details.title ?? platform.untitled}
          </span>
          {details.author && (
            <span className="block truncate pt-0.5 text-caption text-text-secondary">
              {details.author}
            </span>
          )}
        </span>
        {/*
          Save on a real file, Open on everything else.

          Not both. An embed is somebody else's page in a frame, so there is
          nothing to write to storage and a Save on one would be a button that
          cannot keep its promise. A file, conversely, does not need Open -
          "open the video" is what the player already is.
        */}
        {/* Nothing to save once it is already kept - it is on the device. */}
        {file && !broken && !kept ? (
          <SaveButton
            messageId={messageId}
            url={file}
            // Play from the kept copy straight away, so the video does not
            // reload from the network the moment it stopped needing to.
            onKept={(blob) => setKept(URL.createObjectURL(blob))}
          />
        ) : kept ? (
          <span className="shrink-0 px-2 py-0.5 text-caption font-medium text-text-secondary">
            Saved
          </span>
        ) : (
          <a
            href={details.canonicalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring shrink-0 rounded-full px-2 py-0.5 text-caption font-medium text-brand"
          >
            Open
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Save, and the honest state in between.
 *
 * A video is large enough that the gap between pressing and finishing is real,
 * so the button says which of the three it is in. It settles on "Saved" rather
 * than returning to "Save": having pressed it, the question a person has is
 * whether it worked, and a button that resets answers a question nobody asked.
 *
 * Three ways it can end, and the label says which. The vault writing the file
 * is "Saved"; a host with no CORS headers means the bytes never reach this page
 * at all, so the URL goes to the platform and that is "Opened"; and if even
 * that does nothing, "Couldn't save" - because a card that claims a copy it
 * does not have is a video missing the next time the network is.
 */
const SAVE_LABEL = {
  idle: 'Save',
  saving: 'Saving…',
  saved: 'Saved',
  // The page could not read the bytes - usually a host that sends no CORS
  // headers - so the platform was handed the URL instead. The video is in a
  // tab, not on the device, and saying "Saved" over that is the lie this
  // module was written against.
  opened: 'Opened',
  // Not even that worked. Nothing was written and nothing was opened.
  failed: "Couldn't save",
} as const;

/**
 * Save, meaning the video is on this device afterwards.
 *
 * Two shelves, one download. `keepVideo` writes it into the vault a sent video
 * file already uses, which is what makes it play with the network off and what
 * survives a reload; the same blob is then offered to the gallery so it is a
 * video the phone knows about too, and not only something inside PINGO.
 *
 * The gallery half is allowed to fail quietly. It needs the native bridge, so
 * on the web and on an older build it simply does not happen - but the copy
 * that matters, the one that plays offline, is already written by then.
 */
function SaveButton({
  messageId,
  url,
  onKept,
}: {
  messageId: string;
  url: string;
  onKept: (blob: Blob) => void;
}) {
  const [state, setState] = useState<keyof typeof SAVE_LABEL>('idle');

  return (
    <button
      type="button"
      disabled={state === 'saving' || state === 'saved'}
      onClick={() => {
        setState('saving');
        void keepVideo(messageId, url).then(async (blob) => {
          if (blob) {
            setState('saved');
            onKept(blob);
            // The gallery half may quietly not happen - it needs the native
            // bridge - but the copy that plays offline is already written.
            void saveVideoBlob(blob, fileNameFrom(url));
            return;
          }

          /*
           * The vault could not read it, which for a raw link on a host with
           * no CORS headers is the normal answer rather than an error. There
           * is nothing to persist, but the platform can still fetch it, so the
           * URL is handed over and the label says which of the two happened.
           */
          setState(await saveVideo(url, fileNameFrom(url)) === 'saved' ? 'saved' : 'opened');
        });
      }}
      className={cn(
        'focus-ring shrink-0 rounded-full px-2 py-0.5 text-caption font-medium',
        state === 'failed'
          ? 'text-danger'
          : state === 'saved' || state === 'opened'
            ? 'text-text-secondary'
            : 'text-brand',
      )}
    >
      {SAVE_LABEL[state]}
    </button>
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
  busy,
}: {
  preview: VideoPreview;
  thumbnail: string | undefined;
  label: string;
  onThumbnailError: () => void;
  onPlay: () => void;
  /** Fetching the real video. The glyph says so rather than looking ignored. */
  busy?: boolean;
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
        {/*
          Fetching a video takes long enough that a still play button reads as
          a tap that missed. The same disc keeps its place and spins, so the
          card does not move while somebody waits.
        */}
        {busy ? (
          <span className="size-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        ) : (
          <PlayIcon size={24} />
        )}
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
      // A second tap while the first is still resolving would start another
      // extraction of the same video, which the resolver charges for twice.
      disabled={busy}
      aria-label={busy ? 'Getting video' : `Play ${label} video`}
      className="group focus-ring absolute inset-0 block w-full"
    >
      {inner}
    </button>
  );
}
