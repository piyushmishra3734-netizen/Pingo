import {
  formatFileSize,
  useChat,
  type AudioAttachment,
  type FileAttachment,
  type VideoEdit,
} from '@pingo/core';
import { FileIcon, PlayIcon, cn } from '@pingo/ui';
import { useEffect, useMemo, useState } from 'react';

import { saveImage } from '../native/save-image.js';
import { saveVideoBlob } from '../native/save-video.js';
import { makeVideoPoster } from './media-variants.js';
import { keepMedia, keepVideo, putPoster, storedPoster, storedVideo } from './video-vault.js';
import { VideoPlayer } from './VideoPlayer.js';
import { VoiceNote } from './VoiceNote.js';
import { ImageViewer } from '../profile/ImageViewer.js';

/**
 * An attached file, rendered as whatever it actually is.
 *
 * ## Why a filename was not enough
 *
 * Everything that is not a photo or a voice note arrives here as `kind: 'file'`
 * - a PDF, a spreadsheet, and also a video, an image and a song somebody sent
 * through the document picker instead of the camera. All of them rendered as
 * the same grey card with a name on it, so a video you were sent was a
 * download, a picture you were sent was a filename, and a piece of music was a
 * thing you had to save before you could hear it. The card is right for a
 * document and wrong for the three kinds that can simply be played or shown.
 *
 * ## The mime type decides, not the extension
 *
 * A name can lie or be missing; the stored type is what the upload actually
 * declared. Anything unrecognised falls through to the card, which is the safe
 * end of the branch: a document that will not play is normal, a video rendered
 * as a broken player is not.
 */

export interface FileBubbleProps {
  file: FileAttachment;
  mine: boolean;
  /** Extra bottom margin when a caption follows. */
  spaced?: boolean;
  /**
   * The message this file arrived on.
   *
   * Needed only by video, and only to tell the server the copy is safely here -
   * the receipt is keyed on the message, not on the attachment.
   */
  messageId?: string;
  /** Playback marks the sender chose. Applied by the player, never to the file. */
  edit?: VideoEdit;
}

/** Stops the bubble's own tap, which opens the reaction bar. */
const swallow = {
  onClick: (event: React.MouseEvent) => event.stopPropagation(),
  onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
};

