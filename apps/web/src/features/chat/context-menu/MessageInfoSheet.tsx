import { formatTime, useChat, type Message, type MessageReceipt } from '@pingo/core';
import { Avatar, CheckDoubleIcon, CheckIcon, LoadingState } from '@pingo/ui';
import { useEffect, useState } from 'react';

import { Sheet } from '../../../components/Sheet.js';

/**
 * Who has read this message, and when.
 *
 * ## Why this replaced a `window.alert`
 *
 * Info used to be `window.alert('Sent …\nStatus: read')` — a Chrome dialog with
 * Chrome's typography, Chrome's button, and no way to tell you the one thing
 * anybody opens message info to find out: *which* of the six people in the
 * group have actually seen it. It also blocked the page, which for a chat
 * meant nothing could arrive while you were reading about what had.
 *
 * ## Everyone, not just the readers
 *
 * A group lists every other member whether they have read it or not, because
 * "still waiting on Priya" is the half of the answer a list of readers cannot
 * give. The unread sit under their own heading rather than being dropped, and
 * the order — read first, newest read at the top — puts the fresh news where
 * the eye lands.
 *
 * ## What a time here means
 *
 * The moment their read cursor first passed this message, not the last time
 * they opened the chat. Re-reading a thread does not restamp anything.
 */
export function MessageInfoSheet({
  message,
  onClose,
}: {
  message: Message;
  onClose: () => void;
}) {
  const { service, users } = useChat();
  const [receipts, setReceipts] = useState<MessageReceipt[]>();

  useEffect(() => {
    let active = true;
    void service
      .messageReceipts(message.id)
      .then((rows) => {
        if (active) setReceipts(rows);
      })
      // An empty list is the honest answer for a message whose readers cannot
      // be resolved; a spinner that never stops is not.
      .catch(() => {
        if (active) setReceipts([]);
      });
    return () => {
      active = false;
    };
  }, [service, message.id]);

  const read = (receipts ?? [])
    .filter((r): r is Required<MessageReceipt> => r.readAt !== undefined)
    .sort((a, b) => b.readAt - a.readAt);
  const unread = (receipts ?? []).filter((r) => r.readAt === undefined);

  const nameOf = (userId: string) => users.find((u) => u.id === userId)?.name ?? 'Someone';
  const avatarOf = (userId: string) => users.find((u) => u.id === userId)?.avatarUrl;

  return (
    <Sheet title="Message info" onClose={onClose} elevated>
      {/*
        The message itself, quoted small. Without it there is nothing anchoring
        the times to a message, and info opened from a long thread becomes a
        list of names with no subject.
      */}
      <p className="mb-5 line-clamp-3 rounded-md bg-surface-sunken px-3 py-2 text-body text-text-secondary">
        {message.deleted
          ? 'This message was deleted'
          : message.body || 'Attachment'}
      </p>

      {receipts === undefined ? (
        <LoadingState label="Loading message info" />
      ) : (
        <div className="flex flex-col gap-5">
          {read.length > 0 && (
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-caption font-medium uppercase tracking-wide text-text-tertiary">
                <CheckDoubleIcon size={14} className="text-brand" />
                Read
              </h3>
              <ul className="flex flex-col">
                {read.map((receipt) => (
                  <li key={receipt.userId} className="flex items-center gap-3 py-2">
                    <Avatar
                      name={nameOf(receipt.userId)}
                      id={receipt.userId}
                      src={avatarOf(receipt.userId)}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1 truncate text-body">
                      {nameOf(receipt.userId)}
                    </span>
                    <time
                      className="shrink-0 text-caption text-text-tertiary"
                      dateTime={new Date(receipt.readAt).toISOString()}
                    >
                      {formatTime(receipt.readAt)}
                    </time>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {unread.length > 0 && (
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-caption font-medium uppercase tracking-wide text-text-tertiary">
                <CheckIcon size={14} />
                Delivered
              </h3>
              <ul className="flex flex-col">
                {unread.map((receipt) => (
                  <li key={receipt.userId} className="flex items-center gap-3 py-2">
                    <Avatar
                      name={nameOf(receipt.userId)}
                      id={receipt.userId}
                      src={avatarOf(receipt.userId)}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1 truncate text-body">
                      {nameOf(receipt.userId)}
                    </span>
                    <span className="shrink-0 text-caption text-text-tertiary">Not read yet</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {read.length === 0 && unread.length === 0 && (
            <p className="text-body text-text-secondary">
              Nobody else is in this conversation yet.
            </p>
          )}

          <section className="border-t border-border pt-4 text-caption text-text-tertiary">
            <p>Sent {new Date(message.createdAt).toLocaleString()}</p>
            {message.editedAt && <p>Edited {new Date(message.editedAt).toLocaleString()}</p>}
          </section>
        </div>
      )}
    </Sheet>
  );
}
