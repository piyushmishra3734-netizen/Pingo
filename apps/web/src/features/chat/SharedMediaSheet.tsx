import { formatFileSize, type Message } from '@pingo/core';
import { FileIcon, LinkIcon, LoadingState, PlayIcon, cn } from '@pingo/ui';
import { useEffect, useMemo, useState } from 'react';

import { Sheet } from '../../components/Sheet.js';
import { readMessageRows } from '../../lib/crypto/session.js';
import { useT } from '../i18n/useT.js';
import { storedMedia } from './video-vault.js';
import {
  collectSharedMedia,
  type DocItem,
  type LinkItem,
  type MediaItem,
} from './shared-media.js';

/**
 * Everything this conversation has carried, in three tabs.
 *
 * ## Read from this device, not from the server
 *
 * The rows are the sealed copies already on disk, which is the same store the
 * thread pages from. That makes the sheet instant and correct with the network
 * off, and it means the gallery holds exactly what this device holds - a phone
 * that joined last week does not claim to have last year's photos.
 *
 * The alternative was a server query, and it would have had to decrypt a year
 * of history to find out which messages had pictures in them.
 *
 * ## Tapping a tile goes to the message
 *
 * Not to a gallery viewer of its own. A picture in a chat means something
 * because of what was said around it, and "where was this?" is the question
 * somebody scrolling this grid is actually asking. The thread already knows how
 * to open a photo full screen once you are there.
 *
 * ponytail: one read of the newest `ROWS` messages, no paging. If somebody has
 * a conversation deep enough that this misses things, page it the way the
 * thread does.
 */

/** How far back the sheet looks. Deep enough for a year of an active chat. */
const ROWS = 1000;

export interface SharedMediaSheetProps {
  conversationId: string;
  onClose: () => void;
  /** Scrolls the thread to a message and flashes it. */
  onJump: (messageId: string) => void;
}

type Tab = 'media' | 'docs' | 'links';

