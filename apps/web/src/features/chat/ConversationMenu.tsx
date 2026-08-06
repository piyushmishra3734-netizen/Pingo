import { formatMuteUntil, type Conversation } from '@pingo/core';
import { IconButton, MoreIcon, cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ChatListsSheet } from '../conversations/ChatListsSheet.js';
import { DeleteChatSheet } from '../conversations/DeleteChatSheet.js';
import { MuteSheet } from '../conversations/MuteSheet.js';
import { useConversationActions } from '../conversations/useConversationActions.js';
import { useUnmuteConfirm } from '../conversations/useUnmuteConfirm.js';

import { useConfirm } from '../../components/ConfirmProvider.js';

/**
 * The `⋯` in a thread header: everything you can do to this conversation.
 *
 * ## Why it duplicates the chat list's selection menu
 *
 * It does not duplicate it - it reaches it from the other direction. On a phone
 * you hold a row in the list; on a desktop the list may not even be the thing
 * you are looking at, and holding a row to archive the chat you already have
 * open is a strange way round. Both surfaces call the same
 * `useConversationActions`, so there is one implementation of each rule and one
 * place a bug in them can live.
 *
 * ## Calling lives here too
 *
 * The header shows call buttons, but they are icons with no room to say
 * anything. When a call is not possible the menu is where the sentence fits, so
 * the rows appear here as well and explain themselves rather than sitting
 * greyed out with a tooltip nobody reads.
 */

export interface ConversationMenuProps {
  conversation: Conversation;
  /** Absent for groups, where there is no single person to call. */
  onCall?: (kind: 'audio' | 'video') => void;
  /** Why calling is unavailable, if it is. Shown instead of the call rows. */
  callBlockedReason?: string;
  /** AI threads only - name, vibe, memory. Person settings, not a model panel. */
  onAiSettings?: () => void;
  /**
   * Turns the thread into a selection.
   *
   * Here rather than only behind a long press on a message: acting on several
   * messages is a thing you decide to do *to the conversation*, and the header
   * is where you look for that. A gesture on one message is a fine second way
   * in and a poor only way in - nobody discovers it, and on a phone it competes
   * with the reaction bar.
   */
  onSelectMessages?: () => void;
}

