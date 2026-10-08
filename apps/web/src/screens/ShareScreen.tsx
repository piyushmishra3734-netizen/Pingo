import { formatFileSize, useChat } from '@pingo/core';
import { cn } from '@pingo/ui';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { SendTo } from '../features/camera/snap/send-to.js';
import { peekShare, takeShare, watchShare, type SharePayload } from '../features/share/share-store.js';
import { parseSongShare } from '../features/music/song-share.js';
import { KIND_LABEL, parseCollectionShare } from '../features/music/music-share.js';

/**
 * Send something to somebody, from anywhere.
 *
 * ## The picker is the Ping picker
 *
 * Choosing who to send to is a solved problem in this product: `PingRecipients`
 * already lists the people you talk to, lets you search for anyone else by
 * name or @username, and handles the mutual rules. Writing a second picker for
 * sharing would mean two lists that slowly disagree about who you can reach.
 *
 * ## What arrives here
 *
 * A photo shared from another app, a link, a post from inside PINGO. They are
 * the same act - "send this to somebody" - so they share one screen rather than
 * one per source, and the header names the thing so it never says "Share" over
 * a picture of your own face.
 *
 * ## Nothing is kept if you leave
 *
 * Backing out clears the payload. A share somebody abandoned should not still
 * be sitting there tomorrow, offering to send a photo they have forgotten to a
 * person they no longer meant.
 */