export function FileBubble({ file, mine, spaced, messageId, edit }: FileBubbleProps) {
  const { service } = useChat();
  const [viewing, setViewing] = useState(false);
  /*
   * Four states, not a boolean, for the reason `GallerySave` gives further down
   * this file: a save that fails has to say so. It used to discard the failure
   * and leave the label reading "Save", so an expired signed URL, an offline
   * fetch or a refused permission all looked like a button that does nothing.
   */
  const [save, setSave] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  /** The local copy's object URL, once this device has the file. */
  const [localHref, setLocalHref] = useState<string>();
  /*
   * The image source that would not load, if one has.
   *
   * An image attachment is drawn as the picture itself, so once PINGO's copy
   * has been collected at twenty-four hours the bubble becomes a broken frame
   * that never recovers. Falling back to the ordinary file row is the honest
   * shape: the message is still there, its name is still there, the picture is
   * not. Keyed on the url rather than a flag so a re-signed link tries again.
   */
  const [gone, setGone] = useState<string>();

  /*
   * A document lives on the device as well, and by the same rule as everything
   * else: the whole file, written before anything is confirmed.
   *
   * Videos have their own hook because they also need a player; images use the
   * picture path. This is the plain-file case, which used to be the one kind of
   * media the server had to keep for ever - the link pointed at PINGO's copy
   * and nothing ever released it.
   */
  useEffect(() => {
    if (!messageId || !file.url) return;
    if (
      file.mimeType.startsWith('video/') ||
      file.mimeType.startsWith('image/') ||
      // Audio has a player of its own below, and that player writes the vault
      // and reports the receipt itself. Doing it here as well would download
      // the same song twice.
      file.mimeType.startsWith('audio/')
    ) {
      return;
    }

    let live = true;
    let made: string | undefined;

    void (async () => {
      const blob = await keepMedia(messageId, file.url);
      if (!blob || !live) return;
      made = URL.createObjectURL(blob);
      setLocalHref(made);
      void service.confirmMediaReceived?.(messageId).catch(() => undefined);
    })();

    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
    // `service` is stable for the life of the app; listing it would re-run this
    // on every provider render and re-download the file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId, file.url, file.mimeType]);

  const mime = file.mimeType;
  const name = file.fileName || 'File';

  if (mime.startsWith('video/') && file.url) {
    return (
      <VideoBubble file={file} name={name} spaced={spaced} messageId={messageId} edit={edit} />
    );
  }

  if (mime.startsWith('audio/') && file.url) {
    return <AudioBubble file={file} name={name} mine={mine} spaced={spaced} messageId={messageId} />;
  }

  if (mime.startsWith('image/') && file.url && gone !== file.url) {
    return (
      <div className={cn('w-full', spaced && 'mb-2')} {...swallow}>
        <button
          type="button"
          onClick={() => setViewing(true)}
          aria-label={`Open image: ${name}`}
          className={cn(
            'focus-ring block w-full overflow-hidden rounded-lg',
            'transition-transform duration-instant active:scale-[0.99]',
          )}
        >
          <img
            src={file.url}
            alt={name}
            // Same reason as the photo bubble's: an off-screen picture must
            // not spend bytes before anybody scrolls to it.
            loading="lazy"
            decoding="async"
            onContextMenu={(event) => event.preventDefault()}
            // Collected after its 24 hours, or a signature that no longer
            // opens it. Falling through to the file row below says so; a
            // broken picture in the thread says nothing. See `gone`.
            onError={() => setGone(file.url)}
            className="max-h-[22rem] w-full rounded-lg object-cover"
          />
        </button>

        {viewing && (
          <ImageViewer
            src={file.url}
            alt={name}
            onClose={() => {
              setViewing(false);
              setSave('idle');
            }}
            footer={
              <div className="flex justify-center">
                <button
                  type="button"
                  disabled={save === 'saving'}
                  onClick={() => {
                    setSave('saving');
                    void fetch(file.url)
                      .then((response) => response.blob())
                      .then(async (blob) => {
                        setSave((await saveImage(blob, name)) ? 'saved' : 'failed');
                      })
                      .catch(() => setSave('failed'));
                  }}
                  className={cn(
                    'focus-ring rounded-full px-5 py-2.5',
                    'bg-white/12 text-body text-white backdrop-blur-glass',
                    'transition-transform duration-instant active:scale-95',
                  )}
                >
                  {save === 'saved'
                    ? 'Saved to your photos'
                    : save === 'failed'
                      ? "Couldn't save"
                      : save === 'saving'
                        ? 'Saving…'
                        : 'Save'}
                </button>
              </div>
            }
          />
        )}
      </div>
    );
  }

  return (
    /*
     * A file you cannot open is a filename.
     *
     * `download` asks for the original name back, because the storage key is a
     * uuid and saving `9f3c-…` helps nobody.
     */
    <a
      // The device's own copy when there is one - which after the server has
      // let go is the only one there is.
      href={localHref ?? file.url}
      download={name}
      target="_blank"
      rel="noopener noreferrer"
      {...swallow}
      className={cn(
        'focus-ring -m-1 flex items-center gap-3 rounded-lg p-1',
        'transition-opacity duration-instant hover:opacity-80',
        spaced && 'mb-2',
      )}
    >
      <span
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-md',
          mine ? 'bg-white/20 text-white' : 'bg-surface text-brand',
        )}
        aria-hidden
      >
        <FileIcon size={20} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-body">{name}</span>
        {file.size !== undefined && (
          <span
            className={cn('block text-caption', mine ? 'text-white/70' : 'text-text-secondary')}
          >
            {formatFileSize(file.size)}
          </span>
        )}
      </span>
    </a>
  );
}