export function ConversationMenu({
  conversation,
  onCall,
  callBlockedReason,
  onAiSettings,
  onSelectMessages,
}: ConversationMenuProps) {
  const [open, setOpen] = useState(false);
  const [muting, setMuting] = useState(false);
  const [listing, setListing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const actions = useConversationActions();
  const confirm = useConfirm();
  const confirmUnmute = useUnmuteConfirm();

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    // Deferred, so the click that opened it does not immediately close it.
    const timer = window.setTimeout(() => document.addEventListener('click', dismiss));
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('click', dismiss);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const id = [conversation.id];
  const run = (work: Promise<void> | void) => {
    setOpen(false);
    void work;
  };

  return (
    <div className="relative" ref={wrapRef}>
      <IconButton
        label="Conversation options"
        size="sm"
        onClick={() => setOpen((was) => !was)}
      >
        <MoreIcon size={20} />
      </IconButton>

      {open && (
        <div
          role="menu"
          aria-label="Conversation options"
          className={cn(
            'animate-panel-in absolute top-full right-0 z-200 mt-1 w-60 origin-top-right',
            'max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-lg',
          )}
        >
          {onCall && !callBlockedReason && (
            <>
              <Item label="Voice call" onSelect={() => run(onCall('audio'))} />
              <Item label="Video call" onSelect={() => run(onCall('video'))} />
              <Divider />
            </>
          )}

          {onSelectMessages && (
            <>
              {/* Near the top: it acts on the thread you are looking at, which
                  is what almost everything below this does not. */}
              <Item label="Select messages" onSelect={() => run(onSelectMessages())} />
              <Divider />
            </>
          )}

          {/*
            Stated once, in the one place with room for a sentence. An icon that
            is merely dimmed leaves the user guessing which of the many possible
            reasons applies to them.
          */}
          {callBlockedReason && conversation.kind !== 'ai' && (
            <>
              <p className="px-3 py-2 text-caption text-text-tertiary">
                {callBlockedReason}
              </p>
              <Divider />
            </>
          )}

          {conversation.kind === 'ai' && onAiSettings && (
            <>
              <Item
                label="About them"
                onSelect={() => {
                  setOpen(false);
                  onAiSettings();
                }}
              />
              <Divider />
            </>
          )}

          <Item
            label={conversation.pinned ? 'Unpin chat' : 'Pin chat'}
            onSelect={() => run(actions.pin([conversation], !conversation.pinned))}
          />
          <Item
            label={conversation.favorite ? 'Remove from favourites' : 'Add to favourites'}
            onSelect={() => run(actions.favorite(id, !conversation.favorite))}
          />
          <Item
            label={
              conversation.muted
                ? (formatMuteUntil(conversation.mutedUntil) ?? 'Muted') + ' · unmute'
                : 'Mute notifications'
            }
            onSelect={() => {
              setOpen(false);
              if (!conversation.muted) {
                setMuting(true);
                return;
              }
              void (async () => {
                if (await confirmUnmute(1, conversation.title)) await actions.mute(id, null);
              })();
            }}
          />
          <Item
            label="Add to list"
            onSelect={() => {
              setOpen(false);
              setListing(true);
            }}
          />
          <Item
            label={conversation.archived ? 'Unarchive' : 'Archive'}
            onSelect={() => run(actions.archive(id, !conversation.archived))}
          />
          <Item
            label={conversation.unreadCount > 0 ? 'Mark as read' : 'Mark as unread'}
            onSelect={() => run(actions.markUnread(id, conversation.unreadCount === 0))}
          />

          <Divider />

          {/*
            Confirmed, unlike pin, favourite, archive and mark-as-read above  - 
            those are all one tap to undo. Clearing a thread is not, and it sits
            directly above Delete chat where a thumb aiming for one can find the
            other.
          */}
          <Item
            label="Clear messages"
            onSelect={() => {
              setOpen(false);
              void (async () => {
                const go = await confirm({
                  title: 'Clear this chat?',
                  description:
                    'Every message goes from your side. The other person keeps theirs, and the chat itself stays in your list.',
                  confirmLabel: 'Clear messages',
                });
                if (go) await actions.clear(id);
              })();
            }}
          />
          <Item
            label="Delete chat"
            danger
            onSelect={() => {
              setOpen(false);
              setDeleting(true);
            }}
          />
        </div>
      )}

      {actions.error && (
        <p
          role="alert"
          className={cn(
            'absolute top-full right-0 z-200 mt-1 w-60 rounded-lg',
            'bg-danger-soft px-3 py-2 text-caption text-danger',
          )}
        >
          {actions.error}
        </p>
      )}

      {muting && (
        <MuteSheet
          count={1}
          onCancel={() => setMuting(false)}
          onChoose={(ms) => {
            setMuting(false);
            void actions.mute(id, ms);
          }}
        />
      )}

      {listing && (
        <ChatListsSheet
          selectedIds={id}
          onClose={() => setListing(false)}
          onChanged={() => undefined}
        />
      )}

      {deleting && (
        <DeleteChatSheet
          count={1}
          onCancel={() => setDeleting(false)}
          onConfirm={() => {
            setDeleting(false);
            // Back to the list: staying in a thread that is no longer in it
            // would leave the reader looking at something they just removed.
            void actions.remove(id).then(() => navigate('/chats'));
          }}
        />
      )}
    </div>
  );
}

function Divider() {
  return <div className="my-1 h-px bg-divider" />;
}

function Item({
  label,
  danger = false,
  onSelect,
}: {
  label: string;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={cn(
        'focus-ring flex w-full items-center px-3 py-2.5 text-left text-body',
        'transition-colors duration-instant hover:bg-hover active:bg-pressed',
        danger ? 'text-danger' : 'text-ink',
      )}
    >
      {label}
    </button>
  );
}
