import { useChat } from '@pingo/core';
import { cn } from '@pingo/ui';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ScreenHeader } from '../components/ScreenHeader.js';
import { PingRecipients, PingSendButton } from '../features/camera/PingRecipients.js';
import { peekShare, takeShare, watchShare, type SharePayload } from '../features/share/share-store.js';

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
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // A second delivery for the same share (Android sends image and caption
  // separately) has to reach a screen that is already open.
  useEffect(() => watchShare(setPayload), []);

  const preview = useMemo(() => {
    const file = payload?.files?.[0];
    return file ? URL.createObjectURL(file) : undefined;
  }, [payload]);

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const toggle = (conversationId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(conversationId)) next.delete(conversationId);
      else next.add(conversationId);
      return next;
    });
  };

  const send = async () => {
    if (selected.size === 0 || busy || !payload) return;
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
            await service.sendMessage({ conversationId, body: '', photo: { image: file } });
          }
          if (payload.text) {
            await service.sendMessage({ conversationId, body: payload.text });
          }
        }),
      );

      takeShare();

      // Straight into the conversation when it went to one person; the chat
      // list when it went to several, because there is no single thread to open.
      const only = selected.size === 1 ? [...selected][0] : undefined;
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

  const title = payload.label ?? (payload.files?.length ? 'Send photo' : 'Send link');

  return (
    <div className="flex h-full min-h-0 flex-col bg-page">
      <ScreenHeader title={title} showBack />

      {/*
        What is being sent, above the people it is going to.

        A share screen that shows only a list of names asks somebody to trust
        that the right thing is attached. Showing it costs one row and removes
        the doubt entirely.
      */}
      <div className="shrink-0 px-4 pb-3">
        {/*
          Held to a column, on every screen.

          Stretched to a desktop width the rows became a spreadsheet - a name on
          the left and a checkbox a foot away on the right, with nothing between
          them. A share sheet is a small object you reach into, and it should
          keep that shape wherever it is opened.
        */}
        <div className="mx-auto flex w-full max-w-md items-center gap-3 rounded-xl bg-surface p-3 shadow-sm">
          {preview ? (
            <img
              src={preview}
              alt=""
              className="size-14 shrink-0 rounded-lg object-cover"
            />
          ) : (
            <span className="grid size-14 shrink-0 place-items-center rounded-lg bg-sunken text-h3">
              🔗
            </span>
          )}

          <div className="min-w-0 flex-1">
            {payload.files && payload.files.length > 1 ? (
              <p className="text-body font-medium text-ink">
                {payload.files.length} photos
              </p>
            ) : null}
            {payload.text ? (
              <p className="line-clamp-2 break-words text-caption text-text-secondary">
                {payload.text}
              </p>
            ) : payload.files?.length === 1 ? (
              <p className="text-caption text-text-secondary">Ready to send</p>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <p role="alert" className="shrink-0 px-5 pb-2 text-caption text-danger">
          {error}
        </p>
      ) : null}

      <div className="mx-auto min-h-0 w-full max-w-md flex-1 overflow-y-auto px-2">
        <PingRecipients selected={selected} onToggle={toggle} anyConversation />
      </div>

      <div
        className={cn(
          'mx-auto w-full max-w-md shrink-0 px-4 pt-2',
          'pb-[max(1rem,env(safe-area-inset-bottom))]',
        )}
      >
        <PingSendButton count={selected.size} busy={busy} onSend={() => void send()} />
      </div>
    </div>
  );
}