/**
 * A song, a recording, a voice memo somebody had saved - anything audio.
 *
 * ## Why it borrows the voice note
 *
 * `VoiceNote` is already the answer to "play this audio, from the device's copy
 * when there is one, re-signing the URL when there is not, at whatever speed the
 * listener chose". Every one of those is exactly as true for a file from the
 * gallery, and none of it is about a note being *recorded*. Building a second
 * player would be building all of that again in order to have two of them
 * disagree later.
 *
 * ## What it does not borrow
 *
 * The name. A voice note has none and needs none; a file picked from a library
 * is the one thing somebody chose *by* its name, so it sits above the player
 * rather than being thrown away in the name of looking identical.
 *
 * The waveform is `VoiceNote`'s fallback pattern, because a picked file has no
 * precomputed peaks - decoding an entire album track in a thread to draw forty
 * bars is not a trade worth making.
 */
function AudioBubble({
  file,
  name,
  mine,
  spaced,
  messageId,
}: {
  file: FileAttachment;
  name: string;
  mine: boolean;
  spaced?: boolean;
  messageId?: string;
}) {
  const { service } = useChat();

  /*
   * Stable across renders, or the player's effects would re-run and a track
   * being listened to would restart every time the thread repainted.
   */
  const attachment = useMemo(
    (): AudioAttachment => ({
      id: file.id,
      kind: 'audio',
      // Zero rather than a guess: the element reports the real length as soon
      // as it has the metadata, and a wrong number would draw a wrong scrubber
      // for the second before that.
      duration: 0,
      waveform: [],
      url: file.url,
      ...(file.size !== undefined ? { size: file.size } : {}),
      ...(file.storagePath ? { storagePath: file.storagePath } : {}),
    }),
    [file.id, file.url, file.size, file.storagePath],
  );

  return (
    <div className={cn('w-full', spaced && 'mb-2')} {...swallow}>
      <span
        className={cn(
          'mb-1 block truncate text-caption',
          mine ? 'text-white/80' : 'text-text-secondary',
        )}
        title={name}
      >
        {name}
      </span>
      <VoiceNote
        attachment={attachment}
        tone={mine ? 'outgoing' : 'incoming'}
        {...(messageId ? { messageId } : {})}
        onStored={() => {
          if (messageId) void service.confirmMediaReceived?.(messageId).catch(() => undefined);
        }}
      />
    </div>
  );
}

/**
 * A received video, played from this device once it has been copied here.
 *
 * Split out from `FileBubble` because it needs state and `FileBubble` is a
 * branch table - the hook cannot live behind an `if` that returns early for
 * every other kind of file.
 *
 * The badge is not decoration. PINGO deletes its own copy as soon as everyone
 * has one, so "Saved on this device" is the difference between a video that
 * will still play on a plane and one that will not, and that is worth a line
 * of text the moment it becomes true.
 */
/**
 * A received video, played from this device once it has been copied here.
 *
 * Split out from `FileBubble` because it needs state and `FileBubble` is a
 * branch table - the hook cannot live behind an `if` that returns early for
 * every other kind of file.
 *
 * ## Tap to play, not fetch on sight
 *
 * This used to download every video in every opened thread through
 * `useOfflineVideo`, so scrolling past a dozen clips paid for all of them.
 * Now a video nobody opens costs nothing: the bubble is a face (the cached
 * poster, or a tile with the file's size) with a play button, and the bytes
 * move only on an explicit tap. A copy already on this device still plays
 * inline immediately - the sender's own clip, a replay - because no tap is
 * needed to spend bytes that were never fetched.
 *
 * ## The receipt still means "the bytes are here"
 *
 * `confirmMediaReceived` fires from the completion of the vault write and from
 * nowhere else - exactly as before, only later: on the tap that fetched rather
 * than on the render that merely showed the card. A video nobody opened keeps
 * the server's buffer copy until the sweeper's day is up, which is the outcome
 * the retention design already provides for.
 *
 * The badge is not decoration. PINGO deletes its own copy as soon as everyone
 * has one, so "Saved on this device" is the difference between a video that
 * will still play on a plane and one that will not, and that is worth a line
 * of text the moment it becomes true.
 */
