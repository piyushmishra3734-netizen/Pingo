import { formatTime, useChat, type Message, type MessageReceipt } from '@pingo/core';
import { Avatar, CheckDoubleIcon, CheckIcon, LoadingState } from '@pingo/ui';
import { useEffect, useState, type ReactNode } from 'react';

import { Overlay } from '../../../components/Overlay.js';
import { readReceiptsOn } from '../../settings/privacy-flags.js';

/**
 * Who has seen a message, as an iPhone page sheet.
 *
 * The message sits at the top as the bubble it is, then the lists in inset
 * grouped cards - Read, Delivered, and when it was sent - with Done at the top
 * right. The same facts the old sheet held, laid out the way iOS lays out a
 * detail page.
 *
 * ## Read receipts are a trade
 *
 * With them turned off, nobody's read time is shown here either: everyone
 * lands under Delivered. Seeing when others read yours is what turning your
 * own off gives up.
 */
export function MessageInfoSheet({ message, onClose }: { message: Message; onClose: () => void }) {
  const { service, users } = useChat();
  const [receipts, setReceipts] = useState<MessageReceipt[]>();

  useEffect(() => {
    let active = true;
    void service
      .messageReceipts(message.id)
      .then((rows) => { if (active) setReceipts(rows); })
      .catch(() => { if (active) setReceipts([]); });
    return () => { active = false; };
  }, [service, message.id]);

  const receiptsOn = readReceiptsOn();
  const read = receiptsOn
    ? (receipts ?? []).filter((r): r is Required<MessageReceipt> => r.readAt !== undefined).sort((a, b) => b.readAt - a.readAt)
    : [];
  const unread = receiptsOn ? (receipts ?? []).filter((r) => r.readAt === undefined) : (receipts ?? []);
  const person = (userId: string) => users.find((u) => u.id === userId);
  const when = (t: number) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <Overlay onDismiss={onClose}>
      <div className="fixed inset-0 z-1100 flex flex-col justify-end">
        <div className="animate-fade-in absolute inset-0 bg-black/35" onPointerDown={onClose} />
        <section
          role="dialog"
          aria-modal="true"
          aria-label="Message info"
          className="animate-panel-in relative flex max-h-[92%] flex-col overflow-hidden rounded-t-[14px] bg-sunken"
        >
          <header className="relative flex h-14 shrink-0 items-center justify-center border-b border-line/60 bg-page/80 backdrop-blur-xl">
            <span className="absolute top-1.5 left-1/2 h-[5px] w-9 -translate-x-1/2 rounded-full bg-line-strong" />
            <h2 className="text-[17px] font-semibold text-ink">Message Info</h2>
            <button type="button" onClick={onClose} className="absolute right-4 text-[17px] font-semibold text-[#0a84ff]">Done</button>
          </header>

          <div className="overflow-y-auto px-4 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            {/* the message, as the bubble it is */}
            <div className="mb-6 flex justify-end">
              <p className="lq-brand-glass-water line-clamp-6 max-w-[78%] rounded-[18px] px-4 py-2.5 text-body text-on-brand">
                {message.deleted ? 'This message was deleted' : message.body || 'Attachment'}
              </p>
            </div>

            {receipts === undefined ? (
              <LoadingState label="Loading message info" />
            ) : (
              <div className="flex flex-col gap-6">
                {read.length > 0 && (
                  <Group title="Read" icon={<CheckDoubleIcon size={14} className="text-brand" />}>
                    {read.map((r) => (
                      <Row key={r.userId} name={person(r.userId)?.name ?? 'Someone'} id={r.userId} src={person(r.userId)?.avatarUrl}
                        value={<time dateTime={new Date(r.readAt).toISOString()}>{formatTime(r.readAt)}</time>} />
                    ))}
                  </Group>
                )}
                {unread.length > 0 && (
                  <Group title="Delivered" icon={<CheckIcon size={14} />}>
                    {unread.map((r) => (
                      <Row key={r.userId} name={person(r.userId)?.name ?? 'Someone'} id={r.userId} src={person(r.userId)?.avatarUrl} value="Not read yet" />
                    ))}
                  </Group>
                )}
                {read.length === 0 && unread.length === 0 && (
                  <p className="px-4 text-body text-text-secondary">Nobody else is in this conversation yet.</p>
                )}
                <Group title="Details">
                  <Line label="Sent" value={when(message.createdAt)} />
                  {message.editedAt && <Line label="Edited" value={when(message.editedAt)} />}
                </Group>
              </div>
            )}
          </div>
        </section>
      </div>
    </Overlay>
  );
}

/** An inset grouped card, iOS's: a small caps title above, rounded rows below. */
function Group({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 px-4 text-[13px] font-medium tracking-wide text-text-tertiary uppercase">{icon}{title}</h3>
      <ul className="overflow-hidden rounded-[12px] bg-page">{children}</ul>
    </section>
  );
}

function Row({ name, id, src, value }: { name: string; id: string; src: string | undefined; value: ReactNode }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 [&+&]:border-t [&+&]:border-line/60">
      <Avatar name={name} id={id} src={src} size="sm" />
      <span className="min-w-0 flex-1 truncate text-body text-ink">{name}</span>
      <span className="shrink-0 text-body text-text-tertiary">{value}</span>
    </li>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3 text-body [&+&]:border-t [&+&]:border-line/60">
      <span className="text-ink">{label}</span>
      <span className="text-text-tertiary">{value}</span>
    </li>
  );
}