export function ShareScreen() {
  const navigate = useNavigate();
  const { service } = useChat();

  const [payload, setPayload] = useState<SharePayload | undefined>(() => peekShare());
    const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // A second delivery for the same share (Android sends image and caption
  // separately) has to reach a screen that is already open.
  useEffect(() => watchShare(setPayload), []);

  const first = payload?.files?.[0];
  /** A song from PINGO Music: shown as its cover and name, not as the link that carries it. */
  const shared = !first && payload?.text ? parseSongShare(payload.text) : undefined;
  const collection = !first && !shared && payload?.text ? parseCollectionShare(payload.text) : undefined;
  // Either one draws the same row: a cover, a name, a line under it.
  const song = shared ?? (collection ? { name: collection.name, artist: collection.sub || KIND_LABEL[collection.kind], img: collection.img } : undefined);

  /*
   * A thumbnail only where there is something to see.
   *
   * An object URL for a PDF put into an `<img>` is a broken image icon, which
   * reads as a share that has already gone wrong. A video could be made to
   * produce a poster frame, and deliberately is not: that means decoding a
   * shared video to draw a square the size of a thumbnail, on a phone, before
   * anybody has even chosen who to send it to.
   */
  const preview_ = useMemo(
    () => (first?.type.startsWith('image/') ? URL.createObjectURL(first) : undefined),
    [first],
  );

  useEffect(() => {
    if (!preview_) return;
    return () => URL.revokeObjectURL(preview_);
  }, [preview_]);

  const send = async (selected: string[]) => {
    if (selected.length === 0 || busy || !payload) return;
    setBusy(true);
    setError(undefined);

    try {
      /*
       * One send per recipient, all at once. A share of one photo to four
       * people is four messages, and doing them in series would make the
       * fourth person's copy arrive noticeably later for no reason.
       */
      await Promise.all(
        [...selected].map(async (conversationId) => {
          for (const file of payload.files ?? []) {
            /*
             * Sent as what it is.
             *
             * Every shared file used to go out as a photo, which was fine while
             * the app only claimed images in the share sheet and wrong the
             * moment it stopped. A video sent as a photo is a photo message
             * holding a video: no player, no filename, and a download card that
             * calls it a picture.
             */
            await service.sendMessage(
              file.type.startsWith('image/')
                ? { conversationId, body: '', photo: { image: file } }
                : { conversationId, body: '', document: { file } },
            );
          }
          if (payload.text) {
            await service.sendMessage({ conversationId, body: payload.text });
          }
        }),
      );

      takeShare();

      // Straight into the conversation when it went to one person; the chat
      // list when it went to several, because there is no single thread to open.
      const only = selected.length === 1 ? selected[0] : undefined;
      navigate(only ? `/chats/${only}` : '/chats', { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn't send. Try again.");
    } finally {
      setBusy(false);
    }
  };

  /*
   * Cleared when the screen goes, however it goes - sent, backed out of, or
   * navigated past. A share somebody abandoned should not still be waiting
   * tomorrow, offering to send a photo they have forgotten about.
   */
  useEffect(() => () => { takeShare(); }, []);

  if (!payload) {
    /*
     * Reached with nothing to send - a refresh, or a back button after sending.
     * Sent onwards rather than shown an empty picker, which would look like a
     * screen that has broken rather than one that has finished.
     */
    return null;
  }

  /*
   * The title names what is actually being sent.
   *
   * "Send photo" over a spreadsheet is the screen telling somebody it has
   * misunderstood them, at the exact moment they are deciding whether to trust
   * it with the file.
   */
  const count = payload.files?.length ?? 0;
  const kind = !first
    ? 'link'
    : first.type.startsWith('image/')
      ? count > 1
        ? 'photos'
        : 'photo'
      : first.type.startsWith('video/')
        ? count > 1
          ? 'videos'
          : 'video'
        : count > 1
          ? 'files'
          : 'file';

  const title = payload.label ?? `Send ${kind}`;

  /*
   * What is being sent, above the people it is going to: one row, so nobody
   * has to trust that the right thing is attached.
   */
  const preview = (
    <div>
      <h4 className="mx-0.5 mb-2.5 text-[17px] font-bold">{title}</h4>
      <div className="flex items-center gap-3 rounded-[18px] bg-surface p-3 shadow-[0_1px_2px_rgba(16,17,20,0.06)]">
        {song ? (
          song.img ? (
            <img src={song.img} alt="" className={cn('size-14 shrink-0 object-cover', collection?.kind === 'artist' ? 'rounded-full' : 'rounded-xl')} />
          ) : (
            <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-sunken text-h2">🎵</span>
          )
        ) : preview_ ? (
          <img src={preview_} alt="" className="size-14 shrink-0 rounded-xl object-cover" />
        ) : (
          <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-sunken text-h2">
            {/* Stands in for the thumbnail there is no point drawing. */}
            {!first ? '🔗' : first.type.startsWith('video/') ? '🎬' : '📄'}
          </span>
        )}
        <div className="min-w-0 flex-1">
          {song ? (
            <>
              <p className="truncate text-[16px] font-semibold text-ink">{song.name}</p>
              {song.artist ? <p className="truncate text-[13.5px] text-text-secondary">{song.artist}</p> : null}
            </>
          ) : (
            <>
              {count > 1 ? (
                <p className="text-[16px] font-semibold text-ink">
                  {count} {kind}
                </p>
              ) : first && !first.type.startsWith('image/') ? (
                // The filename: "the PDF" is indistinguishable from every other PDF.
                <p className="truncate text-[16px] font-semibold text-ink" title={first.name}>
                  {first.name}
                </p>
              ) : null}
              {payload.text ? (
                <p className="line-clamp-2 break-words text-[13.5px] text-text-secondary">{payload.text}</p>
              ) : count === 1 ? (
                <p className="text-[13.5px] text-text-secondary">{first && first.size > 0 ? formatFileSize(first.size) : 'Ready to send'}</p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );

  /*
   * The same Send to as the camera and the story editor, so sending anything
   * anywhere in PINGO is one screen. Without My story: a song, a playlist, a
   * link or a file is not a story.
   */
  return (
    <SendTo
      views={undefined}
      post={false}
      preview={preview}
      busy={busy}
      {...(error ? { error } : {})}
      onClose={() => navigate(-1)}
      onSend={(ids) => void send(ids)}
    />
  );
}