function VideoBubble({
  file,
  name,
  spaced,
  messageId,
  edit,
}: {
  file: FileAttachment;
  name: string;
  spaced?: boolean;
  messageId?: string;
  /** Playback marks the sender chose. Applied by the player, never to the file. */
  edit?: VideoEdit;
}) {
  const { service } = useChat();
  /** The file's own shape, once it has told us. `4/5` until then. */
  const [ratio, setRatio] = useState<number>();
  /** Full bytes on this device, as an object URL. Absent until fetched or replayed. */
  const [held, setHeld] = useState<string>();
  /** The card's face, from the vault. Absent on a first sighting. */
  const [face, setFace] = useState<string>();
  /** The tap's download, in flight. */
  const [loading, setLoading] = useState(false);
  /** The tap's download failed: offline, quota, or the object already gone. */
  const [failed, setFailed] = useState(false);

  /*
   * Asked, never fetched, on sight.
   *
   * `storedVideo`/`storedPoster` are IndexedDB reads - no network - so opening
   * a thread full of videos costs no bytes here. Anything missing stays
   * missing until the tap below.
   */
  useEffect(() => {
    if (!messageId) return;
    let live = true;
    let heldUrl: string | undefined;
    let faceUrl: string | undefined;

    void (async () => {
      const [video, poster] = await Promise.all([
        storedVideo(messageId),
        storedPoster(messageId),
      ]);
      if (!live) return;
      if (video) {
        heldUrl = URL.createObjectURL(video);
        setHeld(heldUrl);
      } else if (poster) {
        faceUrl = URL.createObjectURL(poster);
        setFace(faceUrl);
      }
    })();

    return () => {
      live = false;
      if (heldUrl) URL.revokeObjectURL(heldUrl);
      if (faceUrl) URL.revokeObjectURL(faceUrl);
    };
  }, [messageId]);

  const confirm = () => {
    if (messageId) void service.confirmMediaReceived?.(messageId).catch(() => undefined);
  };

  /*
   * The explicit tap. Fetches the whole object into the vault - the same
   * `keepVideo` the old render path used, so the receipt keeps its meaning -
   * then draws the face for next time from the bytes already in hand.
   */
  const load = () => {
    if (!messageId || !file.url || loading || held) return;
    setLoading(true);
    setFailed(false);
    void (async () => {
      const blob = await keepVideo(messageId, file.url);
      if (!blob) {
        setLoading(false);
        setFailed(true);
        return;
      }
      confirm();
      // The poster is derived, not downloaded: the bytes are already here, and
      // the next sighting of this thread should not need them again.
      const poster = await makeVideoPoster(blob).catch(() => undefined);
      const heldUrl = URL.createObjectURL(blob);
      setHeld(heldUrl);
      if (poster) {
        void putPoster(messageId, poster).catch(() => undefined);
        setFace(URL.createObjectURL(poster));
      }
      setLoading(false);
    })();
  };

  return (
    <div className={cn('w-full', spaced && 'mb-2')} {...swallow}>
      {/*
        PINGO's player, the same one a shared video link gets.

        This used to be the browser's `controls`, which was defensible while
        nothing better existed - it already had a scrubber and a fullscreen
        button. But a video somebody sent and a video somebody linked are the
        same thing to whoever is reading, and Chrome's grey strip on one of
        them and PINGO's controls on the other made them look like two
        different features.

        The box holds the shape while the player fills it absolutely; `4/5`
        is the guess until the file reports its own, which is the portrait
        clip most videos in a chat turn out to be.
      */}
      {/*
        A stated width, because nothing else here has one.

        The player fills this box absolutely and so contributes no intrinsic
        width, and a message bubble is sized to its contents - so `w-full`
        resolves against nothing at all. Two attempts to fix that with a
        *floor* both failed, and the second failed instructively: the floor
        became the size. 240px wide and 135px tall is not a video, it is a
        stamp, and at that height a tap aimed at the play button lands on the
        controls instead - which is why it appeared not to play inline while
        playing perfectly in fullscreen.

        So the box states a width outright. `22rem` is roughly the image
        bubble's presence on a desktop thread, and `72vw` keeps it a bubble
        rather than the whole column on a phone.

        Inline rather than a utility: `min-w-[14rem]` was tried first and never
        reached the built stylesheet, so the class sat on the element doing
        nothing. A value the layout depends on should not be able to vanish
        between the source and the build - which is why `aspectRatio` was
        always inline too.
      */}
      <div
        className="relative w-full overflow-hidden rounded-lg bg-black"
        style={{ aspectRatio: String(ratio ?? 4 / 5), width: 'min(22rem, 72vw)' }}
      >
        {held ? (
          <VideoPlayer
            src={held}
            edit={edit}
            onShape={(shape) => setRatio(Math.min(Math.max(shape, 9 / 16), 16 / 9))}
          />
        ) : (
          <button
            type="button"
            onClick={load}
            disabled={loading}
            aria-label={loading ? `Loading video: ${name}` : `Play video: ${name}`}
            className="focus-ring absolute inset-0 h-full w-full"
          >
            {face ? (
              <img
                src={face}
                alt=""
                aria-hidden
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="grid h-full w-full place-items-center bg-sunken">
                <span className="px-4 text-center text-caption text-text-secondary">
                  {file.size !== undefined ? formatFileSize(file.size) : 'Video'}
                </span>
              </span>
            )}
            <span className="absolute inset-0 grid place-items-center bg-black/25">
              <span className="grid size-14 place-items-center rounded-full bg-black/60 text-white">
                {loading ? (
                  <span className="size-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : (
                  <PlayIcon size={24} />
                )}
              </span>
            </span>
            {failed && (
              <span className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-center text-caption text-white">
                Couldn't load. Try again.
              </span>
            )}
          </button>
        )}
      </div>
      {/*
        Two different meanings of "saved", and both belong here.

        The badge is about PINGO: the vault has a copy, so this plays with the
        network off and the server may drop its own. The button is about the
        phone: put it in the gallery, where it sits beside everything else the
        camera took. Having the first is why the second costs no download.
      */}
      <div className="flex items-center gap-2 pt-1">
        {held && (
          <p className="min-w-0 flex-1 truncate text-caption text-text-tertiary">
            Saved on this device
          </p>
        )}
        <GallerySave messageId={messageId} name={name} ready={held !== undefined} />
      </div>
    </div>
  );
}