export function SharedMediaSheet({ conversationId, onClose, onJump }: SharedMediaSheetProps) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('media');
  const [messages, setMessages] = useState<Message[]>();

  useEffect(() => {
    let live = true;
    void readMessageRows<Message>(conversationId, ROWS)
      .then((rows) => {
        if (live) setMessages(rows);
      })
      .catch(() => {
        if (live) setMessages([]);
      });
    return () => {
      live = false;
    };
  }, [conversationId]);

  const found = useMemo(() => collectSharedMedia(messages ?? []), [messages]);

  const go = (messageId: string) => {
    onClose();
    onJump(messageId);
  };

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: 'media', label: t('shared.media'), count: found.media.length },
    { id: 'docs', label: t('shared.docs'), count: found.docs.length },
    { id: 'links', label: t('shared.links'), count: found.links.length },
  ];

  return (
    <Sheet title={t('shared.title')} onClose={onClose}>
      <div role="tablist" aria-label={t('shared.title')} className="mb-3 flex gap-1">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className={cn(
              'focus-ring flex-1 rounded-full px-3 py-1.5 text-caption font-medium',
              'transition-colors duration-instant',
              tab === entry.id
                ? 'bg-brand-gradient text-on-brand'
                : 'bg-surface-2 text-text-secondary hover:bg-hover',
            )}
          >
            {entry.label}
            {/* The count is the answer to "is there anything in here?", so it
                is on the tab rather than inside it. */}
            {messages && entry.count > 0 && (
              <span className="ml-1 tabular-nums opacity-70">{entry.count}</span>
            )}
          </button>
        ))}
      </div>

      {!messages ? (
        <LoadingState label={t('shared.loading')} />
      ) : tab === 'media' ? (
        found.media.length === 0 ? (
          <Empty text={t('shared.noMedia')} />
        ) : (
          <div className="grid grid-cols-3 gap-1">
            {found.media.map((item, index) => (
              <MediaTile key={`${item.messageId}-${index}`} item={item} onOpen={go} />
            ))}
          </div>
        )
      ) : tab === 'docs' ? (
        found.docs.length === 0 ? (
          <Empty text={t('shared.noDocs')} />
        ) : (
          <ul className="flex flex-col gap-1">
            {found.docs.map((doc, index) => (
              <li key={`${doc.messageId}-${index}`}>
                <DocRow doc={doc} onOpen={go} />
              </li>
            ))}
          </ul>
        )
      ) : found.links.length === 0 ? (
        <Empty text={t('shared.noLinks')} />
      ) : (
        <ul className="flex flex-col gap-1">
          {found.links.map((link, index) => (
            <li key={`${link.messageId}-${index}`}>
              <LinkRow link={link} onOpen={go} />
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-1 py-8 text-center text-caption text-text-tertiary">{text}</p>;
}

/**
 * One picture or video in the grid.
 *
 * ## The vault only, never a download
 *
 * The thread's media hook fetches what is missing and writes it to the device,
 * which is right for a bubble somebody is looking at and wrong for a grid of
 * two hundred: opening this sheet would have pulled every video in the
 * conversation down over mobile data. So the tile reads the vault and stops
 * there, and falls back to the stored signature only for a still image.
 *
 * A tile with neither is a grey square that still goes to its message, which is
 * the honest version of "the bytes are not on this device".
 */
function MediaTile({ item, onOpen }: { item: MediaItem; onOpen: (id: string) => void }) {
  const [local, setLocal] = useState<string>();

  useEffect(() => {
    let live = true;
    let url: string | undefined;
    void storedMedia(item.messageId).then((blob) => {
      if (!blob || !live) return;
      url = URL.createObjectURL(blob);
      setLocal(url);
    });
    return () => {
      live = false;
      // An object URL pins the whole blob in memory; a grid would pin all of them.
      if (url) URL.revokeObjectURL(url);
    };
  }, [item.messageId]);

  // Video never falls back to the remote URL: a signed one would stream, and
  // this is a thumbnail.
  const src = local ?? (item.kind === 'image' ? item.url : undefined);

  return (
    <button
      type="button"
      onClick={() => onOpen(item.messageId)}
      aria-label={item.kind === 'video' ? 'Go to video' : 'Go to photo'}
      className={cn(
        'focus-ring relative aspect-square overflow-hidden rounded-md bg-surface-2',
        'transition-transform duration-instant active:scale-[0.97]',
      )}
    >
      {src ? (
        item.kind === 'video' ? (
          // No poster survives on disk, so the file itself draws its first
          // frame. `preload="metadata"` is what keeps that from downloading a
          // grid's worth of video.
          <video src={src} preload="metadata" muted playsInline className="size-full object-cover" />
        ) : (
          <img src={src} alt="" loading="lazy" className="size-full object-cover" />
        )
      ) : null}

      {item.kind === 'video' && (
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid size-7 place-items-center rounded-full bg-black/45 text-white">
            <PlayIcon size={14} className="translate-x-px" />
          </span>
        </span>
      )}
    </button>
  );
}

function DocRow({ doc, onOpen }: { doc: DocItem; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(doc.messageId)}
      className={cn(
        'focus-ring flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left',
        'transition-colors duration-instant hover:bg-hover',
      )}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-2 text-text-secondary">
        <FileIcon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body text-ink">{doc.fileName}</span>
        {doc.size !== undefined && (
          <span className="block text-caption text-text-tertiary">
            {formatFileSize(doc.size)}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * A link, and the message it was sent in.
 *
 * The row goes to the message rather than opening the site: a link out of a
 * list has lost the sentence that explained it, and following one by accident
 * from a scroll is worse than one extra tap.
 */
function LinkRow({ link, onOpen }: { link: LinkItem; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(link.messageId)}
      className={cn(
        'focus-ring flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left',
        'transition-colors duration-instant hover:bg-hover',
      )}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-2 text-text-secondary">
        <LinkIcon size={18} />
      </span>
      <span className="min-w-0 flex-1 truncate text-body text-brand">{link.value}</span>
    </button>
  );
}