/**
 * Puts a received video in the phone's gallery.
 *
 * The bytes are already here - the vault fetched them when the message
 * arrived - so this is a copy from one local place to another and needs no
 * network at all. That is why it only appears once `ready`: before the vault
 * has finished there is nothing to copy, and a button that would have to
 * download first is a different, slower promise than this one makes.
 */
function GallerySave({
  messageId,
  name,
  ready,
}: {
  messageId?: string;
  name: string;
  ready: boolean;
}) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  if (!messageId || !ready) return null;

  const label =
    state === 'idle' ? 'Save' : state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : "Couldn't save";

  return (
    <button
      type="button"
      disabled={state !== 'idle'}
      onClick={() => {
        setState('saving');
        // A rejected read left this stuck on "Saving…" forever, which is the
        // same silence in a slower disguise.
        void storedVideo(messageId).then(async (blob) => {
          // Gone from the vault between the badge appearing and this press -
          // evicted under storage pressure. Nothing to copy, and saying so
          // beats a button that silently does nothing.
          if (!blob) return setState('failed');
          setState((await saveVideoBlob(blob, name)) ? 'saved' : 'failed');
        }, () => setState('failed'));
      }}
      className={cn(
        'focus-ring shrink-0 rounded-full px-2 py-0.5 text-caption font-medium',
        state === 'failed' ? 'text-danger' : state === 'saved' ? 'text-text-tertiary' : 'text-brand',
      )}
    >
      {label}
    </button>
  );
}
